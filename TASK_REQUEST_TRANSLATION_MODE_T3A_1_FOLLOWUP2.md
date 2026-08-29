# Task: `complete_locate`에 남아있는 동일 데드락 패턴 수정(High, 기존 코드)

agy의 독립 코드 리뷰에서 이번 T3a-1 diff와 무관한 **기존 코드**에 방금
고친 것과 정확히 같은 데드락 버그가 하나 더 있다고 지적했다. Claude가
코드로 확인했고 실제 결함이다.

## 결함(High) — `complete_locate`의 자기 자신 데드락

`src-tauri/src/server/session.rs`의 `complete_locate`(556번째 줄 근처)가
방금 `complete_document_scan`에서 고친 것과 정확히 같은 패턴의 버그를
갖고 있다:

```rust
pub async fn complete_locate(&self, session_id: &str, response: LocateResponse) {
    let request_id = response.request_id.clone();
    match self.pending_locates.lock().await.remove(&request_id) {
        Some(pending) if pending.session_id == session_id => { let _ = pending.sender.send(response); }
        Some(pending) => {
            self.pending_locates.lock().await.insert(request_id, pending);
            tracing::debug!(session_id, "Ignoring locate response from a stale session");
        }
        None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate locate response"),
    }
}
```

`match` 스크루티니 안에서 만든 `MutexGuard`가 match 블록 전체 동안
살아있어서, "다른 세션에서 온 응답이라 재삽입해야 하는" 분기에서
`self.pending_locates.lock().await`를 또 호출하면 자기 자신과
데드락에 걸린다 — 다른 세션(또는 stale session)에서 locate 응답이
도착하면 서버가 영구적으로 멈춘다.

**고칠 방법**: 방금 고친 `complete_document_scan`(581번째 줄 근처)과
정확히 같은 패턴으로 바꿀 것 — 락+remove를 별도 `let` 문으로 분리:

```rust
pub async fn complete_locate(&self, session_id: &str, response: LocateResponse) {
    let request_id = response.request_id.clone();
    let pending = self.pending_locates.lock().await.remove(&request_id);
    match pending {
        Some(pending) if pending.session_id == session_id => { let _ = pending.sender.send(response); }
        Some(pending) => {
            self.pending_locates.lock().await.insert(request_id, pending);
            tracing::debug!(session_id, "Ignoring locate response from a stale session");
        }
        None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate locate response"),
    }
}
```

## 참고(수정 대상 아님, 확인만)

`complete_live_snapshot`(566번째 줄 근처)과 `complete_document_scan`은
이미 이 안전한 패턴을 쓰고 있다 — `session.rs`에 `match ... .lock().await...`
형태로 락을 스크루티니에 직접 인라인한 다른 함수가 더 있는지 훑어보고,
있다면(없을 가능성이 높지만) 같은 패턴으로 고칠 것. 없으면 그냥
넘어가도 된다.

## 절대 제약

- `complete_locate` 하나(그리고 위 "참고" 확인에서 추가로 발견되는
  경우에만 다른 함수도)만 고친다. 다른 로직은 건드리지 않는다.

## 검증

수정 후 관련 테스트를 실행해 확인할 것. `complete_locate`에 대한
"다른 세션 응답 무시" 시나리오를 검증하는 기존 테스트가 있다면
(`session.rs`의 `tests` 모듈에서 `locate` 관련 테스트 검색) 몇 초 안에
정상 종료되는지 반드시 직접 지켜볼 것 — 이번에도 60초를 넘기면 절대
안 된다. 그런 테스트가 없다면, `document_scan_ignores_responses_from_another_session`
과 같은 패턴으로 `complete_locate`용 회귀 테스트를 새로 하나 추가할
것(권장 사항, 없으면 최소한 기존 전체 스위트 통과로 대체 가능).

`cargo test --release` 전체를 끝까지 실행해서 통과 개수를 보고할 것
(라이브 Ollama 타임아웃, 그리고 이번 세션에 환경 경합으로 1회
관찰된 Windows Credential Manager 플레이크는 무시해도 된다).

## 완료 후 보고

`git diff --stat`으로 `src-tauri/src/server/session.rs`(및 새 테스트를
추가했다면 그 부분)만 바뀌었는지 확인하고 결과를 응답으로 정리해 출력할
것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
