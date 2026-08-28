# bridge_client.ts: connect() WS→REST 폴백 부재 수정 설계 검증 요청

## 배경
`plugins/word/src/bridge_client.ts`의 `WordBridgeClient.connect()`는 클래스
문서 주석("Manages WebSocket & REST communication ... handles automatic
token pairing")과 달리, 실제로는 WebSocket 연결 자체가 실패했을 때 REST로
폴백하지 않습니다.

```ts
public async connect(): Promise<boolean> {
    if (this.isDisposed) return false;
    const token = await this.resolveToken();
    if (this.enableWebSocket && typeof WebSocket !== 'undefined') {
        return this.connectWebSocket(token);   // 실패해도 여기서 끝
    } else {
        return this.connectRestFallback(token); // WS 비활성/미지원일 때만 REST
    }
}
```

`connectWebSocket()`은 인증 거부(`AUTH_RESPONSE.success=false`), `onerror`,
또는 인증 완료 전 `onclose` 시 그냥 `resolve(false)`만 하고 끝납니다 —
`scheduleReconnect()`는 `onclose`에서 호출되지만(같은 WS 방식으로 재시도),
REST로의 전환 시도는 전혀 없습니다.

이번 세션(2026-08-28)에는 실제로 문제가 되지 않았습니다(WS가 항상 성공).
그런데 이 프로젝트에서는 WS가 막히는 사내망/보안SW 환경이 실제로 있을 수
있어(사용자 실환경이 사내 Naver 파일서버/사내망), 재현 가능성이 있다고 보고
수정하려 합니다.

## 참고 — 관련 기존 코드
- `sendParagraphPayload()`/`sendHeartbeat()`는 이미 WS 실패 시 개별 요청
  단위로 REST 폴백을 하고 있음(연결 자체가 아니라 "요청 전송"의 폴백).
- `scheduleReconnect()`는 실패 시 항상 `this.connect()`를 다시 호출 —
  즉 WS로 재시도할지 REST로 재시도할지는 이번 수정의 `connect()` 로직에
  따라 매 재시도마다 갈릴 수 있음.

## 제안하는 수정 방향 (검토 요청)
`connectWebSocket()`이 실패(false)를 반환하면, `connect()`가 그 직후
`connectRestFallback(token)`을 시도하도록 변경. 예:

```ts
public async connect(): Promise<boolean> {
    if (this.isDisposed) return false;
    const token = await this.resolveToken();
    if (this.enableWebSocket && typeof WebSocket !== 'undefined') {
        const wsOk = await this.connectWebSocket(token);
        if (wsOk || this.isDisposed) return wsOk;
        return this.connectRestFallback(token);
    }
    return this.connectRestFallback(token);
}
```

## 검토해 주셨으면 하는 점
1. 이 방향이 안전한가? 특히 `connectWebSocket()`의 `onclose` 핸들러가 이미
   `scheduleReconnect()`를 걸어놓은 상태에서, `connect()`가 곧바로
   REST 폴백까지 시도하면 "WS 재시도 타이머"와 "즉시 REST 폴백"이
   동시에 진행되며 이중 연결/이중 세션 시도가 발생하지 않는가?
2. REST 폴백 성공 후에도 WS의 `scheduleReconnect()` 타이머가 살아있다면
   나중에 몰래 끼어들어 상태를 덮어쓸 위험이 있는가? (REST 연결 성공 후에도
   백그라운드에서 WS 재연결이 다시 시도되어 상태가 오락가락할 가능성)
3. `connectRestFallback()`도 실패 시 자체적으로 `scheduleReconnect()`를
   호출하는데, 이러면 향후 재시도는 계속 WS부터 다시 도는 게 맞는지,
   아니면 한 번 REST로 폴백에 성공한 뒤엔 REST를 우선해야 하는지?
   (참고: 서버는 WS/REST 둘 다 동등하게 지원하는 것으로 보임 — 최초
   연결 방식을 계속 고집할 이유가 있는지 확인 필요)
4. 테스트 커버리지 — 기존 `plugins/word/__tests__/word_plugin.test.ts` 등에
   이 경로를 검증하는 테스트가 있는지, 없다면 어떤 시나리오(WS onerror,
   WS 인증거부, WS 미지원 환경)를 새로 추가해야 하는지.

## 스코프
이 파일(`bridge_client.ts`)의 `connect()`/`connectWebSocket()`/
`connectRestFallback()`/`scheduleReconnect()` 상호작용만 대상. 다른 파일
(runtime_manager.ts, document_listener.ts 등)은 건드리지 않는 것을 기본
가정으로 하되, 문제가 있다면 지적 바랍니다.
