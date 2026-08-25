# 태스크 E: QA 카드 "위치 보기" 기능 (InDesign에서 해당 문단으로 이동)

기존 백로그 기능이었고, Codex/agy가 각각 검토(FEATURE_REVIEW_CODEX.md, FEATURE_REVIEW_AGY.md)에서
Task B/C가 만든 견고한 문단 조회 인프라(`findParagraphById` + baseHash 검증/폴백, 커밋 b5210e3,
899363e)를 재사용해 구현 가능하다고 판단한 기능입니다. 이제 그 인프라가 준비됐으니 구현합니다.

이번 범위는 **InDesign만** 다룹니다(Word taskpane 인프라는 아직 없어서 제외). 치환 경로
(`send_replacement_command`, `pendingCommands` 레지스트리)와는 완전히 분리된 새 명령으로
만드세요 — 위치 이동은 문서를 수정하지 않으므로 치환 트랜잭션 인프라를 재사용하지 마세요.

## 요청 사항

### 1. ExtendScript

`plugins/indesign/extendscript/atomic_replacer.jsx`(또는 적절하다고 판단되면 새 파일, 단 기존
`findParagraphById`/해시 유틸을 반드시 재사용)에 문단으로 이동하는 함수를 추가하세요. 예:
`SmartLinterAtomicReplacer.prototype.locateParagraph` 또는 데몬에 새 메서드로 노출.

- `command.paragraphId`와 `command.baseHash`로 Task C의 견고한 조회 로직(인덱스 우선 + 해시
  불일치 시 Story 내 재탐색, 후보 0개/2개 이상이면 실패)을 그대로 재사용해서 대상 문단을 찾으세요.
- 문단을 찾으면: 해당 문서/윈도우를 활성화하고, 그 문단의 텍스트 범위를 선택(`app.select(...)`
  등)해서 InDesign 화면이 자동으로 그 위치로 스크롤/포커스되게 하세요. 문서를 수정하지는 마세요.
- 반환값은 치환 결과(`ReplacementResult`)와 다른, 새로운 간단한 결과 형태로 만드세요. 예:
  `{ commandId, status: 'FOUND' | 'NOT_FOUND', message }`. `shared/protocol/types.ts`와 대응하는
  Rust 타입에 필요하면 추가하세요(과하게 확장하지 말고 이 기능에 필요한 최소한만).
- `smartlinter_daemon.jsx`가 이 메서드를 `$.global.SmartLinterDaemonInstance`에 노출하도록
  연결하세요(기존 `executeReplacement` 노출 패턴 참고).

### 2. Rust (src-tauri)

- `src-tauri/src/indesign_com.rs`에 `execute_replacement`와 같은 패턴으로 새 함수(예:
  `locate_paragraph`)를 추가하세요. `$.global.SmartLinterDaemonInstance.locateParagraph(...)`를
  DoScript로 호출하고 JSON 결과를 파싱해 반환하면 됩니다.
- `src-tauri/src/commands.rs`에 새 Tauri command(예: `locate_paragraph_in_editor` 또는 적절한
  이름)를 추가해 위 함수를 호출하세요.
- **반드시 `src-tauri/src/main.rs`의 `tauri::generate_handler![...]` 목록에 새 command를
  등록하세요.** (참고: 이전에 IPC 커맨드 13개 중 7개가 등록 누락돼 조용히 Mock 폴백되던 사고가
  있었습니다 — 커밋 7b08af6. 이번엔 등록을 빠뜨리지 마세요. Claude가 나중에 main.rs를 직접 열어
  등록 여부를 확인할 예정입니다.)
- Word 쪽은 아직 이 기능을 요구하지 않으니, InDesign이 아니거나 데몬이 없는 경우엔 명확한 에러를
  반환하면 됩니다(무리해서 Word 분기를 만들지 마세요).

### 3. 프론트엔드 (src/)

- `src/services/tauriBridge.ts`의 `IBridgeService` 인터페이스에 새 메서드(예:
  `locateParagraph(paragraphId: string, baseHash?: string): Promise<{ found: boolean; message?: string }>`
  형태, 정확한 타입은 판단해서 결정)를 추가하고, 실제 Tauri 구현체와 `MockBridgeService` 양쪽에
  구현하세요(Mock은 항상 성공 반환하면 됩니다).
- `src/components/qa/QACardItem.tsx`의 카드 액션 버튼 영역에 "위치 보기" 버튼을 추가하세요. 클릭
  시 위 메서드를 호출하고, 실패(`found: false` 또는 예외)하면 카드 안에 짧은 안내
  ("문단을 찾을 수 없습니다 — 문서가 변경되었을 수 있습니다" 등)를 보여주세요. 문서를 수정하는
  액션이 아니므로 [적용]/[무시]와는 시각적으로 구분되게(부담 없는 보조 버튼 톤) 배치하세요.
- 기존 카드 액션 관련 테스트를 깨지 마세요. 새 버튼에 대한 테스트도 추가해주세요(클릭 시 서비스
  메서드 호출, 실패 시 안내 노출).

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build`가 전부 통과해야 합니다. 특히
main.rs에 새 command가 등록됐는지, mock/real 양쪽 `IBridgeService` 구현이 다 있는지 스스로
다시 한번 확인해주세요.
