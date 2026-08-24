//! Tauri Command Handlers for SmartLinter
//!
//! Provides frontend IPC commands, including window always-on-top pin mode.

use tauri::WebviewWindow;

/// Sets the always-on-top (Pin Mode) state for the application window.
#[tauri::command]
pub async fn set_always_on_top(window: WebviewWindow, pinned: bool) -> Result<bool, String> {
    window
        .set_always_on_top(pinned)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    Ok(pinned)
}
