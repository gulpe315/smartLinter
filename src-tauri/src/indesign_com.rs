//! Windows COM attachment for a running Adobe InDesign instance.
//!
//! InDesign 2026 does not register its automation object in the Running Object Table (ROT),
//! so attachment uses `CoCreateInstance`. A process-snapshot guard is mandatory before that
//! call: it prevents COM from launching InDesign when no instance is already running.

#[cfg(not(windows))]
use std::path::Path;
use serde::{Deserialize, Serialize};

/// Minimal response returned by InDesign's read-only paragraph locator.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocateParagraphResult {
    pub command_id: String,
    pub status: String,
    pub message: String,
}

/// Current contents returned by InDesign's non-invasive live paragraph snapshot.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveParagraphSnapshotResult {
    pub command_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// One entry returned by InDesign's non-invasive batch live paragraph snapshot.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveParagraphSnapshotEntry {
    pub paragraph_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[cfg(windows)]
mod platform {
    use super::{LiveParagraphSnapshotEntry, LiveParagraphSnapshotResult, LocateParagraphResult};
    use std::ffi::c_void;
    use std::path::Path;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use windows::core::{BSTR, GUID, PCWSTR, VARIANT};
    use crate::protocol::{DocumentGenerationParagraphPlan, EnumerateDocumentResponse, GenerateTranslatedDocumentResponse, ReplacementCommand, ReplacementResult};
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, RPC_E_CALL_REJECTED,
        RPC_E_CHANGED_MODE, RPC_E_SERVERCALL_RETRYLATER,
    };
    use windows::Win32::System::Com::{
        CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, DISPATCH_METHOD, DISPPARAMS, EXCEPINFO,
    };

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const MAX_PATH: usize = 260;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const MAX_PROCESS_IMAGE_PATH: usize = 32_768;

    #[repr(C)]
    struct VsFixedFileInfo {
        dw_signature: u32,
        dw_struc_version: u32,
        dw_file_version_ms: u32,
        dw_file_version_ls: u32,
        dw_product_version_ms: u32,
        dw_product_version_ls: u32,
        dw_file_flags_mask: u32,
        dw_file_flags: u32,
        dw_file_os: u32,
        dw_file_type: u32,
        dw_file_subtype: u32,
        dw_file_date_ms: u32,
        dw_file_date_ls: u32,
    }

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; MAX_PATH],
    }

    // These Tool Help APIs are declared here because this crate's `windows` dependency does
    // not enable its optional `Win32_System_Diagnostics_ToolHelp` feature. The HANDLE and
    // error types remain the `windows` crate's Win32 types.
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> HANDLE;
        fn Process32FirstW(snapshot: HANDLE, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: HANDLE, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> HANDLE;
        fn QueryFullProcessImageNameW(
            process: HANDLE,
            flags: u32,
            exe_name: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    #[link(name = "version")]
    extern "system" {
        fn GetFileVersionInfoSizeW(filename: PCWSTR, handle: *mut u32) -> u32;
        fn GetFileVersionInfoW(
            filename: PCWSTR,
            handle: u32,
            length: u32,
            data: *mut c_void,
        ) -> i32;
        fn VerQueryValueW(
            block: *const c_void,
            sub_block: PCWSTR,
            buffer: *mut *mut c_void,
            length: *mut u32,
        ) -> i32;
    }

    // Adobe's ScriptLanguage.JAVASCRIPT enum value. Source:
    // https://developer.adobe.com/indesign/dom/api/s/ScriptLanguage/
    const ID_SCRIPT_LANGUAGE_JAVASCRIPT: i32 = 1_246_973_031;
    const PROG_IDS: &[&str] = &[
        "InDesign.Application.2026",
        "InDesign.Application.2025",
        "InDesign.Application.2024",
        "InDesign.Application.2023",
        "InDesign.Application",
    ];

    /// Keeps COM balanced only when this module successfully initialized it.
    struct ComApartment {
        should_uninitialize: bool,
    }

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result.is_ok() {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }

            // Tauri may have initialized this thread as MTA. COM remains usable; do not
            // uninitialize a COM apartment that belongs to its caller.
            if result == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }

            Err(format!("Failed to initialize COM: {result}"))
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn running_indesign_process_id() -> Result<Option<u32>, String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!(
                "Cannot enumerate running processes: {:?}",
                unsafe { GetLastError() }
            ));
        }

        let mut entry = ProcessEntry32W {
            dw_size: std::mem::size_of::<ProcessEntry32W>() as u32,
            cnt_usage: 0,
            th32_process_id: 0,
            th32_default_heap_id: 0,
            th32_module_id: 0,
            cnt_threads: 0,
            th32_parent_process_id: 0,
            pc_pri_class_base: 0,
            dw_flags: 0,
            sz_exe_file: [0; MAX_PATH],
        };
        let mut process_id = None;
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while has_entry {
            let length = entry
                .sz_exe_file
                .iter()
                .position(|&character| character == 0)
                .unwrap_or(MAX_PATH);
            if String::from_utf16_lossy(&entry.sz_exe_file[..length])
                .eq_ignore_ascii_case("InDesign.exe")
            {
                process_id = Some(entry.th32_process_id);
                break;
            }
            entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
            has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }

        unsafe { CloseHandle(snapshot) }
            .map_err(|error| format!("Cannot close process snapshot: {error}"))?;
        Ok(process_id)
    }

    fn is_indesign_process_running() -> Result<bool, String> {
        Ok(running_indesign_process_id()?.is_some())
    }

    fn process_image_path(process_id: u32) -> Result<Vec<u16>, String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if process.is_invalid() {
            return Err(format!(
                "Cannot open running InDesign process {process_id}: {:?}",
                unsafe { GetLastError() }
            ));
        }

        let mut path = vec![0_u16; MAX_PROCESS_IMAGE_PATH];
        let mut length = path.len() as u32;
        let queried = unsafe {
            QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) != 0
        };
        let close_result = unsafe { CloseHandle(process) };
        if !queried {
            return Err(format!(
                "Cannot read running InDesign process {process_id} path: {:?}",
                unsafe { GetLastError() }
            ));
        }
        close_result.map_err(|error| format!("Cannot close InDesign process handle: {error}"))?;
        path.truncate(length as usize);
        path.push(0);
        Ok(path)
    }

    fn indesign_year_from_process(process_id: u32) -> Result<Option<u16>, String> {
        let path = process_image_path(process_id)?;
        let mut ignored_handle = 0;
        let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), &mut ignored_handle) };
        if size == 0 {
            return Err(format!(
                "Cannot read version-info size for running InDesign process {process_id}: {:?}",
                unsafe { GetLastError() }
            ));
        }

        let mut version_info = vec![0_u8; size as usize];
        if unsafe {
            GetFileVersionInfoW(
                PCWSTR(path.as_ptr()),
                0,
                size,
                version_info.as_mut_ptr().cast(),
            ) == 0
        } {
            return Err(format!(
                "Cannot read version info for running InDesign process {process_id}: {:?}",
                unsafe { GetLastError() }
            ));
        }

        let mut fixed_info = std::ptr::null_mut();
        let mut fixed_info_length = 0;
        let root_block = [b'\\' as u16, 0];
        if unsafe {
            VerQueryValueW(
                version_info.as_ptr().cast(),
                PCWSTR(root_block.as_ptr()),
                &mut fixed_info,
                &mut fixed_info_length,
            ) == 0
        } || fixed_info_length < std::mem::size_of::<VsFixedFileInfo>() as u32
        {
            return Err(format!(
                "Cannot query product version for running InDesign process {process_id}: {:?}",
                unsafe { GetLastError() }
            ));
        }

        let fixed_info = unsafe { &*(fixed_info.cast::<VsFixedFileInfo>()) };
        if fixed_info.dw_signature != 0xFEEF04BD {
            return Err(format!(
                "Invalid product-version data for running InDesign process {process_id}"
            ));
        }
        let major_version = (fixed_info.dw_product_version_ms >> 16) as u16;
        Ok(match major_version {
            21 => Some(2026),
            20 => Some(2025),
            19 => Some(2024),
            18 => Some(2023),
            _ => None,
        })
    }

    fn active_indesign() -> Result<IDispatch, String> {
        let Some(process_id) = running_indesign_process_id()? else {
            return Err("InDesign is not running".to_string());
        };

        // Version detection selects exactly one versioned ProgID. If it cannot identify a
        // supported release, use only the generic ProgID rather than probing every release;
        // a mismatched versioned CoCreateInstance may launch another InDesign version.
        let prog_id = match indesign_year_from_process(process_id) {
            Ok(Some(year)) => format!("InDesign.Application.{year}"),
            Ok(None) | Err(_) => PROG_IDS.last().unwrap().to_string(),
        };
        let wide: Vec<u16> = prog_id.encode_utf16().chain(Some(0)).collect();
        let clsid = unsafe { CLSIDFromProgID(PCWSTR(wide.as_ptr())) }
            .map_err(|error| format!("Adobe InDesign COM automation is not registered for {prog_id}: {error}"))?;
        unsafe { CoCreateInstance::<_, IDispatch>(&clsid, None, CLSCTX_LOCAL_SERVER) }
            .map_err(|error| format!("Unable to attach to the running InDesign process with {prog_id}: {error}"))
    }

    pub fn detect_running_indesign() -> Result<bool, String> {
        is_indesign_process_running()
    }

    fn escape_extendscript_string(value: &str) -> String {
        value.replace('\\', "/").replace('"', "\\\"")
    }

    fn invoke_script(dispatch: &IDispatch, script: &str) -> Result<VARIANT, windows::core::Error> {
        let name: Vec<u16> = "DoScript".encode_utf16().chain(Some(0)).collect();
        let name_pointer = PCWSTR(name.as_ptr());
        let mut dispid = 0;
        unsafe {
            dispatch.GetIDsOfNames(&GUID::zeroed(), &name_pointer, 1, 0, &mut dispid)?;
        }

        // IDispatch passes positional arguments in reverse order. The remaining DoScript
        // arguments are optional, so omitting them lets InDesign use its own defaults.
        let mut arguments = [
            VARIANT::from(ID_SCRIPT_LANGUAGE_JAVASCRIPT),
            VARIANT::from(script),
        ];
        let parameters = DISPPARAMS {
            rgvarg: arguments.as_mut_ptr(),
            rgdispidNamedArgs: std::ptr::null_mut(),
            cArgs: arguments.len() as u32,
            cNamedArgs: 0,
        };
        let mut result = VARIANT::default();
        let mut exception = EXCEPINFO::default();
        let mut argument_error = 0;

        unsafe {
            dispatch.Invoke(
                dispid,
                &GUID::zeroed(),
                0,
                DISPATCH_METHOD,
                &parameters,
                Some(&mut result),
                Some(&mut exception),
                Some(&mut argument_error),
            )?;
        }

        Ok(result)
    }

    fn do_script_with_result(dispatch: &IDispatch, script: &str) -> Result<String, windows::core::Error> {
        let result = invoke_script(dispatch, script)?;
        let output = BSTR::try_from(&result)?;
        Ok(output.to_string())
    }

    fn is_transient_busy(error: &windows::core::Error) -> bool {
        let code = error.code();
        code == RPC_E_CALL_REJECTED || code == RPC_E_SERVERCALL_RETRYLATER
    }

    pub fn inject_daemon_script(daemon_script_path: &Path) -> Result<(), String> {
        let daemon_script_path = daemon_script_path.canonicalize().map_err(|error| {
            format!(
                "Cannot resolve InDesign daemon script '{}': {error}",
                daemon_script_path.display()
            )
        })?;
        // Keep this explicit guard next to injection. `CoCreateInstance` could otherwise
        // activate LocalServer32 and launch a new InDesign process.
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let bootstrap = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  try {{\n    $.evalFile(File(\"{}\"));\n    return \"OK\";\n  }} catch (e) {{\n    return \"ERROR: \" + e.message + \" (file: \" + (e.fileName || 'unknown') + \", line: \" + (e.line || 'unknown') + \")\";\n  }}\n}})();",
            escape_extendscript_string(&daemon_script_path.to_string_lossy())
        );

        // Three total calls, each separated by the documented retry backoff. The initial
        // 100ms pause also gives InDesign a brief chance to finish registering its object.
        for (attempt, delay) in [100_u64, 300, 900].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay));
            match do_script_with_result(&dispatch, &bootstrap) {
                Ok(output) if output.starts_with("ERROR:") => return Err(output),
                Ok(_) => return Ok(()),
                Err(error) if is_transient_busy(&error) && attempt < 2 => continue,
                Err(error) if is_transient_busy(&error) => {
                    return Err(format!(
                        "InDesign remained busy after 3 DoScript attempts: {error}"
                    ));
                }
                Err(error) => return Err(format!("InDesign DoScript failed: {error}")),
            }
        }

        unreachable!("the retry loop always returns")
    }

    pub fn execute_replacement(command: ReplacementCommand) -> Result<ReplacementResult, String> {
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let command_json = serde_json::to_string(&command)
            .map_err(|error| format!("Cannot serialize replacement command: {error}"))?;
        let command_id = serde_json::to_string(&command.command_id)
            .map_err(|error| format!("Cannot serialize command ID: {error}"))?;
        let script = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.executeReplacement({command_json});\n    return JSON.stringify(res);\n  }}\n  return JSON.stringify({{ commandId: {command_id}, status: 'FAILED', currentHash: '', message: 'InDesign SmartLinterDaemonInstance is not initialized' }});\n}})();"
        );
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let output = do_script_with_result(&dispatch, &script)
            .map_err(|error| format!("InDesign DoScript failed: {error}"))?;
        serde_json::from_str(&output)
            .map_err(|error| format!("Cannot decode InDesign replacement result: {error}"))
    }

    pub fn locate_paragraph(
        paragraph_id: String,
        base_hash: Option<String>,
        start_offset: Option<usize>,
        end_offset: Option<usize>,
    ) -> Result<LocateParagraphResult, String> {
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let command_id = format!("locate-{paragraph_id}");
        let command_json = serde_json::json!({
            "commandId": command_id,
            "paragraphId": paragraph_id,
            "baseHash": base_hash,
            "startOffset": start_offset,
            "endOffset": end_offset,
        });
        let script = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.locateParagraph({command_json});\n    return JSON.stringify(res);\n  }}\n  return JSON.stringify({{ commandId: {}, status: 'ERROR', message: 'InDesign SmartLinterDaemonInstance is not initialized' }});\n}})();",
            serde_json::to_string(&command_id).map_err(|error| format!("Cannot serialize locator command ID: {error}"))?
        );
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let output = do_script_with_result(&dispatch, &script)
            .map_err(|error| format!("InDesign DoScript failed: {error}"))?;
        serde_json::from_str(&output)
            .map_err(|error| format!("Cannot decode InDesign paragraph locator result: {error}"))
    }

    pub fn get_live_paragraph_snapshot(
        paragraph_id: String,
        base_hash: Option<String>,
    ) -> Result<LiveParagraphSnapshotResult, String> {
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let command_id = format!("live-snapshot-{paragraph_id}");
        let command_json = serde_json::json!({
            "commandId": command_id,
            "paragraphId": paragraph_id,
            "baseHash": base_hash,
        });
        let command_id_json = serde_json::to_string(&command_id)
            .map_err(|error| format!("Cannot serialize snapshot command ID: {error}"))?;
        let script = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.getLiveParagraphSnapshot({command_json});\n    return JSON.stringify(res);\n  }}\n  return JSON.stringify({{ commandId: {command_id_json}, status: 'ERROR', message: 'InDesign SmartLinterDaemonInstance is not initialized' }});\n}})();"
        );
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let start = Instant::now();
        for (attempt, delay) in [100_u64, 300, 900].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay));
            match do_script_with_result(&dispatch, &script) {
                Ok(output) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign live paragraph snapshot completed");
                    return serde_json::from_str(&output)
                        .map_err(|error| format!("Cannot decode InDesign live paragraph snapshot result: {error}"));
                }
                Err(error) if is_transient_busy(&error) && attempt < 2 => continue,
                Err(error) if is_transient_busy(&error) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempts = attempt + 1, "InDesign live paragraph snapshot remained busy");
                    return Ok(LiveParagraphSnapshotResult {
                        command_id,
                        status: "BUSY".to_string(),
                        current_text: None,
                        current_hash: None,
                        message: Some(format!("InDesign remained busy after 3 DoScript attempts: {error}")),
                    });
                }
                Err(error) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign live paragraph snapshot failed");
                    return Err(format!("InDesign DoScript failed: {error}"));
                }
            }
        }

        unreachable!("the retry loop always returns")
    }

    pub fn get_live_paragraph_snapshots(
        paragraph_ids: Vec<String>,
    ) -> Result<Vec<LiveParagraphSnapshotEntry>, String> {
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let command_id = "live-snapshots-batch";
        let command_json = serde_json::json!({
            "commandId": command_id,
            "paragraphIds": paragraph_ids,
        });
        let script = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.getLiveParagraphSnapshots({command_json});\n    return JSON.stringify(res.results);\n  }}\n  return JSON.stringify([]);\n}})();"
        );
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let start = Instant::now();
        for (attempt, delay) in [100_u64, 300, 900].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay));
            match do_script_with_result(&dispatch, &script) {
                Ok(output) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign batch live paragraph snapshot completed");
                    return serde_json::from_str(&output)
                        .map_err(|error| format!("Cannot decode InDesign batch live paragraph snapshot result: {error}"));
                }
                Err(error) if is_transient_busy(&error) && attempt < 2 => continue,
                Err(error) if is_transient_busy(&error) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempts = attempt + 1, "InDesign batch live paragraph snapshot remained busy");
                    return Ok(paragraph_ids.into_iter().map(|paragraph_id| LiveParagraphSnapshotEntry {
                        paragraph_id,
                        status: "BUSY".to_string(),
                        current_text: None,
                        current_hash: None,
                        message: Some(format!("InDesign remained busy after 3 DoScript attempts: {error}")),
                    }).collect());
                }
                Err(error) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign batch live paragraph snapshot failed");
                    return Err(format!("InDesign DoScript failed: {error}"));
                }
            }
        }

        unreachable!("the retry loop always returns")
    }

    pub fn generate_translated_document(request_id: String, paragraph_plans: Vec<DocumentGenerationParagraphPlan>, destination_path: String, cancellation_file: Option<String>) -> Result<GenerateTranslatedDocumentResponse, String> {
        if !is_indesign_process_running()? { return Err("InDesign is not running".to_string()); }
        let request = serde_json::json!({ "requestId": request_id, "paragraphPlans": paragraph_plans, "destinationPath": destination_path });
        let options = serde_json::json!({ "cancellationFile": cancellation_file });
        let script = format!("#targetengine \"smartlinter_persistent_engine\"\n(function() {{ if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{ return JSON.stringify($.global.SmartLinterDaemonInstance.generateTranslatedDocument({request}, {options})); }} return JSON.stringify({{ requestId: {}, status: 'FAILED', message: 'InDesign SmartLinterDaemonInstance is not initialized' }}); }})();", serde_json::to_string(&request_id).map_err(|e| format!("Cannot serialize generation request ID: {e}"))?);
        let _com = ComApartment::initialize()?; let dispatch = active_indesign()?; let start = Instant::now();
        for (attempt, delay) in [100_u64, 300, 900].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay));
            match do_script_with_result(&dispatch, &script) {
                Ok(output) => { tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign translated document generation completed"); return serde_json::from_str(&output).map_err(|e| format!("Cannot decode InDesign document generation result: {e}")); }
                Err(error) if is_transient_busy(&error) && attempt < 2 => continue,
                Err(error) if is_transient_busy(&error) => return Err(format!("InDesign remained busy after 3 DoScript attempts: {error}")),
                Err(error) => return Err(format!("InDesign DoScript failed: {error}")),
            }
        }
        unreachable!("the retry loop always returns")
    }

    pub fn enumerate_document_paragraphs(
        include_unplaced_stories: bool,
    ) -> Result<EnumerateDocumentResponse, String> {
        if !is_indesign_process_running()? {
            return Err("InDesign is not running".to_string());
        }
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Cannot generate InDesign scan request ID: {error}"))?
            .as_millis();
        let request_id = format!("indesign-scan-{timestamp}");
        let command_json = serde_json::json!({
            "requestId": request_id,
            "includeUnplacedStories": include_unplaced_stories,
        });
        let request_id_json = serde_json::to_string(&request_id)
            .map_err(|error| format!("Cannot serialize scan request ID: {error}"))?;
        let script = format!(
            "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.enumerateDocumentParagraphs({command_json});\n    return JSON.stringify(res);\n  }}\n  return JSON.stringify({{ requestId: {request_id_json}, sourceDocumentName: '', paragraphs: [], error: 'InDesign SmartLinterDaemonInstance is not initialized' }});\n}})();"
        );
        let _com = ComApartment::initialize()?;
        let dispatch = active_indesign()?;
        let start = Instant::now();
        for (attempt, delay) in [100_u64, 300, 900].into_iter().enumerate() {
            thread::sleep(Duration::from_millis(delay));
            match do_script_with_result(&dispatch, &script) {
                Ok(output) => {
                    tracing::debug!(elapsed_ms = start.elapsed().as_millis() as u64, attempt = attempt + 1, "InDesign document scan completed");
                    return serde_json::from_str(&output)
                        .map_err(|error| format!("Cannot decode InDesign document scan result: {error}"));
                }
                Err(error) if is_transient_busy(&error) && attempt < 2 => continue,
                Err(error) if is_transient_busy(&error) => return Err(format!("InDesign remained busy after 3 DoScript attempts: {error}")),
                Err(error) => return Err(format!("InDesign DoScript failed: {error}")),
            }
        }
        unreachable!("the retry loop always returns")
    }
}

