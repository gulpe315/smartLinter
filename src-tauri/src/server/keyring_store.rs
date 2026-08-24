//! OS Keyring & Windows Credential Manager Pairing Token Storage
//!
//! Provides secure token persistence and zero-friction auto-connect token loading
//! for SmartLinter using the `keyring-rs` backend (Windows Credential Manager on Windows).

use std::sync::{Arc, RwLock};
use keyring::Entry;
use tracing::{debug, info, warn};

use super::auth_manager::generate_crypto_token;

/// Default service identifier for SmartLinter in Windows Credential Manager / OS Keyring.
pub const DEFAULT_KEYRING_SERVICE: &str = "SmartLinter";

/// Default credential account name for storing the bridge pairing token.
pub const DEFAULT_KEYRING_USER: &str = "smartlinter_pairing_token";

/// Errors that can occur during OS Keyring operations.
#[derive(Debug, thiserror::Error)]
pub enum KeyringStoreError {
    #[error("Keyring OS backend error: {0}")]
    KeyringError(#[from] keyring::Error),
    #[error("Invalid token format: {0}")]
    InvalidToken(String),
    #[error("Secure storage unavailable: {0}")]
    StorageUnavailable(String),
}

/// Abstract interface for secure token storage.
pub trait SecureTokenStore: Send + Sync {
    /// Retrieves the stored pairing token from secure storage, or returns None if not found.
    fn get_token(&self) -> Result<Option<String>, KeyringStoreError>;

    /// Persists a pairing token into secure storage.
    fn set_token(&self, token: &str) -> Result<(), KeyringStoreError>;

    /// Deletes the pairing token from secure storage.
    fn delete_token(&self) -> Result<(), KeyringStoreError>;

    /// Loads the stored pairing token if present, or generates and securely saves a new one.
    fn get_or_create_token(&self) -> Result<String, KeyringStoreError> {
        if let Some(existing) = self.get_token()? {
            let trimmed = existing.trim().to_string();
            if !trimmed.is_empty() {
                debug!("Loaded existing pairing token from secure keyring storage");
                return Ok(trimmed);
            }
        }

        let new_token = generate_crypto_token();
        info!("Generated new pairing token and storing in secure keyring");
        self.set_token(&new_token)?;
        Ok(new_token)
    }
}

/// OS Keyring Token Store (backed by Windows Credential Manager on Windows).
#[derive(Debug, Clone)]
pub struct KeyringStore {
    service: String,
    user: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringStore {
    /// Creates a new KeyringStore with default SmartLinter service and user accounts.
    pub fn new() -> Self {
        Self::with_service_and_user(DEFAULT_KEYRING_SERVICE, DEFAULT_KEYRING_USER)
    }

    /// Creates a KeyringStore with custom service and account names (useful for testing).
    pub fn with_service_and_user(service: impl Into<String>, user: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            user: user.into(),
        }
    }

    /// Returns the configured service name.
    pub fn service(&self) -> &str {
        &self.service
    }

    /// Returns the configured account/user name.
    pub fn user(&self) -> &str {
        &self.user
    }

    /// Helper to get the underlying keyring entry.
    fn get_entry(&self) -> Result<Entry, KeyringStoreError> {
        Entry::new(&self.service, &self.user).map_err(KeyringStoreError::KeyringError)
    }
}

impl SecureTokenStore for KeyringStore {
    fn get_token(&self) -> Result<Option<String>, KeyringStoreError> {
        let entry = self.get_entry()?;
        match entry.get_password() {
            Ok(token) => {
                let trimmed = token.trim();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed.to_string()))
                }
            }
            Err(keyring::Error::NoEntry) => {
                debug!(
                    "No existing keyring entry found for service='{}', user='{}'",
                    self.service, self.user
                );
                Ok(None)
            }
            Err(e) => {
                warn!(
                    "Failed to read from OS keyring (service='{}', user='{}'): {}",
                    self.service, self.user, e
                );
                Err(KeyringStoreError::KeyringError(e))
            }
        }
    }

    fn set_token(&self, token: &str) -> Result<(), KeyringStoreError> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return Err(KeyringStoreError::InvalidToken(
                "Pairing token cannot be empty".to_string(),
            ));
        }

        let entry = self.get_entry()?;
        entry
            .set_password(trimmed)
            .map_err(KeyringStoreError::KeyringError)?;

        debug!(
            "Successfully saved pairing token into OS keyring for service='{}', user='{}'",
            self.service, self.user
        );
        Ok(())
    }

    fn delete_token(&self) -> Result<(), KeyringStoreError> {
        let entry = self.get_entry()?;
        match entry.delete_credential() {
            Ok(()) => {
                debug!(
                    "Successfully deleted keyring entry for service='{}', user='{}'",
                    self.service, self.user
                );
                Ok(())
            }
            Err(keyring::Error::NoEntry) => {
                debug!("Keyring entry to delete did not exist");
                Ok(())
            }
            Err(e) => Err(KeyringStoreError::KeyringError(e)),
        }
    }
}

