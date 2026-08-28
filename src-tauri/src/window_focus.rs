//! Best-effort native window activation for a running Microsoft Word instance.
//!
//! Office.js cannot activate the Word desktop window on older WordApiDesktop builds.
//! This module deliberately keeps native activation optional: a missing window or an
//! OS foreground-policy rejection must never affect the completed locate operation.

#[cfg(windows)]
mod platform {
    use std::collections::HashSet;

    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    const MAX_PATH: usize = 260;
    const WORD_WINDOW_CLASS: &str = "OpusApp";

    fn running_word_process_ids() -> Result<HashSet<u32>, String> {
        let snapshot =
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|error| {
                format!("Cannot create process snapshot while locating Microsoft Word: {error}")
            })?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut process_ids = HashSet::new();
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
        while has_entry {
            let length = entry
                .szExeFile
                .iter()
                .position(|&character| character == 0)
                .unwrap_or(MAX_PATH);
            if String::from_utf16_lossy(&entry.szExeFile[..length])
                .eq_ignore_ascii_case("WINWORD.EXE")
            {
                process_ids.insert(entry.th32ProcessID);
            }
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            has_entry = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
        }

        unsafe { CloseHandle(snapshot) }
            .map_err(|error| format!("Cannot close Word process snapshot: {error}"))?;
        Ok(process_ids)
    }

    struct WindowSearch<'a> {
        word_process_ids: &'a HashSet<u32>,
        window: Option<HWND>,
    }

    unsafe extern "system" fn find_word_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut WindowSearch<'_>) };
        if !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return BOOL(1);
        }

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        if !search.word_process_ids.contains(&process_id) {
            return BOOL(1);
        }

        let mut class_name = [0_u16; 256];
        let length = unsafe { GetClassNameW(hwnd, &mut class_name) };
        if length > 0
            && String::from_utf16_lossy(&class_name[..length as usize]) == WORD_WINDOW_CLASS
        {
            search.window = Some(hwnd);
            return BOOL(0);
        }
        BOOL(1)
    }

    /// Restores and foregrounds a visible top-level Word window, if one is available.
    ///
    /// `Ok(false)` means Word is not running or has no matching visible window. An `Err`
    /// indicates an OS/API failure, including foreground activation being denied.
    pub fn focus_word_window() -> Result<bool, String> {
        let word_process_ids = running_word_process_ids()?;
        focus_word_process_windows(&word_process_ids)
    }

    fn focus_word_process_windows(word_process_ids: &HashSet<u32>) -> Result<bool, String> {
        if word_process_ids.is_empty() {
            return Ok(false);
        }

        let mut search = WindowSearch {
            word_process_ids,
            window: None,
        };
        unsafe {
            EnumWindows(
                Some(find_word_window),
                LPARAM((&mut search as *mut WindowSearch<'_>) as isize),
            )
        }
        .map_err(|error| {
            format!("Cannot enumerate top-level windows while locating Microsoft Word: {error}")
        })?;

        let Some(window) = search.window else {
            return Ok(false);
        };
        if unsafe { IsIconic(window).as_bool() } {
            let _ = unsafe { ShowWindow(window, SW_RESTORE) };
        }
        if !unsafe { SetForegroundWindow(window).as_bool() } {
            return Err(
                "Windows denied foreground activation for the located Word window".to_string(),
            );
        }
        Ok(true)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn no_word_process_is_a_non_fatal_noop() {
            assert_eq!(focus_word_process_windows(&HashSet::new()), Ok(false));
        }
    }
}

#[cfg(windows)]
pub use platform::focus_word_window;

#[cfg(not(windows))]
pub fn focus_word_window() -> Result<bool, String> {
    Err("Native Word window activation is only supported on Windows".to_string())
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn non_windows_stub_returns_a_safe_error() {
        assert!(focus_word_window().is_err());
    }
}
