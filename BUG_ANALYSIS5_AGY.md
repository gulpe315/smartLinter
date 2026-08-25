# 긴급 회귀 분석: Task G 이후 "InDesign 연결" 실패 (0x80020009) 원인 진단 및 해결 방안

- **문서 버전:** 1.0.0
- **작성 일자:** 2026-08-25
- **대상 커밋:** `9d0579c` (Refuse to replace text in locked InDesign frames/layers)
- **증상:** 대시보드에서 [InDesign 연결] 클릭 시 `Tauri invoke connect_indesign failed, using fallback: InDesign DoScript failed: 예외가 발생했습니다. (0x80020009)` 에러 발생 및 연결 불가.

---

## 1. 핵심 요약 (Executive Summary)

1. **에러 코드 `0x80020009` (`DISP_E_EXCEPTION`)의 정체**:
   - InDesign COM automation의 `IDispatch::Invoke("DoScript", ...)` 실행 중 ExtendScript 엔진 내부에서 처리되지 않은 예외(Unhandled Exception)가 발생했음을 나타냅니다.
2. **근본 원인 1 (가장 직접적): Rust의 `canonicalize()`로 인한 Windows UNC 경로(`\\?\`) 오염**:
   - `src-tauri/src/indesign_com.rs`의 `inject_daemon_script`에서 `daemon_script_path.canonicalize()`를 수행하면 Windows 환경에서 `\\?\D:\...` 형태의 Win32 Verbatim UNC 경로가 생성됩니다.
   - `escape_extendscript_string`을 거치면 `//?/D:/...`로 변환되어 InDesign ExtendScript의 `File("//?/D:/...")` 생성자로 전달됩니다.
   - **Adobe ExtendScript의 `File` 객체는 `//?/` 접두사를 올바른 로컬 드라이브 경로로 해석하지 못하며**, `File.exists`가 `false`가 되어 `$.evalFile(File(...))` 호출 시 **`Error: File or folder does not exist` 예외를 즉시 throw**합니다.
3. **근본 원인 2 (진단 정보 소실): `inject_daemon_script`의 bootstrap 코드에 `try...catch` 래퍼 부재**:
   - `execute_replacement`나 `locate_paragraph`와 달리 `inject_daemon_script`는 `$.evalFile(...)`을 익명 함수 및 `try...catch`로 감싸지 않고 raw 문자열로 실행하고 있습니다.
   - 이로 인해 ExtendScript 엔진 내부에서 발생한 실제 에러 메시지(예: 파일 경로 오류, 문법 오류, 초기화 예외)가 Rust/Tauri 단으로 전달되지 못하고 COM 레벨에서 `0x80020009`로 뭉개져 출력되었습니다.
4. **Task G 변경 사항(`isParagraphLocked`) 검토 결과**:
   - `text_observer.jsx` 및 `atomic_replacer.jsx`에 추가된 `isParagraphLocked` 함수는 함수 정의 시점에 즉시 실행되지 않으며, 실제 호출부인 `getActiveParagraph` 및 `isParagraphLocked` 내부 모두 `try...catch`로 철저히 방어되어 있어 DOM 접근 예외가 외부로 전파되지 않습니다.
   - InDesign DOM 속성(`parentTextFrames`, `frame.locked`, `frame.itemLayer.locked`, `isValid`) 자체는 ExtendScript 공식 스펙에 부합합니다.

---

## 2. 상세 원인 진단 (Deep-Dive Root Cause Analysis)

### 2.1. Rust 경로 정규화와 ExtendScript File API 비호환

`src-tauri/src/indesign_com.rs`의 [inject_daemon_script](file:///D:/data/dev/App/SmartLinter/src-tauri/src/indesign_com.rs#L371-L389) 코드를 살펴보면 다음과 같습니다:

```rust
pub fn inject_daemon_script(daemon_script_path: &Path) -> Result<(), String> {
    let daemon_script_path = daemon_script_path.canonicalize().map_err(|error| {
        format!(
            "Cannot resolve InDesign daemon script '{}': {error}",
            daemon_script_path.display()
        )
    })?;
    // ...
    let bootstrap = format!(
        "#targetengine \"smartlinter_persistent_engine\"\n$.evalFile(File(\"{}\"));",
        escape_extendscript_string(&daemon_script_path.to_string_lossy())
    );
```

#### 메커니즘 분석
1. Rust 표준 라이브러리의 `std::fs::canonicalize()`는 Windows에서 긴 경로 지원을 위해 항상 `\\?\` 접두사(예: `\\?\D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\smartlinter_daemon.jsx`)를 붙입니다.
2. `escape_extendscript_string()`은 백슬래시(`\`)를 슬래시(`/`)로 치환하여 `//?/D:/data/...` 문자열을 만듭니다.
3. InDesign ExtendScript 엔진이 `$.evalFile(File("//?/D:/data/..."))`를 실행합니다.
4. Adobe ExtendScript(C++ 기반의 ECMAScript 3 인터프리터)는 POSIX 스타일 URI나 표준 Windows 드라이브 경로(`D:/...` 또는 `D:\...`)만 지원하며, Win32 전용 `//?/` 네임스페이스 접두사를 네트워크 서버 경로 또는 잘못된 볼륨으로 취급합니다.
5. 결과적으로 `File.exists` 검사가 실패하고, `$.evalFile`은 실행을 중단하며 `Error: File or folder does not exist` 예외를 던집니다.

### 2.2. Bootstrap 스크립트의 예외 격리 부재

InDesign COM automation에서 `DoScript`를 호출할 때, 실행되는 ExtendScript 코드 최상단에 `try...catch`가 없으면 스크립트 예외가 COM `EXCEPINFO`로 전달되지만 HRESULT는 `DISP_E_EXCEPTION (0x80020009)`로 고정됩니다.

현재 `indesign_com.rs`의 세 함수 비교:
- `execute_replacement`: `(function() { try { ... } ... })()` 형태로 안전하게 JSON 반환.
- `locate_paragraph`: `(function() { try { ... } ... })()` 형태로 안전하게 JSON 반환.
- **`inject_daemon_script`**: `$.evalFile(File("..."));` 단독 실행 (래퍼 없음).

이로 인해 daemon 주입 평가 시 사소한 파일 경로 문제나 초기화 예외가 발생해도 전체 프로세스가 실패하고 상세 원인을 파악하기 어렵게 만듭니다.

### 2.3. Task G ExtendScript 코드 정밀 분석

Task G에서 추가된 코드를 점검한 결과는 다음과 같습니다:

1. **`text_observer.jsx` ([L227-L256](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/text_observer.jsx#L227-L256))**:
   ```javascript
   function isParagraphLocked(paragraph) {
       if (!paragraph || paragraph.isValid === false) return false;
       try {
           var frames = paragraph.parentTextFrames;
           if (!frames || frames.length === 0) return false;
           for (var i = 0; i < frames.length; i++) {
               var frame = frames[i];
               if (!frame || frame.isValid === false) continue;
               if (frame.locked === true || (frame.itemLayer && frame.itemLayer.locked === true)) {
                   return true;
               }
           }
       } catch (e) {
           return false;
       }
       return false;
   }
   ```
   - **DOM 유효성**: `Text.parentTextFrames`, `PageItem.locked`, `PageItem.itemLayer`, `Layer.locked`는 InDesign ExtendScript 공식 DOM 속성입니다.
   - **예외 방어**: 내부 로직 전체가 `try...catch (e) { return false; }`로 보호되어 있어, 선택되지 않은 문단, overset 텍스트, 테이블 셀 등 비정형 텍스트 구조에서도 안전합니다.
   - **실행 시점**: 이 함수는 평가 시점에 자동 실행되지 않고 `getActiveParagraph()` 또는 `execute()` 호출 시에만 실행됩니다.

2. **전역 객체 등록 ([L380-L400](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/text_observer.jsx#L380-L400))**:
   ```javascript
   if (typeof $ !== 'undefined' && $.global) {
       $.global.SmartLinterTextObserver = SmartLinterTextObserver;
       $.global.SmartLinterLockUtil = { isParagraphLocked: isParagraphLocked };
       $.global.SmartLinterHashUtil = { ... };
   }
   ```
   - 순수 객체 할당문이므로 평가 시점에서 런타임 에러를 유발하지 않습니다.

---

## 3. 수정 방향 제안 (Recommended Solutions)

코드베이스의 안정성과 유지보수성을 위해 다음 3단계 조치를 권장합니다.

### 1순위 (필수): Rust 측 경로 정규화에서 UNC 접두사(`\\?\`) 제거

`src-tauri/src/indesign_com.rs`에서 `canonicalize()` 결과의 UNC 접두사를 제거하거나 `dunce` 크레이트 패턴을 적용하여 표준 드라이브 경로로 변환합니다.

```rust
// 수정 방향 예시 (Rust):
let daemon_script_path = daemon_script_path.canonicalize().map_err(|error| {
    format!("Cannot resolve InDesign daemon script '{}': {error}", daemon_script_path.display())
})?;

let path_str = daemon_script_path.to_string_lossy();
// Windows UNC 접두사 "\\?\" 제거
let normalized_path = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str);

let bootstrap = format!(
    "#targetengine \"smartlinter_persistent_engine\"\n$.evalFile(File(\"{}\"));",
    escape_extendscript_string(normalized_path)
);
```

### 2순위 (필수): `inject_daemon_script`에 안전한 IIFE 래퍼 및 에러 진단 반환 적용

`inject_daemon_script`의 bootstrap을 IIFE와 `try...catch`로 감싸고 `do_script_with_result`를 호출하도록 개선합니다. 이렇게 하면 향후 ExtendScript 내부 오류 발생 시 `0x80020009` 대신 실제 에러 메시지와 발생 라인 번호가 Rust 에러 로그로 정확히 반환됩니다.

```rust
// 수정 방향 예시 (Rust bootstrap):
let bootstrap = format!(
    "#targetengine \"smartlinter_persistent_engine\"\n\
    (function() {{\n\
        try {{\n\
            var f = File(\"{path}\");\n\
            if (!f.exists) {{\n\
                return JSON.stringify({{ success: false, error: 'Daemon script file does not exist: ' + f.fsName }});\n\
            }}\n\
            $.evalFile(f);\n\
            return JSON.stringify({{ success: true }});\n\
        }} catch (e) {{\n\
            return JSON.stringify({{ success: false, error: (e.message || String(e)) + ' (line ' + (e.line || '?') + ')' }});\n\
        }}\n\
    }})();",
    path = escape_extendscript_string(normalized_path)
);
```

### 3순위 (권장): ExtendScript `#include` 다중 포함 방어 강화

`atomic_replacer.jsx` 상단에서 `bridge_socket.jsx`, `text_observer.jsx` 등을 중복 `#include`하고 있으므로, 단독 실행 시와 daemon 번들 실행 시 모두 안전하도록 인라인 가드가 유지되고 있는지 확인합니다 (현재는 함수 스코프 IIFE로 격리되어 있어 충돌은 없으나 구조적 정돈 권장).

---

## 4. 결론 및 다음 단계 제안

- **원인 요약:** Task G 이후 재연결 실패의 본질은 ExtendScript 문법 오류나 `isParagraphLocked`의 DOM 호환성 문제가 아니라, **Rust `canonicalize()`가 생성한 `\\?\` UNC 경로를 ExtendScript `File` 객체가 열지 못해 발생한 `File or folder does not exist` 예외**입니다.
- **수정 범위:** `src-tauri/src/indesign_com.rs`의 `inject_daemon_script` 함수 내부 (약 5~10줄의 최소 침습 수정).
- **작업 지시 대기:** 본 문서는 진단 및 제안 문서이며, 사용자 확인 후 즉시 위 수정 방향을 적용할 수 있습니다.
