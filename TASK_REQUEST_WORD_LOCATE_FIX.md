# Task: Word "위치 보기" InDesign 하드코딩 버그 수정

## 배경
`src-tauri/src/commands.rs:343-362`의 `locate_paragraph_in_editor`가
`session.editor_type != EditorType::InDesign`이면 무조건
`"Locate paragraph is supported only for InDesign"` 에러를 반환해서,
Word 세션에서 QA 카드의 [위치 보기]를 누르면 "InDesign 연결 상태를
확인할 수 없습니다"라는 엉뚱한 오류가 뜸(실사용 중 발견, 스크린샷 확인).

## 참고 문서 (재논의 불필요, agy+Codex 완전 수렴 완료)
- `AGY_ANSWER_LOCATE_WORD_AND_SENTENCE_SCOPING.md` 2장
- `CODEX_ANSWER_LOCATE_WORD_AND_SENTENCE_SCOPING.md` 1장

## 확정된 설계
1. **오늘 Live Snapshot(Step1/2, 커밋 `df3d197`/`8c73704`)의 요청-응답
   상관관계 인프라(requestId+oneshot+timeout, `session.rs`의
   `pending_snapshots` 패턴)를 재사용하되, snapshot 코드를 그대로
   복붙하지 말 것.** locate는 읽기전용 조회가 아니라 실제 선택/스크롤
   (부수효과)이라 별도 메시지 타입이 필요함.
2. 새 프로토콜 메시지 (`shared/protocol/types.ts` +
   `src-tauri/src/protocol/messages.rs`):
   ```ts
   interface LocateRequest {
     requestId: string;
     paragraphId: string;
     baseHash?: string;
     startOffset?: number;  // UTF-16, 지금은 안 씀(향후 정밀하이라이트용 예약 필드)
     endOffset?: number;
   }
   type LocateStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SELECTION_FAILED' | 'BUSY' | 'ERROR';
   interface LocateResponse {
     requestId: string;
     status: LocateStatus;
     message?: string;
   }
   ```
   `BridgeMessage`에 `LOCATE_REQUEST`/`LOCATE_RESPONSE` 추가.
3. `session.rs`에 `pending_snapshots`와 동일한 패턴으로
   `pending_locates`(또는 공용 correlation registry로 일반화해도 됨,
   선택은 구현자 판단) 추가 — requestId가 Rust 생성, session_id 대조로
   stale 세션 응답 무시, 3초 타임아웃, 연결해제/타임아웃 시 pending
   정리(누수 금지).
4. `commands.rs`의 `locate_paragraph_in_editor`: `EditorType::Word`면
   새 RPC 호출, `EditorType::InDesign`이면 기존 COM 경로 그대로 유지.
5. **Word 쪽 안전 규칙 — snapshot과 동일한 fail-closed 원칙 적용:**
   문서 전체를 스캔해 `paragraphId`(콘텐츠 해시 기반) 일치 후보를
   전수 수집 → 0개=NOT_FOUND, 1개=FOUND(그 문단 `range.select('Select')`
   호출), 2개 이상=AMBIGUOUS(아무것도 선택하지 말 것 — 첫 매치 임의
   선택 금지, 이 프로젝트가 이미 여러 번 겪은 "첫 매치 선택" 안티패턴
   재발 금지). `baseHash` 있으면 전체 해시로 추가 필터링.
6. **Word 선택 API 가용성 검증 필수** — 현재 코드베이스에 Word 선택
   API(`range.select()`류) 호출/mock/테스트가 전혀 없음(Codex 지적).
   실제로 호출 가능하다고 가정하지 말고, mock 기반 단위테스트로
   성공/실패 케이스를 검증할 것. API 미지원이나 selection 실패는
   `SELECTION_FAILED`로 반환(InDesign의 기존 `SELECTION_FAILED` 상태와
   의미 통일).
7. **`plugins/word/src/bridge_client.ts`**: `LOCATE_REQUEST` 수신
   핸들러 등록 API + 응답 전송 메서드 추가(Step1의
   `onSnapshotRequest`/`sendSnapshotResponse` 패턴 그대로 재사용).
8. **`plugins/word/src/runtime_manager.ts`**: locate 핸들러를
   snapshot 핸들러와 같은 방식으로 wiring.
9. **`src/components/qa/QACardItem.tsx`**: `handleLocate`의 에러
   메시지가 InDesign 전용 문구("InDesign 연결 상태를 확인할 수
   없습니다")로 고정돼 있는 부분을 에디터 중립적 문구로 수정.

## 하지 말 것
- InDesign COM locate 경로(`indesign_com.rs`) 변경 금지.
- 정밀 하이라이트(startOffset/endOffset 실제 사용)는 이번 스코프
  아님 — 필드만 예약하고 로직에서는 안 씀(문단 전체 선택만).
- `replacement_executor.ts`(치환 실행기) 로직 재사용/변경 금지 —
  치환과 locate는 다른 관심사(Codex가 이미 이 파일 재사용 위험 지적).
- 무관한 파일 재포맷 금지(`git diff -w`로 검토함).

## 검증
- `cargo test`/`npm test`/`npm run test:ui`/`npm run build` 전부 통과.
- 신규 테스트: protocol 직렬화, SessionManager correlation(다중 in-flight,
  timeout, stale session 무시), Word locate provider(유일매칭 FOUND,
  0개 NOT_FOUND, 2개+ AMBIGUOUS, baseHash 필터링, Word select 실패시
  SELECTION_FAILED), commands.rs Word/InDesign 분기 회귀없음.
- 이번엔 Rust 변경 있으므로 완료 후 Claude가 서버 재기동 예정 —
  구현 완료 후 "서버 재기동 필요"라고 알려줄 것.

작업 완료 후 무엇을 구현했는지, 테스트 결과를 요약해줘.
