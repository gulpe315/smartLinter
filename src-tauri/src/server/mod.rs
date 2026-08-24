//! SmartLinter Local Bridge Server & Pairing Engine
//!
//! Provides the embedded HTTP/WebSocket bridge server for bidirectional communication
//! between the Desktop Dashboard and Editor Bridge plugins (MS Word / Adobe InDesign).

pub mod auth_manager;
pub mod conflict_dispatcher;
pub mod keyring_store;
pub mod router;
pub mod session;
pub mod ws_handler;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

pub use auth_manager::{
    constant_time_compare, generate_crypto_token, generate_nonce, generate_session_token,
    AuthError, AuthManager,
};
pub use conflict_dispatcher::{ConflictDispatcher, StaleConflictEvent};
pub use keyring_store::{
    DEFAULT_KEYRING_SERVICE, DEFAULT_KEYRING_USER, InMemoryTokenStore, KeyringStore,
    KeyringStoreError, SecureTokenStore,
};
pub use router::{create_router, ApiResponse, HealthResponse};
pub use session::{
    BridgeEventSink, BridgeStatusEvent, BroadcastEventSink, ConnectionState, EditorSession,
    NoopEventSink, SessionError, SessionManager, SessionSnapshot,
};
pub use ws_handler::close_codes;

/// Default port for the SmartLinter Local Bridge server.
pub const DEFAULT_BRIDGE_PORT: u16 = 49152;
/// Default host for the local bridge binding.
pub const DEFAULT_BRIDGE_HOST: &str = "127.0.0.1";
/// Default heartbeat timeout duration (5 seconds).
pub const DEFAULT_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);
/// Default heartbeat evaluation interval (1 second).
pub const DEFAULT_HEARTBEAT_CHECK_INTERVAL: Duration = Duration::from_secs(1);

/// Server error types.
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("I/O error during bridge server operation: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to bind to bridge address {0}: {1}")]
    BindError(String, std::io::Error),
    #[error("Server background task join error: {0}")]
    JoinError(String),
}

/// Configuration options for the local bridge server.
#[derive(Debug, Clone)]
pub struct BridgeServerConfig {
    pub host: String,
    pub port: u16,
    pub heartbeat_timeout: Duration,
    pub heartbeat_check_interval: Duration,
}

impl Default for BridgeServerConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_BRIDGE_HOST.to_string(),
            port: DEFAULT_BRIDGE_PORT,
            heartbeat_timeout: DEFAULT_HEARTBEAT_TIMEOUT,
            heartbeat_check_interval: DEFAULT_HEARTBEAT_CHECK_INTERVAL,
        }
    }
}

impl BridgeServerConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn with_host_and_port(mut self, host: impl Into<String>, port: u16) -> Self {
        self.host = host.into();
        self.port = port;
        self
    }

    pub fn with_heartbeat_timeout(mut self, timeout: Duration) -> Self {
        self.heartbeat_timeout = timeout;
        self
    }
}

/// Shared internal state passed into Axum request handlers and WebSocket routines.
#[derive(Clone)]
pub struct ServerState {
    pub auth_manager: Arc<AuthManager>,
    pub session_manager: Arc<SessionManager>,
    pub event_sink: Arc<dyn BridgeEventSink>,
    pub config: BridgeServerConfig,
}

/// Local Bridge Server instance.
pub struct BridgeServer {
    config: BridgeServerConfig,
    auth_manager: Arc<AuthManager>,
    session_manager: Arc<SessionManager>,
    event_sink: Arc<dyn BridgeEventSink>,
}

impl BridgeServer {
    /// Creates a new BridgeServer instance with configuration, auth manager, and event sink.
    pub fn new(
        config: BridgeServerConfig,
        auth_manager: Arc<AuthManager>,
        event_sink: Arc<dyn BridgeEventSink>,
    ) -> Self {
        let session_manager = Arc::new(SessionManager::new(event_sink.clone()));
        Self {
            config,
            auth_manager,
            session_manager,
            event_sink,
        }
    }

    /// Creates a server with default configuration and persistent pairing token loaded from OS Keyring.
    ///
    /// Loads or creates a token via `KeyringStore::default().get_or_create_token()`, exports it to
    /// `%LOCALAPPDATA%\SmartLinter\pairing_token.txt` for zero-friction editor plugin bootstrapping,
    /// and initializes `AuthManager` with this token.
    pub fn with_defaults(event_sink: Arc<dyn BridgeEventSink>) -> Self {
        let keyring = KeyringStore::default();
        let export_path = get_pairing_token_file_path();
        if export_path.is_none() {
            warn!("Could not determine local app data path for pairing token bootstrap export");
        }
        Self::with_token_store_and_export_path(&keyring, event_sink, export_path.as_deref())
    }

    /// Creates a server with default configuration and token resolved from a specified `SecureTokenStore`.
    ///
    /// Does not export the pairing token to the filesystem, isolating tests and custom token stores
    /// from production filesystem paths. Use [`with_defaults`] or [`with_token_store_and_export_path`]
    /// if bootstrap file export is required.
    pub fn with_token_store<S: SecureTokenStore>(
        store: &S,
        event_sink: Arc<dyn BridgeEventSink>,
    ) -> Self {
        Self::with_token_store_and_export_path(store, event_sink, None)
    }

