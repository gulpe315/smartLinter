//! SmartLinter Micro-Scoping Worker Queue
//!
//! Provides a strictly serialized (Concurrency = 1) worker queue to manage LLM inference tasks
//! without causing VRAM spikes on 8GB hardware. Implements debounce and cancellation for rapid
//! paragraph edits, dynamic runtime model switching, timeout guards, and complete error isolation.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex, Notify, RwLock};
use tracing::{debug, error, info, warn};

use crate::ai::provider::LocalLlmProvider;
use crate::ai::types::{AiError, QueueJobRequest, QueueJobResult, QueueStats};

/// Default inference timeout duration (20 seconds).
pub const DEFAULT_JOB_TIMEOUT: Duration = Duration::from_secs(20);
/// Default fallback model name.
pub const DEFAULT_MODEL_NAME: &str = "qwen2.5:7b";

/// Configuration settings for the MicroScopingQueue.
#[derive(Debug, Clone)]
pub struct QueueConfig {
    pub default_model: String,
    pub default_timeout: Duration,
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            default_model: DEFAULT_MODEL_NAME.to_string(),
            default_timeout: DEFAULT_JOB_TIMEOUT,
        }
    }
}

impl QueueConfig {
    pub fn new(default_model: impl Into<String>) -> Self {
        Self {
            default_model: default_model.into(),
            default_timeout: DEFAULT_JOB_TIMEOUT,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.default_timeout = timeout;
        self
    }
}

#[allow(dead_code)]
struct QueuedJob {
    job_id: u64,
    request: QueueJobRequest,
    result_tx: oneshot::Sender<Result<QueueJobResult, AiError>>,
    created_at: Instant,
}

struct ActiveJobTracker {
    job_id: u64,
    paragraph_id: String,
    cancel_tx: Option<oneshot::Sender<()>>,
}

struct QueueInner {
    pending: VecDeque<QueuedJob>,
    active: Option<ActiveJobTracker>,
    next_job_id: u64,
    is_shutdown: bool,
}

/// Serialized Worker Queue for managing LLM inference tasks.
///
/// Ensures only 1 task runs at any time (Concurrency = 1) to protect 8GB VRAM limits,
/// while supporting debounced replacement of stale paragraph edits, runtime model switching,
/// and per-job timeouts with robust error isolation.
#[derive(Clone)]
pub struct MicroScopingQueue {
    provider: Arc<dyn LocalLlmProvider>,
    current_model: Arc<RwLock<String>>,
    default_timeout: Duration,
    inner: Arc<Mutex<QueueInner>>,
    notify: Arc<Notify>,
    stats_processed: Arc<AtomicU64>,
    stats_cancelled: Arc<AtomicU64>,
    stats_errors: Arc<AtomicU64>,
    stats_timeouts: Arc<AtomicU64>,
    worker_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl MicroScopingQueue {
    /// Creates and starts a new MicroScopingQueue with the provided LLM provider and default model.
    pub fn new(provider: Arc<dyn LocalLlmProvider>, default_model: impl Into<String>) -> Self {
        let config = QueueConfig::new(default_model);
        Self::with_config(provider, config)
    }

    /// Creates and starts a new MicroScopingQueue with the specified configuration.
    pub fn with_config(provider: Arc<dyn LocalLlmProvider>, config: QueueConfig) -> Self {
        let current_model = Arc::new(RwLock::new(config.default_model));
        let default_timeout = config.default_timeout;
        let inner = Arc::new(Mutex::new(QueueInner {
            pending: VecDeque::new(),
            active: None,
            next_job_id: 0,
            is_shutdown: false,
        }));
        let notify = Arc::new(Notify::new());
        let stats_processed = Arc::new(AtomicU64::new(0));
        let stats_cancelled = Arc::new(AtomicU64::new(0));
        let stats_errors = Arc::new(AtomicU64::new(0));
        let stats_timeouts = Arc::new(AtomicU64::new(0));

        let worker = tokio::spawn(Self::worker_loop(
            provider.clone(),
            current_model.clone(),
            default_timeout,
            inner.clone(),
            notify.clone(),
            stats_processed.clone(),
            stats_cancelled.clone(),
            stats_errors.clone(),
            stats_timeouts.clone(),
        ));

        Self {
            provider,
            current_model,
            default_timeout,
            inner,
            notify,
            stats_processed,
            stats_cancelled,
            stats_errors,
            stats_timeouts,
            worker_handle: Arc::new(Mutex::new(Some(worker))),
        }
    }

    /// Submits a paragraph analysis job to the queue.
    ///
    /// If an existing job for the same `paragraph_id` is already pending, it is automatically
    /// cancelled and replaced by the new job (Debounce & Cancel).
    /// If a job for the same `paragraph_id` is currently executing, it is sent a cancellation signal.
    pub async fn submit(&self, req: QueueJobRequest) -> Result<QueueJobResult, AiError> {
        let (tx, rx) = oneshot::channel();

        {
            let mut inner = self.inner.lock().await;
            if inner.is_shutdown {
                return Err(AiError::ProviderUnavailable(
                    "MicroScopingQueue is shut down".to_string(),
                ));
            }

            // Debounce / Replacement in pending queue: cancel any waiting job for the same paragraph
            let mut new_pending = VecDeque::with_capacity(inner.pending.len());
            while let Some(existing) = inner.pending.pop_front() {
                if existing.request.paragraph_id == req.paragraph_id {
                    let _ = existing.result_tx.send(Err(AiError::QueueCancelled));
                    self.stats_cancelled.fetch_add(1, Ordering::SeqCst);
                    debug!(
                        "Debounced and cancelled pending job #{} for paragraph '{}'",
                        existing.job_id, req.paragraph_id
                    );
                } else {
                    new_pending.push_back(existing);
                }
            }
            inner.pending = new_pending;

            // If the active running job has the same paragraph_id, signal early cancellation
            if let Some(active) = &mut inner.active {
                if active.paragraph_id == req.paragraph_id {
                    if let Some(cancel_tx) = active.cancel_tx.take() {
                        let _ = cancel_tx.send(());
                        debug!(
                            "Signalled cancellation to active job #{} for paragraph '{}'",
                            active.job_id, req.paragraph_id
                        );
                    }
                }
            }

            inner.next_job_id += 1;
            let job_id = inner.next_job_id;
            inner.pending.push_back(QueuedJob {
                job_id,
                request: req,
                result_tx: tx,
                created_at: Instant::now(),
            });
        }

        // Notify worker
        self.notify.notify_one();

        // Await job execution result
        match rx.await {
            Ok(res) => res,
            Err(_) => Err(AiError::QueueCancelled),
        }
    }

    /// Returns reference to the underlying LLM provider.
    pub fn provider(&self) -> Arc<dyn LocalLlmProvider> {
        self.provider.clone()
    }

    /// Returns the default timeout configured for this queue.
    pub fn default_timeout(&self) -> Duration {
        self.default_timeout
    }

    /// Sets the active model dynamically without restarting the queue.
    ///
    /// Subsequent jobs will immediately use this model unless explicitly overridden per-request.
    pub async fn set_model(&self, model: impl Into<String>) {
        let model_str = model.into();
        info!("Switching MicroScopingQueue model to: {}", model_str);
        let mut m = self.current_model.write().await;
        *m = model_str;
    }

    /// Returns the currently active default model name.
    pub async fn get_model(&self) -> String {
        self.current_model.read().await.clone()
    }

    /// Explicitly cancels any pending or active jobs for a specific paragraph ID.
    pub async fn cancel_paragraph(&self, paragraph_id: &str) -> bool {
        let mut inner = self.inner.lock().await;
        let mut cancelled_any = false;

        let mut new_pending = VecDeque::with_capacity(inner.pending.len());
        while let Some(existing) = inner.pending.pop_front() {
            if existing.request.paragraph_id == paragraph_id {
                let _ = existing.result_tx.send(Err(AiError::QueueCancelled));
                self.stats_cancelled.fetch_add(1, Ordering::SeqCst);
                cancelled_any = true;
            } else {
                new_pending.push_back(existing);
            }
        }
        inner.pending = new_pending;

        if let Some(active) = &mut inner.active {
            if active.paragraph_id == paragraph_id {
                if let Some(cancel_tx) = active.cancel_tx.take() {
                    let _ = cancel_tx.send(());
                    cancelled_any = true;
                }
            }
        }

        cancelled_any
    }

    /// Clears and cancels all pending jobs currently in the queue.
    pub async fn clear(&self) {
        let mut inner = self.inner.lock().await;
        while let Some(job) = inner.pending.pop_front() {
            let _ = job.result_tx.send(Err(AiError::QueueCancelled));
            self.stats_cancelled.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Returns the number of jobs waiting in the queue.
    pub async fn pending_count(&self) -> usize {
        let inner = self.inner.lock().await;
        inner.pending.len()
    }

    /// Returns whether the worker is currently executing an inference task.
    pub async fn is_processing(&self) -> bool {
        let inner = self.inner.lock().await;
        inner.active.is_some()
    }

    /// Returns snapshot of real-time queue performance and operational metrics.
    pub async fn stats(&self) -> QueueStats {
        let inner = self.inner.lock().await;
        let active_model = self.current_model.read().await.clone();
        let current_paragraph_id = inner.active.as_ref().map(|a| a.paragraph_id.clone());
        let is_proc = inner.active.is_some();
        let pending = inner.pending.len();

        QueueStats {
            pending_jobs: pending,
            is_processing: is_proc,
            current_paragraph_id,
            active_model,
            total_processed: self.stats_processed.load(Ordering::SeqCst),
            total_cancelled: self.stats_cancelled.load(Ordering::SeqCst),
            total_errors: self.stats_errors.load(Ordering::SeqCst),
            total_timeouts: self.stats_timeouts.load(Ordering::SeqCst),
        }
    }

    /// Gracefully shuts down the queue, cancelling all pending jobs and stopping the worker.
    pub async fn shutdown(&self) {
        info!("Shutting down MicroScopingQueue worker");
        {
            let mut inner = self.inner.lock().await;
            inner.is_shutdown = true;

            // Cancel active job
            if let Some(active) = &mut inner.active {
                if let Some(cancel_tx) = active.cancel_tx.take() {
                    let _ = cancel_tx.send(());
                }
            }

            // Drain and cancel all pending jobs
            while let Some(job) = inner.pending.pop_front() {
                let _ = job.result_tx.send(Err(AiError::QueueCancelled));
                self.stats_cancelled.fetch_add(1, Ordering::SeqCst);
            }
        }

        self.notify.notify_one();

        let handle = self.worker_handle.lock().await.take();
        if let Some(h) = handle {
            let _ = h.await;
        }
    }

    /// Worker background event loop executing inference jobs one by one (Concurrency = 1).
    async fn worker_loop(
        provider: Arc<dyn LocalLlmProvider>,
        current_model: Arc<RwLock<String>>,
        default_timeout: Duration,
        inner: Arc<Mutex<QueueInner>>,
        notify: Arc<Notify>,
        stats_processed: Arc<AtomicU64>,
        stats_cancelled: Arc<AtomicU64>,
        stats_errors: Arc<AtomicU64>,
        stats_timeouts: Arc<AtomicU64>,
    ) {
        loop {
            // Check shutdown or pop next job
            let (job, cancel_rx) = {
                let mut guard = inner.lock().await;
                if guard.is_shutdown {
                    break;
                }

                if let Some(job) = guard.pending.pop_front() {
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    guard.active = Some(ActiveJobTracker {
                        job_id: job.job_id,
                        paragraph_id: job.request.paragraph_id.clone(),
                        cancel_tx: Some(cancel_tx),
                    });
                    (job, cancel_rx)
                } else {
                    guard.active = None;
                    drop(guard);
                    notify.notified().await;
                    continue;
                }
            };

            let paragraph_id = job.request.paragraph_id.clone();
            let timeout_dur = job.request.timeout.unwrap_or(default_timeout);
            let model = match job.request.model_override {
                Some(m) => m,
                None => current_model.read().await.clone(),
            };

            let start_time = Instant::now();
            let prompt = job.request.prompt;
            let system = job.request.system;
            let options = job.request.options;

            debug!(
                "Processing job #{} for paragraph '{}' with model '{}' (timeout: {:?})",
                job.job_id, paragraph_id, model, timeout_dur
            );

            let inference_fut = provider.generate(&model, &prompt, system.as_deref(), options);

            tokio::select! {
                inference_res = tokio::time::timeout(timeout_dur, inference_fut) => {
                    match inference_res {
                        Ok(Ok(response)) => {
                            let duration_ms = start_time.elapsed().as_millis() as u64;
                            stats_processed.fetch_add(1, Ordering::SeqCst);
                            debug!(
                                "Job #{} for paragraph '{}' completed in {}ms",
                                job.job_id, paragraph_id, duration_ms
                            );
                            let _ = job.result_tx.send(Ok(QueueJobResult {
                                paragraph_id: paragraph_id.clone(),
                                model_used: model,
                                response,
                                duration_ms,
                            }));
                        }
                        Ok(Err(err)) => {
                            error!(
                                "LLM inference error in job #{} for paragraph '{}': {}",
                                job.job_id, paragraph_id, err
                            );
                            stats_errors.fetch_add(1, Ordering::SeqCst);
                            let _ = job.result_tx.send(Err(err));
                        }
                        Err(_) => {
                            warn!(
                                "LLM inference timed out in job #{} for paragraph '{}' after {:?}",
                                job.job_id, paragraph_id, timeout_dur
                            );
                            stats_timeouts.fetch_add(1, Ordering::SeqCst);
                            let _ = job.result_tx.send(Err(AiError::Timeout(format!(
                                "Inference timed out after {:?}",
                                timeout_dur
                            ))));
                        }
                    }
                }
                _ = cancel_rx => {
                    debug!(
                        "Active job #{} for paragraph '{}' cancelled while running",
                        job.job_id, paragraph_id
                    );
                    stats_cancelled.fetch_add(1, Ordering::SeqCst);
                    let _ = job.result_tx.send(Err(AiError::QueueCancelled));
                }
            }

            // Clear active tracker
            {
                let mut guard = inner.lock().await;
                guard.active = None;
            }
        }
    }
}
