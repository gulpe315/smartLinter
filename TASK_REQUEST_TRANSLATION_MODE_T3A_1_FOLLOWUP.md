# Task: 번역 모드 T3a-1 후속 — 데드락 결함 1건(High) + 테스트 등록 누락 1건

Claude가 `cargo test --release` 독립 재실행 중 발견: 신규 테스트
`server::session::tests::document_scan_ignores_responses_from_another_session`
가 **영구 데드락**에 걸려 60초를 훨씬 넘겨도 끝나지 않았다(1시간 이상
방치 후 강제 종료해서 확인함). 이건 테스트만의 문제가 아니라
`complete_document_scan` 함수 자체의 실제 동시성 버그다.

## 결함 1(High) — `complete_document_scan`의 자기 자신 데드락

`src-tauri/src/server/session.rs`의 `complete_document_scan`(578번째
줄 근처)이 다음과 같이 구현돼 있다:

```rust
pub async fn complete_document_scan(&self, session_id: &str, response: EnumerateDocumentResponse) {
    let request_id = response.request_id.clone();
    match self.pending_document_scans.lock().await.remove(&request_id) {
        Some(pending) if pending.session_id == session_id => { let _ = pending.sender.send(response); }
        Some(pending) => {
            self.pending_document_scans.lock().await.insert(request_id, pending);
            tracing::debug!(session_id, "Ignoring document scan response from a stale session");
        }
        None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate document scan response"),
    }
}
```

**원인**: `match` 스크루티니 표현식(`self.pending_document_scans.lock().await.remove(&request_id)`)
안에서 만들어진 `MutexGuard` 임시값은 Rust의 규칙상 **`match` 블록
전체가 끝날 때까지 살아있다**(match 스크루티니의 임시값 수명 연장 —
잘 알려진 Rust `Mutex::lock()` 함정). 즉 두 번째 `Some(pending) => { ... }`
분기(다른 세션에서 온 응답이라 다시 넣어야 하는 경우) 안에서
`self.pending_document_scans.lock().await`를 **또** 호출하는데, 이때
바깥 `match`가 이미 같은 뮤텍스를 잠근 채로 안 풀고 있어서 자기
자신과 영구 데드락에 걸린다.

**증거**: 신규 테스트 `document_scan_ignores_responses_from_another_session`
가 정확히 이 "다른 세션 응답 → 재삽입" 경로를 타는데, `cargo test --release`
전체 실행 시 이 테스트에서 60초를 훨씬 넘겨도 끝나지 않았다(Claude가
1시간 넘게 방치 후 프로세스를 강제 종료해서 확인함 — 타임아웃 실패가
아니라 진짜 행이었다).

**왜 기존 `complete_live_snapshot`은 이 문제가 없는가(참고, 수정
대상 아님)**: `src-tauri/src/server/session.rs`의 `complete_live_snapshot`
(528번째 줄 근처)은 `let pending = self.pending_snapshots.lock().await.remove(&request_id);`
로 **락+remove를 별도 문장으로 분리**해서 그 문장이 끝나는 즉시
가드가 drop된다 — 그래서 `match pending { ... }`은 이미 뮤텍스가 완전히
풀린 상태의 소유값(`Option<PendingSnapshot>`)을 대상으로 하고, 그
안에서 다시 `.lock().await`해도 안전하다. `complete_document_scan`은
이 분리 단계를 생략하고 `.lock().await.remove(...)`를 match 스크루티니에
직접 인라인해서 이 버그가 생겼다.

**고칠 방법**: `complete_live_snapshot`과 정확히 같은 패턴으로 고칠 것
— 락+remove를 먼저 별도 `let` 문장으로 분리한 뒤 그 결과값을 match할
것:

```rust
pub async fn complete_document_scan(&self, session_id: &str, response: EnumerateDocumentResponse) {
    let request_id = response.request_id.clone();
    let pending = self.pending_document_scans.lock().await.remove(&request_id);
    match pending {
        Some(pending) if pending.session_id == session_id => { let _ = pending.sender.send(response); }
        Some(pending) => {
            self.pending_document_scans.lock().await.insert(request_id, pending);
            tracing::debug!(session_id, "Ignoring document scan response from a stale session");
        }
        None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate document scan response"),
    }
}
```

**검증**: 고친 뒤 `cargo test --release --lib server::session::tests::document_scan_ignores_responses_from_another_session`
(또는 `-- document_scan`으로 관련 테스트 전체)를 실행해 몇 초 안에
정상 종료되는지 반드시 직접 확인할 것 — 이 테스트가 다시 60초를
넘기면 절대 안 된다. 그 다음 `cargo test --release` 전체도 실행해서
107(+3, 신규 `document_scan_*` 테스트) = **110개 통과**(라이브 Ollama
타임아웃 1건 실패는 기존과 동일하게 무시)를 확인할 것. **이번엔 반드시
끝까지 실행되는 것을 직접 지켜보고 결과를 보고할 것** — 지난 라운드처럼
"60초 제한 안에 못 끝났다"는 식으로 넘어가면 이런 데드락을 다시
놓친다.

## 결함 2(Medium) — 신규 테스트가 `npm test`에 안 걸림

`plugins/word/tests/document_scanner.test.ts`(신규 파일, 4개 테스트
전부 통과 확인됨)가 `package.json`의 `test` 스크립트(11번째 줄)에
등록되지 않았다. `npm test`를 실행하면 여전히 197개만 돌고, 이 세션이
추가한 4개 테스트는 CI/일반 검증 흐름에서 전혀 실행되지 않는다.

**고칠 방법**: `package.json`의 `test` 스크립트에
`plugins/word/tests/document_scanner.test.ts`를 추가할 것 — 같은
스크립트에 이미 있는 `plugins/word/tests/snapshot_provider.test.ts`/
`plugins/word/tests/locate_provider.test.ts` 바로 옆에 넣으면 된다.
(`test:word` 스크립트는 원래도 이 두 파일을 포함하지 않는 좁은
스크립트라 이번 범위가 아니다 — 건드리지 말 것.)

**검증**: `npm test`가 **201개**(기존 197 + 신규 4)를 통과하는지 확인.

## 절대 제약

- 이번 라운드는 위 2건만 고친다. 다른 파일/로직은 건드리지 않는다.
- `complete_document_scan` 외의 다른 `complete_*`/`request_*` 함수는
  이미 정상이니 건드리지 말 것.

## 완료 후 보고

`git diff --stat`으로 `src-tauri/src/server/session.rs`와
`package.json` 두 파일만 바뀌었는지 확인하고, `cargo test --release`
전체 실행 결과(통과 개수, 소요 시간)와 `npm test` 결과를 응답에 포함할
것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
