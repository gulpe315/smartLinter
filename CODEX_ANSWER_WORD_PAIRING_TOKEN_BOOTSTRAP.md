# Word taskpane pairing token bootstrap: 설계 권고

## 전제와 확인 결과

이 문서는 현재 구현을 기준으로 한 분석 및 설계 권고이며, 코드 변경을 제안하거나 수행하지 않는다.

- bridge는 `127.0.0.1:49152`에만 bind되지만, router의 CORS 정책은 현재 `allow_origin(Any)`, `allow_methods(Any)`, `allow_headers(Any)`다. 따라서 브라우저가 loopback 요청을 허용하는 환경에서는 임의의 웹 origin도 응답을 읽을 가능성을 처음부터 배제할 수 없다. 브라우저의 Private Network Access 등 플랫폼 방어에 의존해서는 안 된다.
- pairing token은 OS keyring의 장기 비밀값이며, bootstrap 편의를 위해 사용자 프로필의 `pairing_token.txt`에도 export된다. 인증된 Word 세션의 `sessionToken`과 달리, 이 token을 얻은 주체는 새 editor session을 만들 수 있다.
- Word taskpane은 Office WebView의 웹 콘텐츠다. 일반 Office.js API에는 임의의 로컬 파일 읽기, Windows named pipe 연결, Tauri IPC 호출을 할 표준 권한이 없다. 따라서 InDesign/ExtendScript의 파일 bootstrap을 Word에 그대로 이식할 수 없다.
- 현재 taskpane은 실제 token 없이 `initializeWordAddin()`을 호출한다. 하드코딩된 개발용 fallback은 실제 서버의 keyring token과 다르므로, 현 상태의 핸드셰이크 실패는 설계상 필연적이다.

## 1. Word taskpane의 token 획득 방식

### 결론

**권고: 이번 Step 2에는 (b)의 1회 수동 입력을 개발 전용 bootstrap으로 채택한다. 다만 장기 token을 자동 조회하는 (a)는 채택하지 않고, 프로덕션 단계에서는 “사용자 승인 후 발급되는 일회성·짧은 수명의 pairing code를 세션으로 교환”하는 별도 흐름으로 교체한다.**

이는 zero-friction의 최종 형태는 아니지만, 지금의 목표인 실제 Word `CONNECTED` 검증에 필요한 가장 작은 변경 범위와 보안 경계를 가장 잘 함께 만족한다.

개발용 UI는 token 미설정/인증 실패일 때만 token 입력란과 연결 버튼을 보여 주고, 성공 후 해당 taskpane origin의 저장소에 보관하는 방식이면 충분하다. 입력값은 로그, 상태 문구, URL query, 오류 보고에 절대 포함하지 않아야 한다. 서버 token을 재생성하거나 사용자가 연결 해제를 선택했을 때에는 저장값을 지우고 다시 입력하게 한다. 이 저장값은 production credential store가 아니라 개발 편의용 cache라는 점을 명시해야 한다.

### (a) loopback `GET`으로 장기 token 반환

**권고: 현재 형태의 공개 `GET /pairing-token`은 채택하지 않는다.**

127.0.0.1 bind는 외부 네트워크에서 직접 접근할 수 없게 하지만, 같은 사용자 계정에서 실행되는 프로세스와 브라우저 콘텐츠를 신뢰하는 인증 수단은 아니다. 특히 현재의 wide-open CORS에서는 악성 웹 페이지가 loopback endpoint로 요청하고 token 응답을 읽을 위험을 키운다. CORS를 taskpane origin으로 좁힌 뒤에도 CORS는 브라우저의 읽기 정책일 뿐 native local process의 접근 통제가 아니며, XSS·origin takeover·로컬 개발 서버 탈취의 영향을 token 탈취로 확대한다.

또한 파일 export는 Windows ACL과 사용자 프로필 경계의 보호를 받는다. 같은 사용자 프로세스가 읽을 수 있다는 약점은 공유하지만, 임의 웹 origin에 HTTP 응답으로 secret를 제공하지는 않는다. endpoint 추가는 **기존 파일과 동등하지 않고, 브라우저 공격면을 추가하는 후퇴**다.