/// In-memory token store for testing or environments where OS Keyring is unavailable.
#[derive(Debug, Default, Clone)]
pub struct InMemoryTokenStore {
    token: Arc<RwLock<Option<String>>>,
}

impl InMemoryTokenStore {
    pub fn new() -> Self {
        Self {
            token: Arc::new(RwLock::new(None)),
        }
    }

    pub fn with_initial_token(token: impl Into<String>) -> Self {
        Self {
            token: Arc::new(RwLock::new(Some(token.into()))),
        }
    }
}

impl SecureTokenStore for InMemoryTokenStore {
    fn get_token(&self) -> Result<Option<String>, KeyringStoreError> {
        let guard = self.token.read().map_err(|e| {
            KeyringStoreError::StorageUnavailable(format!("RwLock poison error: {}", e))
        })?;
        Ok(guard.clone())
    }

    fn set_token(&self, token: &str) -> Result<(), KeyringStoreError> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return Err(KeyringStoreError::InvalidToken(
                "Pairing token cannot be empty".to_string(),
            ));
        }
        let mut guard = self.token.write().map_err(|e| {
            KeyringStoreError::StorageUnavailable(format!("RwLock poison error: {}", e))
        })?;
        *guard = Some(trimmed.to_string());
        Ok(())
    }

    fn delete_token(&self) -> Result<(), KeyringStoreError> {
        let mut guard = self.token.write().map_err(|e| {
            KeyringStoreError::StorageUnavailable(format!("RwLock poison error: {}", e))
        })?;
        *guard = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_token_store_lifecycle() {
        let store = InMemoryTokenStore::new();

        // 1. Initial state is empty
        assert_eq!(store.get_token().unwrap(), None);

        // 2. get_or_create_token generates a valid 64-char token
        let token = store.get_or_create_token().unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(store.get_token().unwrap(), Some(token.clone()));

        // 3. Subsequent get_or_create_token returns identical existing token
        let token2 = store.get_or_create_token().unwrap();
        assert_eq!(token, token2);

        // 4. Overwrite token
        store.set_token("custom_secret_token_12345").unwrap();
        assert_eq!(
            store.get_token().unwrap(),
            Some("custom_secret_token_12345".to_string())
        );

        // 5. Delete token
        store.delete_token().unwrap();
        assert_eq!(store.get_token().unwrap(), None);

        // 6. Setting empty token returns error
        assert!(store.set_token("   ").is_err());
    }

    #[test]
    fn test_keyring_store_windows_credential_manager_roundtrip() {
        // Use an isolated test user key to prevent test collisions
        let test_user = format!("test_token_{}", rand::random::<u32>());
        let store = KeyringStore::with_service_and_user("SmartLinterTest", test_user);

        // Cleanup before test in case of prior residue
        let _ = store.delete_token();

        // 1. Initially should be None
        let initial = store.get_token().expect("get_token should succeed");
        assert_eq!(initial, None);

        // 2. Get or create should generate and store
        let created_token = store
            .get_or_create_token()
            .expect("get_or_create_token should succeed");
        assert_eq!(created_token.len(), 64);

        // 3. Fetching again should return the persisted token
        let fetched_token = store
            .get_token()
            .expect("get_token should succeed")
            .expect("token should exist in keyring");
        assert_eq!(created_token, fetched_token);

        // 4. Delete the test token
        store.delete_token().expect("delete_token should succeed");
        assert_eq!(store.get_token().unwrap(), None);

        // 5. Deleting nonexistent token should be idempotent Ok(())
        assert!(store.delete_token().is_ok());
    }
}
