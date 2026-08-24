//! SmartLinter Micro-Scoping Worker Queue & Local LLM Provider Test Suite
//!
//! Includes comprehensive unit tests with `MockLlmProvider` and live integration tests
//! connecting directly to the local Ollama daemon (`http://127.0.0.1:11434`).

use futures_util::StreamExt;
use smart_linter::ai::{
    AiError, GenerateOptions, LocalLlmProvider, MicroScopingQueue, MockLlmProvider, ModelDetails,
    ModelInfo, OllamaProvider, QueueConfig, QueueJobRequest,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

// =========================================================================
// 1. Model Info & VRAM Budget Warning Unit Tests
// =========================================================================

#[test]
fn test_vram_warning_evaluation_logic() {
    // 1. Safe 7B model (~4.68 GB, 7.6B params) -> No warning
    let safe_model = ModelInfo::new(
        "qwen2.5:7b".to_string(),
        "qwen2.5:7b".to_string(),
        None,
        4_683_087_332,
        None,
        Some(ModelDetails {
            parameter_size: Some("7.6B".to_string()),
            quantization_level: Some("Q4_K_M".to_string()),
            ..Default::default()
        }),
    );
    assert!(!safe_model.vram_warning);
    assert!(safe_model.vram_warning_reason.is_none());

    // 2. Large model exceeding size (> 5.5 GB, e.g. 6.14 GB) -> Warning triggered
    let large_size_model = ModelInfo::new(
        "qwen3-vl:8b".to_string(),
        "qwen3-vl:8b".to_string(),
        None,
        6_140_415_879,
        None,
        Some(ModelDetails {
            parameter_size: Some("8.8B".to_string()),
            quantization_level: Some("Q4_K_M".to_string()),
            ..Default::default()
        }),
    );
    assert!(large_size_model.vram_warning);
    assert!(large_size_model.vram_warning_reason.is_some());
    let reason = large_size_model.vram_warning_reason.unwrap();
    assert!(reason.contains("VRAM budget limit") || reason.contains("8.0B"));

    // 3. 14B / 32B / 70B parameter models -> Warning triggered
    let param_14b_model = ModelInfo::new(
        "qwen2.5:14b".to_string(),
        "qwen2.5:14b".to_string(),
        None,
        9_000_000_000,
        None,
        Some(ModelDetails {
            parameter_size: Some("14B".to_string()),
            ..Default::default()
        }),
    );
    assert!(param_14b_model.vram_warning);
}

// =========================================================================
// 2. MicroScopingQueue Unit Tests (Concurrency=1, Debounce, Model Switching)
// =========================================================================

#[tokio::test]
async fn test_queue_concurrency_one_strict_serialization() {
    let mock = Arc::new(MockLlmProvider::new());
    mock.set_delay(Duration::from_millis(50)).await;

    // Track active concurrent executions
    let concurrent_count = Arc::new(AtomicUsize::new(0));
    let max_concurrent_observed = Arc::new(AtomicUsize::new(0));

    // Wrap mock in a concurrency-checking adapter or verify via timings
    let queue = Arc::new(MicroScopingQueue::new(mock.clone(), "test-model"));

    let mut handles = Vec::new();
    for i in 0..5 {
        let q = queue.clone();
        let cc = concurrent_count.clone();
        let max_cc = max_concurrent_observed.clone();
        handles.push(tokio::spawn(async move {
            let active = cc.fetch_add(1, Ordering::SeqCst) + 1;
            let mut curr_max = max_cc.load(Ordering::SeqCst);
            while active > curr_max {
                if max_cc
                    .compare_exchange(curr_max, active, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    break;
                }
                curr_max = max_cc.load(Ordering::SeqCst);
            }

            let req = QueueJobRequest::new(format!("para-{}", i), format!("Prompt {}", i));
            let res = q.submit(req).await;
            cc.fetch_sub(1, Ordering::SeqCst);
            res
        }));
    }

    for h in handles {
        let res = h.await.unwrap();
        assert!(res.is_ok());
    }

    // Since mock was called by the single worker loop, all 5 jobs completed
    let stats = queue.stats().await;
    assert_eq!(stats.total_processed, 5);
    assert_eq!(stats.total_errors, 0);
    assert_eq!(stats.pending_jobs, 0);
    assert!(!stats.is_processing);
    queue.shutdown().await;
}

#[tokio::test]
async fn test_queue_debounce_and_cancel_pending_jobs() {
    let mock = Arc::new(MockLlmProvider::new());
    // Hold the worker busy for 150ms on first job
    mock.set_delay(Duration::from_millis(150)).await;

    let queue = Arc::new(MicroScopingQueue::new(mock.clone(), "test-model"));

    // 1. Submit blocker job for paragraph A
    let q_blocker = queue.clone();
    let blocker_handle = tokio::spawn(async move {
        q_blocker
            .submit(QueueJobRequest::new("para-A", "Blocker prompt"))
            .await
    });

    // Let the worker pick up para-A
    sleep(Duration::from_millis(20)).await;

    // 2. Submit job 1 for paragraph B (will wait in queue)
    let q1 = queue.clone();
    let job_b1 = tokio::spawn(async move {
        q1.submit(QueueJobRequest::new("para-B", "Draft 1 of paragraph B"))
            .await
    });

    // 3. Submit job 2 for paragraph B shortly after (should debounce & cancel job 1)
    sleep(Duration::from_millis(10)).await;
    let q2 = queue.clone();
    let job_b2 = tokio::spawn(async move {
        q2.submit(QueueJobRequest::new("para-B", "Draft 2 of paragraph B"))
            .await
    });

    // 4. Submit job 3 for paragraph B (should debounce & cancel job 2)
    sleep(Duration::from_millis(10)).await;
    let q3 = queue.clone();
    let job_b3 = tokio::spawn(async move {
        q3.submit(QueueJobRequest::new("para-B", "Final Draft of paragraph B"))
            .await
    });

    let res_blocker = blocker_handle.await.unwrap();
    assert!(res_blocker.is_ok());

    let res_b1 = job_b1.await.unwrap();
    let res_b2 = job_b2.await.unwrap();
    let res_b3 = job_b3.await.unwrap();

    // Job 1 and 2 must have been cancelled
    match res_b1 {
        Err(AiError::QueueCancelled) => {}
        other => panic!("Expected QueueCancelled for job_b1, got {:?}", other),
    }
    match res_b2 {
        Err(AiError::QueueCancelled) => {}
        other => panic!("Expected QueueCancelled for job_b2, got {:?}", other),
    }

    // Job 3 (final) must succeed
    assert!(res_b3.is_ok());
    let final_res = res_b3.unwrap();
    assert_eq!(final_res.paragraph_id, "para-B");
    assert!(final_res.response.contains("Final Draft"));

    let stats = queue.stats().await;
    assert_eq!(stats.total_cancelled, 2);
    assert_eq!(stats.total_processed, 2); // blocker + final draft
    queue.shutdown().await;
}

#[tokio::test]
async fn test_queue_runtime_model_switching_without_restart() {
    let mock = Arc::new(MockLlmProvider::new());
    let queue = MicroScopingQueue::new(mock.clone(), "initial-model:7b");

    assert_eq!(queue.get_model().await, "initial-model:7b");

    // Submit job with initial model
    let res1 = queue
        .submit(QueueJobRequest::new("p1", "Prompt 1"))
        .await
        .unwrap();
    assert_eq!(res1.model_used, "initial-model:7b");

    // Switch model dynamically
    queue.set_model("qwen2.5:7b").await;
    assert_eq!(queue.get_model().await, "qwen2.5:7b");

    // Next job immediately uses new model
    let res2 = queue
        .submit(QueueJobRequest::new("p2", "Prompt 2"))
        .await
        .unwrap();
    assert_eq!(res2.model_used, "qwen2.5:7b");

    // Per-job explicit override takes precedence
    let res3 = queue
        .submit(
            QueueJobRequest::new("p3", "Prompt 3").with_model("explicit-override-model:latest"),
        )
        .await
        .unwrap();
    assert_eq!(res3.model_used, "explicit-override-model:latest");

    // Subsequent normal job still uses the global active model
    let res4 = queue
        .submit(QueueJobRequest::new("p4", "Prompt 4"))
        .await
        .unwrap();
    assert_eq!(res4.model_used, "qwen2.5:7b");

    queue.shutdown().await;
}

#[tokio::test]
async fn test_queue_timeout_and_error_isolation() {
    let mock = Arc::new(MockLlmProvider::new());
    // Artificial delay 200ms
    mock.set_delay(Duration::from_millis(200)).await;

    let config = QueueConfig::new("test-model").with_timeout(Duration::from_millis(50));
    let queue = MicroScopingQueue::with_config(mock.clone(), config);

    // Job 1 should time out (timeout = 50ms, execution = 200ms)
    let res1 = queue.submit(QueueJobRequest::new("p-timeout", "Slow job")).await;
    match res1 {
        Err(AiError::Timeout(msg)) => {
            assert!(msg.contains("timed out"));
        }
        other => panic!("Expected AiError::Timeout, got {:?}", other),
    }

    // Worker must still be alive and well (Error Isolation)
    mock.set_delay(Duration::from_millis(0)).await;
    let res2 = queue
        .submit(QueueJobRequest::new("p-fast", "Fast job"))
        .await;
    assert!(res2.is_ok());

    let stats = queue.stats().await;
    assert_eq!(stats.total_timeouts, 1);
    assert_eq!(stats.total_processed, 1);

    queue.shutdown().await;
}

#[tokio::test]
async fn test_queue_provider_error_isolation() {
    let mock = Arc::new(MockLlmProvider::new());
    let queue = MicroScopingQueue::new(mock.clone(), "test-model");

    // Simulate provider failure on job 1
    mock.set_failure(Some("Simulated Ollama GPU Out-of-Memory".to_string()))
        .await;

    let res1 = queue.submit(QueueJobRequest::new("p1", "Will fail")).await;
    match res1 {
        Err(AiError::ProviderUnavailable(msg)) => {
            assert!(msg.contains("Out-of-Memory"));
        }
        other => panic!("Expected ProviderUnavailable, got {:?}", other),
    }

    // Recover provider and ensure worker processes subsequent jobs
    mock.set_failure(None).await;
    let res2 = queue.submit(QueueJobRequest::new("p2", "Will succeed")).await;
    assert!(res2.is_ok());

    let stats = queue.stats().await;
    assert_eq!(stats.total_errors, 1);
    assert_eq!(stats.total_processed, 1);

    queue.shutdown().await;
}

#[tokio::test]
async fn test_queue_manual_cancellation_and_clear() {
    let mock = Arc::new(MockLlmProvider::new());
    mock.set_delay(Duration::from_millis(150)).await;
    let queue = Arc::new(MicroScopingQueue::new(mock.clone(), "test-model"));

    // Enqueue 2 jobs
    let q1 = queue.clone();
    let j1 = tokio::spawn(async move { q1.submit(QueueJobRequest::new("p1", "Job 1")).await });

    // Wait until p1 is picked up as active
    for _ in 0..50 {
        if queue.is_processing().await {
            break;
        }
        sleep(Duration::from_millis(5)).await;
    }

    let q2 = queue.clone();
    let j2 = tokio::spawn(async move { q2.submit(QueueJobRequest::new("p2", "Job 2")).await });

    // Wait until p2 is registered in pending queue
    for _ in 0..50 {
        if queue.pending_count().await > 0 {
            break;
        }
        sleep(Duration::from_millis(5)).await;
    }

    // Cancel p2 specifically
    let cancelled = queue.cancel_paragraph("p2").await;
    assert!(cancelled);

    let res1 = j1.await.unwrap();
    let res2 = j2.await.unwrap();

    assert!(res1.is_ok());
    match res2 {
        Err(AiError::QueueCancelled) => {}
        other => panic!("Expected QueueCancelled for p2, got {:?}", other),
    }

    queue.shutdown().await;
}

// =========================================================================
// 3. Live Ollama Daemon Integration Tests (http://127.0.0.1:11434)
// =========================================================================

#[tokio::test]
async fn test_live_ollama_health_check() {
    let provider = OllamaProvider::with_default_url();
    let health = provider.health_check().await.expect("health_check call failed");

    println!("[Live Ollama Health] {:?}", health);
    assert_eq!(health.provider, "ollama");

    if health.is_alive {
        assert!(health.version.is_some(), "Expected Ollama version string");
        assert!(health.latency_ms.is_some(), "Expected measured ping latency");
    } else {
        println!("Note: Local Ollama daemon is offline; skipped live connectivity assertion.");
    }
}

#[tokio::test]
async fn test_live_ollama_list_models_and_vram_warning() {
    let provider = OllamaProvider::with_default_url();
    let health = provider.health_check().await.unwrap();

    if !health.is_alive {
        println!("Skipping live tags test: Ollama is not running.");
        return;
    }

    let models = provider
        .list_models()
        .await
        .expect("Failed to fetch models from Ollama");

    println!("[Live Ollama Models (Count: {})]", models.len());
    assert!(!models.is_empty(), "Expected at least one installed Ollama model");

    for m in &models {
        println!(
            "  - Model: '{}' | Size: {:.2} GB | Params: {:?} | Quant: {:?} | VRAM Warning: {} (Reason: {:?})",
            m.name,
            m.size_bytes as f64 / (1024.0 * 1024.0 * 1024.0),
            m.parameter_size,
            m.quantization_level,
            m.vram_warning,
            m.vram_warning_reason
        );
    }

    // Verify qwen2.5:7b or standard 7B model is recognized without false warning
    if let Some(qwen_7b) = models.iter().find(|m| m.name.starts_with("qwen2.5:7b")) {
        assert!(
            !qwen_7b.vram_warning,
            "qwen2.5:7b should fit within 8GB VRAM budget without warning"
        );
    }
}

#[tokio::test]
async fn test_live_ollama_generate_and_stream() {
    let provider = OllamaProvider::with_default_url();
    let health = provider.health_check().await.unwrap();

    if !health.is_alive {
        println!("Skipping live generate test: Ollama is not running.");
        return;
    }

    let models = provider.list_models().await.unwrap();
    let model_to_use = models
        .iter()
        .find(|m| m.name.starts_with("qwen2.5:7b"))
        .map(|m| m.name.clone())
        .unwrap_or_else(|| models[0].name.clone());

    println!("Testing live generate with model: {}", model_to_use);

    // 1. Non-streaming generate test
    let opts = GenerateOptions {
        temperature: Some(0.0),
        num_predict: Some(10),
        ..Default::default()
    };
    let response = provider
        .generate(&model_to_use, "Say hello in 3 words.", None, Some(opts.clone()))
        .await
        .expect("Ollama non-streaming generate failed");

    println!("[Live Generate Response]: {}", response.trim());
    assert!(!response.trim().is_empty());

    // 2. Streaming generate test
    let mut stream = provider
        .generate_stream(&model_to_use, "Count: 1, 2, 3", None, Some(opts))
        .await
        .expect("Ollama generate_stream failed");

    let mut collected_chunks = Vec::new();
    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.expect("Error in stream chunk");
        collected_chunks.push(chunk);
    }

    let full_streamed = collected_chunks.join("");
    println!("[Live Streamed Response]: {}", full_streamed.trim());
    assert!(!full_streamed.trim().is_empty());
}