#[cfg(windows)]
pub use platform::{detect_running_indesign, enumerate_document_paragraphs, execute_replacement, generate_translated_document, get_live_paragraph_snapshot, get_live_paragraph_snapshots, inject_daemon_script, locate_paragraph};

#[cfg(not(windows))]
pub fn detect_running_indesign() -> Result<bool, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn inject_daemon_script(_daemon_script_path: &Path) -> Result<(), String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn execute_replacement(_command: crate::protocol::ReplacementCommand) -> Result<crate::protocol::ReplacementResult, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn locate_paragraph(
    _paragraph_id: String,
    _base_hash: Option<String>,
    _start_offset: Option<usize>,
    _end_offset: Option<usize>,
) -> Result<LocateParagraphResult, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn get_live_paragraph_snapshot(_paragraph_id: String, _base_hash: Option<String>) -> Result<LiveParagraphSnapshotResult, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn get_live_paragraph_snapshots(_paragraph_ids: Vec<String>) -> Result<Vec<LiveParagraphSnapshotEntry>, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn generate_translated_document(_request_id: String, _paragraph_plans: Vec<crate::protocol::DocumentGenerationParagraphPlan>, _destination_path: String, _cancellation_file: Option<String>) -> Result<crate::protocol::GenerateTranslatedDocumentResponse, String> { Err("InDesign COM automation is only supported on Windows".to_string()) }

#[cfg(not(windows))]
pub fn enumerate_document_paragraphs(_include_unplaced_stories: bool) -> Result<crate::protocol::EnumerateDocumentResponse, String> {
    Err("InDesign COM automation is only supported on Windows".to_string())
}