    /// Creates a server with default configuration, token resolved from `SecureTokenStore`,
    /// and optionally exports the pairing token to a specific file path.
    pub fn with_token_store_and_export_path<S: SecureTokenStore>(
        store: &S,
        event_sink: Arc<dyn BridgeEventSink>,
        export_path: Option<&std::path::Path>,
    ) -> Self {
        let config = BridgeServerConfig::default();
        let token = store
            .get_or_create_token()
            .unwrap_or_else(|e| {
                warn!(
                    "Failed to get or create token from secure store: {}. Generating fallback crypto token.",
                    e
                );
                generate_crypto_token()
            });

        // Export token to bootstrap file only if an explicit export path is provided
        if let Some(path) = export_path {
            export_pairing_token_to_path(&token, path);
        }

        let auth_manager = Arc::new(AuthManager::with_token(token));
        Self::new(config, auth_manager, event_sink)
    }

    /// Returns reference to the server configuration.
    pub fn config(&self) -> &BridgeServerConfig {
        &self.config
    }

    /// Returns reference to the authentication manager.
    pub fn auth_manager(&self) -> Arc<AuthManager> {
        self.auth_manager.clone()
    }

    /// Returns reference to the session manager.
    pub fn session_manager(&self) -> Arc<SessionManager> {
        self.session_manager.clone()
    }

    /// Binds to the configured TCP port and starts the HTTP REST & WebSocket server.
    ///
    /// Returns a `ServerHandle` containing the bound socket address and controls for graceful shutdown.
    pub async fn start(&self) -> Result<ServerHandle, ServerError> {
        let bind_addr = format!("{}:{}", self.config.host, self.config.port);
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| ServerError::BindError(bind_addr.clone(), e))?;

        let local_addr = listener.local_addr()?;
        info!("SmartLinter Local Bridge server listening on {}", local_addr);

        let state = Arc::new(ServerState {
            auth_manager: self.auth_manager.clone(),
            session_manager: self.session_manager.clone(),
            event_sink: self.event_sink.clone(),
            config: self.config.clone(),
        });

        let app = router::create_router(state);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Spawn Axum HTTP/WebSocket server task
        let server_task: JoinHandle<Result<(), std::io::Error>> = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
        });

        // Spawn periodic heartbeat watchdog task
        let (watchdog_shutdown_tx, mut watchdog_shutdown_rx) = oneshot::channel::<()>();
        let session_mgr_watchdog = self.session_manager.clone();
        let timeout_dur = self.config.heartbeat_timeout;
        let check_interval = self.config.heartbeat_check_interval;

        let watchdog_task: JoinHandle<()> = tokio::spawn(async move {
            let mut interval = tokio::time::interval(check_interval);
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let _ = session_mgr_watchdog.check_heartbeat_timeout(timeout_dur).await;
                    }
                    _ = &mut watchdog_shutdown_rx => {
                        break;
                    }
                }
            }
        });

        Ok(ServerHandle {
            local_addr,
            port: local_addr.port(),
            auth_manager: self.auth_manager.clone(),
            session_manager: self.session_manager.clone(),
            event_sink: self.event_sink.clone(),
            shutdown_tx: Some(shutdown_tx),
            watchdog_shutdown_tx: Some(watchdog_shutdown_tx),
            server_task,
            watchdog_task,
        })
    }
}

/// Running server handle providing address info and graceful shutdown capability.
pub struct ServerHandle {
    local_addr: SocketAddr,
    port: u16,
    auth_manager: Arc<AuthManager>,
    session_manager: Arc<SessionManager>,
    event_sink: Arc<dyn BridgeEventSink>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    watchdog_shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: JoinHandle<Result<(), std::io::Error>>,
    watchdog_task: JoinHandle<()>,
}

impl ServerHandle {
    /// Returns the local bound socket address.
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Returns the bound TCP port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Returns the base HTTP URL (e.g. `http://127.0.0.1:49152`).
    pub fn http_url(&self) -> String {
        format!("http://{}", self.local_addr)
    }

    /// Returns the WebSocket URL (e.g. `ws://127.0.0.1:49152/ws`).
    pub fn ws_url(&self) -> String {
        format!("ws://{}/ws", self.local_addr)
    }

    /// Returns reference to the active auth manager.
    pub fn auth_manager(&self) -> Arc<AuthManager> {
        self.auth_manager.clone()
    }

    /// Returns reference to the active session manager.
    pub fn session_manager(&self) -> Arc<SessionManager> {
        self.session_manager.clone()
    }

    /// Returns reference to the event sink.
    pub fn event_sink(&self) -> Arc<dyn BridgeEventSink> {
        self.event_sink.clone()
    }