향후 자동화를 꼭 검토한다면 raw pairing token을 반환하지 않는 것이 최소 조건이다. 허용 origin을 정확히 제한한 endpoint, 명시적 사용자 승인, 매우 짧은 TTL과 단회 사용, 요청-응답 nonce 결속, rate limit을 갖춘 bootstrap grant를 세션으로 교환하는 설계가 필요하다. 그래도 local web origin을 authentication factor로 오해하면 안 되며, 이 설계는 제품 보안 검토 대상이다.

### (b) 사용자 1회 입력 후 저장

**권고: 이번 개발자-PC 검증의 기본안으로 채택한다.**

- 서버와 router의 보안 경계를 바꾸지 않는다. 즉, 현재 확인하려는 Word runtime, handshake, telemetry, replacement 왕복과 token 배포 문제를 분리할 수 있다.
- token이 이미 `pairing_token.txt`로 같은 사용자에게 제공되는 현 설계와 같은 capability를 사용자가 Word add-in에 명시적으로 부여한다. 자동 secret-read endpoint를 새로 만들지 않는다.
- 최초 한 번의 copy/paste 비용은 있지만, sideload·HTTPS·mixed content·shared runtime 같은 Step 2의 핵심 실패 원인을 가장 선명하게 분리한다.

한계도 명확하다. `localStorage`는 암호화 금고가 아니고 같은 origin의 script/XSS 위험을 상속한다. 따라서 이 방식은 개발용 local origin과 본인 PC라는 범위를 넘는 배포 credential 저장소로 승격하면 안 된다. Word가 재설치되거나 origin이 바뀌면 재입력이 필요한 것도 정상 동작으로 취급하는 편이 낫다.

### (c) Tauri 대시보드 → Word taskpane 별도 로컬 채널

**권고: 이번에는 설계·구현하지 않는다. 후속 제품 기능으로도 raw token 전달 채널이 아니라 승인된 pairing code 교환 모델로 한정한다.**

Tauri는 named pipe, Windows ACL이 적용된 파일, 자체 IPC를 쓸 수 있지만, Office.js taskpane은 그 채널의 client가 될 수 없다. named pipe를 taskpane이 직접 열거나 Tauri event를 구독하는 것은 표준 Office Add-in 기능이 아니다. 결국 browser가 읽을 수 있는 HTTP/WebSocket/custom-protocol relay를 새로 만들게 되며, 보안 검토 대상은 사라지지 않고 형태만 바뀐다.

원클릭 UX가 반드시 필요해지는 시점에는 다음 책임 분리가 적절하다.

```text
Tauri dashboard의 사용자 승인
  → 단회 pairing code 발급 (짧은 TTL, raw token 아님)
  → Word taskpane에 code 입력 또는 사용자가 시작한 연결 절차
  → local bridge가 code를 Word 전용의 제한된 session credential로 교환
```

이 방식에서도 dashboard와 taskpane 사이에 자동으로 값을 주입하는 일반적인 Office.js native channel은 없다. 따라서 “원클릭”을 위해 보안 경계를 우회하기보다, 승인된 code를 보여 주고 taskpane에서 한 번 확인하는 UX가 현실적이다.

### (d) Office Add-in에서의 표준 패턴

**권고: Office Add-in을 native companion으로 간주하지 말고, 웹 애플리케이션의 credential bootstrap 원칙을 적용한다.**

Office Add-in의 일반 패턴은 Office identity/SSO 또는 OAuth 같은 사용자·서버 기반 인증을 사용하고, add-in의 웹 origin에 사용자별 짧은 수명의 access/session token만 보관하는 것이다. 로컬 daemon의 장기 bearer secret를 add-in에 무인 배포하는 표준 Office.js API는 없다.

따라서 제품 배포에서 원격 사용자·여러 PC를 지원한다면 local bridge token 방식 자체를 사용자 인증 및 device pairing으로 재설계해야 한다. 예를 들어 dashboard가 로그인된 사용자와 device를 승인하고, Word가 OAuth/SSO 로그인 또는 사용자가 확인한 단회 code로 bridge session을 얻도록 한다. 이는 이번 Step 2의 전제는 아니다.

## 2. (a)의 신뢰 모델과 공격면

**권고: (a)를 파일 기반 접근과 동등하다고 보지 않는다. “같은 PC의 다른 프로세스”는 이미 신뢰 경계 밖으로 보아야 하지만, loopback HTTP는 그 경계에 브라우저 origin이라는 별도 공격면을 추가한다.**