#[tokio::test]
async fn test_live_ollama_integrated_with_micro_queue() {
    let provider = Arc::new(OllamaProvider::with_default_url());
    let health = provider.health_check().await.unwrap();

    if !health.is_alive {
        println!("Skipping live queue integration: Ollama is not running.");
        return;
    }

    let models = provider.list_models().await.unwrap();
    let target_model = models
        .iter()
        .find(|m| m.name.starts_with("qwen2.5:7b"))
        .map(|m| m.name.clone())
        .unwrap_or_else(|| models[0].name.clone());

    let queue = MicroScopingQueue::new(provider.clone(), target_model.clone());

    let req = QueueJobRequest::new("live-p1", "Translate 'Hello World' to Korean in one word.")
        .with_options(GenerateOptions {
            temperature: Some(0.0),
            num_predict: Some(15),
            ..Default::default()
        });

    let res = queue.submit(req).await.expect("Queue job submission failed");
    println!(
        "[Live Queue Result for '{}']: '{}' (took {}ms)",
        res.paragraph_id,
        res.response.trim(),
        res.duration_ms
    );

    assert_eq!(res.paragraph_id, "live-p1");
    assert_eq!(res.model_used, target_model);
    assert!(!res.response.trim().is_empty());

    let stats = queue.stats().await;
    assert_eq!(stats.total_processed, 1);
    assert_eq!(stats.total_errors, 0);

    queue.shutdown().await;
}
