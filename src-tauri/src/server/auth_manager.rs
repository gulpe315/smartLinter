//! Authentication & Pairing Token Engine
//!
//! Generates and verifies 32-byte (256-bit) cryptographically secure random pairing tokens
//! for zero-friction auto-connection and authenticating editor plugins.

use std::sync::Arc;
use rand::RngCore;
use tokio::sync::RwLock;

use crate::protocol::{AuthHandshake, AuthResponse};

/// Error types related to bridge authentication.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("Missing authentication token")]
    MissingToken,
    #[error("Invalid authentication token")]
    Unauthorized,
    #[error("Invalid handshake payload: {0}")]
    InvalidPayload(String),
}

/// Constant-time byte slice comparison to prevent timing attacks.
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Generates a 32-byte (256-bit) cryptographically secure random hex string (64 hex characters).
pub fn generate_crypto_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generates a random cryptographic nonce (16 bytes = 32 hex chars).
pub fn generate_nonce() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generates a unique session token (16 bytes = 32 hex chars).
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Thread-safe pairing token & authentication manager.
#[derive(Debug, Clone)]
pub struct AuthManager {
    pairing_token: Arc<RwLock<String>>,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthManager {
    /// Creates a new AuthManager with a freshly generated 32-byte crypto token.
    pub fn new() -> Self {
        Self {
            pairing_token: Arc::new(RwLock::new(generate_crypto_token())),
        }
    }

    /// Creates an AuthManager with a specified pairing token (useful for test fixtures or keychain loading).
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            pairing_token: Arc::new(RwLock::new(token.into())),
        }
    }

    /// Returns the current pairing token string.
    pub async fn get_token(&self) -> String {
        self.pairing_token.read().await.clone()
    }

    /// Rotates the current pairing token with a new 32-byte crypto token.
    pub async fn rotate_token(&self) -> String {
        let new_token = generate_crypto_token();
        let mut write_guard = self.pairing_token.write().await;
        *write_guard = new_token.clone();
        new_token
    }

    /// Validates an input token against the active pairing token using constant-time comparison.
    pub async fn validate_token(&self, candidate: &str) -> bool {
        let current = self.pairing_token.read().await;
        constant_time_compare(current.as_bytes(), candidate.as_bytes())
    }

    /// Verifies an editor handshake request.
    ///
    /// If valid, returns an `AuthResponse` with `success = true`, a newly allocated `session_token`,
    /// and a fresh server nonce. If invalid, returns `Err(AuthError::Unauthorized)`.
    pub async fn verify_handshake(&self, handshake: &AuthHandshake) -> Result<AuthResponse, AuthError> {
        if handshake.token.trim().is_empty() {
            return Err(AuthError::MissingToken);
        }

        if !self.validate_token(&handshake.token).await {
            return Err(AuthError::Unauthorized);
        }

        let session_token = generate_session_token();
        let server_nonce = generate_nonce();

        Ok(AuthResponse {
            success: true,
            session_token: Some(session_token),
            server_nonce: Some(server_nonce),
            message: Some(format!(
                "Successfully authenticated {} plugin v{}",
                handshake.editor_type, handshake.version
            )),
        })
    }

    /// Helper to extract and validate token from HTTP headers or query parameters.
    pub async fn validate_bearer_or_raw(&self, token_candidate: Option<&str>) -> bool {
        match token_candidate {
            Some(candidate) => {
                let clean_token = candidate.strip_prefix("Bearer ").unwrap_or(candidate).trim();
                if clean_token.is_empty() {
                    false
                } else {
                    self.validate_token(clean_token).await
                }
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::EditorType;

    #[tokio::test]
    async fn test_generate_crypto_token_length_and_uniqueness() {
        let token1 = generate_crypto_token();
        let token2 = generate_crypto_token();

        assert_eq!(token1.len(), 64, "32-byte hex token must be exactly 64 characters");
        assert_eq!(token2.len(), 64);
        assert_ne!(token1, token2, "Consecutive tokens must be cryptographically distinct");
    }

    #[tokio::test]
    async fn test_auth_manager_validation_success_and_failure() {
        let auth = AuthManager::new();
        let valid_token = auth.get_token().await;

        assert!(auth.validate_token(&valid_token).await);
        assert!(!auth.validate_token("invalid_token_12345").await);
        assert!(!auth.validate_token("").await);
    }

    #[tokio::test]
    async fn test_auth_manager_handshake_flow() {
        let auth = AuthManager::new();
        let valid_token = auth.get_token().await;

        let valid_handshake = AuthHandshake {
            token: valid_token,
            editor_type: EditorType::Word,
            version: "0.1.0".to_string(),
            client_nonce: generate_nonce(),
        };

        let response = auth.verify_handshake(&valid_handshake).await.expect("Handshake should succeed");
        assert!(response.success);
        assert!(response.session_token.is_some());
        assert!(response.server_nonce.is_some());

        let invalid_handshake = AuthHandshake {
            token: "wrong_token".to_string(),
            editor_type: EditorType::InDesign,
            version: "0.1.0".to_string(),
            client_nonce: generate_nonce(),
        };

        let err = auth.verify_handshake(&invalid_handshake).await.unwrap_err();
        assert_eq!(err, AuthError::Unauthorized);
    }

    #[tokio::test]
    async fn test_token_rotation() {
        let auth = AuthManager::new();
        let old_token = auth.get_token().await;
        let new_token = auth.rotate_token().await;

        assert_ne!(old_token, new_token);
        assert!(!auth.validate_token(&old_token).await);
        assert!(auth.validate_token(&new_token).await);
    }
}