다음 구분이 중요하다.

| 주체 | 파일 export | 공개 loopback token endpoint |
| --- | --- | --- |
| 다른 사용자 계정 | 파일 ACL에 따라 보통 차단 가능 | loopback listener의 OS 접근 규칙 및 host 설정에 의존 |
| 같은 사용자 native process | ACL이 허용하면 읽을 수 있음 | 요청만으로 읽을 수 있음 |
| 임의 웹 페이지 / WebView script | 일반적으로 파일을 직접 읽지 못함 | CORS/PNA/브라우저 정책이 허용되면 읽을 수 있음 |
| XSS·local-origin 탈취 | 파일 권한을 별도로 넘어야 함 | endpoint 호출로 즉시 장기 secret를 추출 가능 |

여기서 CORS는 권한 부여가 아니다. `Origin` header는 native client가 임의로 만들 수 있고, browser CORS는 응답을 JavaScript가 읽을지를 통제할 뿐 요청 자체나 local process를 인증하지 않는다. 현재 `Any` 허용은 특히 endpoint 방식과 결합하면 부적절하다. 127.0.0.1 bind도 DNS rebinding, localhost port collision, 악성 확장/웹 콘텐츠, 같은-user malware를 해결하지 않는다.

다만 같은 Windows 사용자 권한으로 실행되는 완전한 악성 프로그램은 파일, 브라우저 저장소, 프로세스 메모리, loopback traffic 중 여러 경로를 노릴 수 있다. 이 threat는 token 한 개로 완전히 해결할 수 없다. 그러므로 현실적인 경계는 “다른 사용자/원격 네트워크는 차단하고, 같은-user local compromise는 별도 endpoint로 더 쉽게 만들지 않는다”가 되어야 한다. 현 파일 export도 장기적으로는 최소 권한 ACL, token rotation/revocation, 로그 비노출을 검토할 가치가 있다.

## 3. 이번 최소 범위

**권고: 이번 완료 기준은 개발자 본인 PC에서 Word taskpane이 실제 token으로 `CONNECTED`가 되고 telemetry 및 replacement 왕복을 검증하는 데 한정한다. 프로덕션 배포 설계는 구현 범위에서 제외하되, 개발용 저장 방식이 production contract가 아니라는 경계는 지금 문서와 UI에 남긴다.**

현재 가장 큰 미확실성은 Word host에서 HTTPS taskpane, Office runtime, loopback bridge, WebSocket/REST 정책이 함께 동작하는지다. 이를 production identity·remote deployment·multi-device pairing과 묶으면 원인 분리가 어려워진다. 따라서 다음 순서가 적절하다.

1. 개발용 taskpane에서 실제 token을 1회 입력해 handshake가 성공하는지 확인한다.
2. 문단 선택 변경의 telemetry와 dashboard → Word replacement command → 결과 반송을 수동 smoke test한다.
3. token 미입력, 잘못된 token, 서버 재시작/token rotation, bridge 미기동의 오류 문구와 재입력 흐름을 확인한다.
4. 그 검증이 끝난 뒤에만 production의 identity, device approval, short-lived grant, manifest/hosting 분리를 별도 설계한다.

이 범위는 “zero-friction” 최종 UX를 포기하는 결정이 아니라, 인증 비밀의 배포와 Word runtime 검증을 의도적으로 분리하는 결정이다. 반대로 이번에 공개 token endpoint를 넣으면 Step 2는 빨라 보일 수 있으나, 이를 제거·교체해야 하는 보안 부채를 즉시 만든다.

## 결론

- **이번 Step 2:** 1회 수동 token 입력과 개발용 origin 저장을 사용한다. 하드코딩 fallback은 실제 pairing 수단으로 간주하지 않는다.
- **채택하지 않을 것:** 127.0.0.1이라는 이유만으로 장기 pairing token을 반환하는 공개 HTTP/WS endpoint. 현재 wide-open CORS에서는 특히 위험하다.
- **후속 제품 방향:** raw token 자동 전달이 아니라, 사용자 승인과 단회·짧은 수명의 pairing code/session 교환을 설계한다. Office.js에는 이 문제를 투명하게 해결하는 native local-secret API가 없다.