    /// Gracefully shuts down the bridge server and stops background tasks.
    pub async fn shutdown(mut self) -> Result<(), ServerError> {
        info!("Initiating Bridge Server graceful shutdown");

        // Clear active session and dispatch Disconnected
        self.session_manager.clear_session("Server shutdown").await;

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        if let Some(tx) = self.watchdog_shutdown_tx.take() {
            let _ = tx.send(());
        }

        let _ = self.watchdog_task.await;

        match self.server_task.await {
            Ok(Ok(())) => {
                info!("Bridge Server stopped successfully");
                Ok(())
            }
            Ok(Err(e)) => {
                error!("Server task error on shutdown: {}", e);
                Err(ServerError::Io(e))
            }
            Err(e) => {
                error!("Server join error on shutdown: {}", e);
                Err(ServerError::JoinError(e.to_string()))
            }
        }
    }
}

/// Returns the path to the local pairing token bootstrap file (`%LOCALAPPDATA%\SmartLinter\pairing_token.txt`).
pub fn get_pairing_token_file_path() -> Option<std::path::PathBuf> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let trimmed = local_app_data.trim();
        if !trimmed.is_empty() {
            return Some(
                std::path::PathBuf::from(trimmed)
                    .join("SmartLinter")
                    .join("pairing_token.txt"),
            );
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let trimmed = user_profile.trim();
        if !trimmed.is_empty() {
            return Some(
                std::path::PathBuf::from(trimmed)
                    .join("AppData")
                    .join("Local")
                    .join("SmartLinter")
                    .join("pairing_token.txt"),
            );
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(
                std::path::PathBuf::from(trimmed)
                    .join(".smartlinter")
                    .join("pairing_token.txt"),
            );
        }
    }
    None
}

/// Exports the pairing token to a specific filesystem path for editor plugin bootstrap.
pub fn export_pairing_token_to_path(token: &str, path: &std::path::Path) {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            warn!(
                "Failed to create directory {:?} for pairing token bootstrap: {}",
                parent,
                e
            );
            return;
        }
    }
    if let Err(e) = std::fs::write(path, token.trim()) {
        warn!(
            "Failed to write pairing token to {:?}: {}",
            path,
            e
        );
    } else {
        info!(
            "Pairing token bootstrap file successfully written to {:?}",
            path
        );
    }
}

/// Exports the pairing token to the default local user file (`%LOCALAPPDATA%\SmartLinter\pairing_token.txt`).
///
/// If writing fails, logs a warning without panicking or interrupting server startup.
pub fn export_pairing_token_to_file(token: &str) {
    if let Some(path) = get_pairing_token_file_path() {
        export_pairing_token_to_path(token, &path);
    } else {
        warn!("Could not determine local app data path for pairing token bootstrap export");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pairing_token_file_path_resolution() {
        let path = get_pairing_token_file_path();
        assert!(path.is_some(), "Pairing token file path should resolve in standard test environment");
        let path_buf = path.unwrap();
        assert!(
            path_buf.to_string_lossy().ends_with("pairing_token.txt"),
            "Path must end with pairing_token.txt"
        );
        assert!(
            path_buf.to_string_lossy().contains("SmartLinter") || path_buf.to_string_lossy().contains(".smartlinter"),
            "Path must contain SmartLinter directory"
        );
    }

    #[test]
    fn test_export_pairing_token_to_file_and_read_back() {
        let test_token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let temp_dir = std::env::temp_dir().join(format!("smartlinter_test_{}", rand::random::<u32>()));
        let test_file_path = temp_dir.join("pairing_token.txt");

        export_pairing_token_to_path(test_token, &test_file_path);

        assert!(test_file_path.exists(), "Exported token file must exist");
        let read_token = std::fs::read_to_string(&test_file_path).expect("File must be readable");
        assert_eq!(read_token.trim(), test_token);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_bridge_server_with_token_store() {
        let known_token = "test_custom_token_fixed_for_reconnect_testing_1234567890abcdef";
        let store = InMemoryTokenStore::with_initial_token(known_token);
        let sink = Arc::new(NoopEventSink);
        let server = BridgeServer::with_token_store(&store, sink);

        let active_token = server.auth_manager().get_token().await;
        assert_eq!(active_token, known_token);
        assert!(server.auth_manager().validate_token(known_token).await);
    }

    #[tokio::test]
    async fn test_bridge_server_with_token_store_and_export_path() {
        let known_token = "test_custom_token_for_path_export_1234567890abcdef";
        let store = InMemoryTokenStore::with_initial_token(known_token);
        let sink = Arc::new(NoopEventSink);
        let temp_dir = std::env::temp_dir().join(format!("smartlinter_test_{}", rand::random::<u32>()));
        let test_file_path = temp_dir.join("pairing_token.txt");

        let server = BridgeServer::with_token_store_and_export_path(
            &store,
            sink,
            Some(&test_file_path),
        );

        let active_token = server.auth_manager().get_token().await;
        assert_eq!(active_token, known_token);
        assert!(test_file_path.exists(), "Custom exported token file must exist");
        let read_token = std::fs::read_to_string(&test_file_path).expect("File must be readable");
        assert_eq!(read_token.trim(), known_token);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
