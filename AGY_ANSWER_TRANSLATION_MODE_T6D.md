# agy 답변: 번역 모드 T6d 설계 자문 (Q1~Q7)

`DESIGN_REQUEST_TRANSLATION_MODE_T6D.md`에 대한 agy의 독립 설계 답변
전문. Codex와의 재조율 결과(분할 단위/표 우선순위/Word.run 취소
메커니즘 3가지 쟁점)는 agy 원안 그대로 수렴됐으므로 별도 정정 없음
— 최종 확정본은 `RECONCILED_TRANSLATION_MODE_T6D.md` 참고.

## 기본 설계 철학 및 안전 불변식

1. 원본 불변(Read-Only Source): T6의 모든 하위 작업은 원본 문서를
   절대 수정·저장하지 않고 독립 복제본에만 쓴다.
2. Fail-Closed 원자성: fingerprint 불일치, 서식 적용 실패, 사용자
   취소, timeout 발생 시 불완전한 파일은 저장되지 않으며, 임시
   파일은 즉시 정리된다.

## Q1. 분할 여부

2개의 하위 구현 라운드 + 1개의 계약 확정으로 분할.
- **T6d-1**: 대용량 생성 제어 인프라(진행률 스트리밍, 협업적 취소,
  적응형 timeout). 최우선 — 현재 본문 전용 번역에서도 대용량 문서
  timeout/무반응 위험이 상존.
- **T6d-2**: 본문 외 콘텐츠 확장 1단계(표 컨테이너 지원).
- **T6d-Contract**: T7 경계 명문화(구현 없이 문서만).

## Q2. 본문 외 콘텐츠 확장 난이도/최소범위/XLIFF 노출

표(Medium) 1순위, 각주/미주(High), 머리말/바닥글(Very High)는 후속.
- Word 표: `document.body.tables` → row → cell → paragraph로
  결정론적 접근 가능.
- InDesign: `document_scanner.jsx`가 이미 `TABLE` kind를 감지·카운트.
- XLIFF 노출은 반드시 container metadata를 가진 구조로(예:
  `type="table-cell"`, `location="table:0;row:1;cell:2;p:0"") —
  번역사가 표 셀임을 식별해야 하고, 생성기가 원래 container로
  안전하게 재탐색할 정보가 필요.

## Q3. 진행률 단계/단위

Phase 기반 + 문단 카운트 혼합형. PREPARING(0~15%) → VERIFYING(15~30%)
→ MATERIALIZING(30~85%, count 기반 선형보간) → FINALIZING(85~100%).
Word 제약 해소: 단일 `Word.run` 내에서 전체를 한 번에 sync하지 않고
N문단 단위(예: 50)로 청크 분할해 매 청크마다 `await context.sync()`
후 진행 이벤트 emit. 기존 `TranslationScanProgressBar`의 디자인
토큰은 재사용, `statusMessage`/`percentage`/`Cancel Button`은 신규.

## Q4. 취소 유효 지점과 보장 사항

Point of No Return: Word는 `created.open()` 호출 이후, InDesign은
`saveAs()` 성공 이후. 그 전에는 각 Phase 진입 전 및 청크 경계마다
`isCancelled` 확인. 취소 시 InDesign은 `close(SaveOptions.NO)`+
temp 삭제, Word는 `open()` 미호출로 `DocumentCreated` 폐기. 응답은
`{ requestId, status: 'CANCELLED', ... }`. 이미 성공/저장된 뒤의
취소 요청은 결과를 뒤집지 않고 "이미 완료되어 저장됨"으로 안내.

## Q5. Timeout/대용량 정책

고정 시간 증액 대신 적응형 timeout + heartbeat 기반 liveness
watchdog. 진행률 이벤트가 도착할 때마다 idle 타이머를 리셋(예:
30초), 진척이 없을 때만 hang으로 간주해 timeout. Rust
`pending_document_generations`가 timeout 시 pending entry를 제거한
뒤 늦게 도착하는 host 응답은 로그만 남기고 조용히 drop, host
플러그인은 자체 정리(temp 삭제)를 보장.

## Q6. T6d/T7 경계

| 구분 | T6d(복제본 빌더) | T7(bilingual 원본 편집기) |
| --- | --- | --- |
| 대상 문서 | 새 독립 복제본 | 열려 있는 원본 문서 자체 |
| 원본 권한 | Strict Read-Only | In-Place Write |
| 데이터 흐름 | 단방향 빌드 | 양방향 동기화·충돌 해결 |
| 실패 정책 | Fail-Closed, 복제본만 폐기 | 원본 롤백/백업 복원 |
| 기본 활성 | 기본 활성 | 기본 비활성 |

T7 세부 정의(bilingual layout, 변경 감지, 동기화 방향, conflict
policy, 백업/복구)는 확정 문서에서 찾지 못했으므로 이번 라운드는
상위 경계 문서화로 충분, 세부는 미정으로 남김.

## Q7. 검증 fixture/테스트 범위

fixture: 표 포함 문서(기본 표/병합 셀/표 내 다중 문단), 대용량
문서(1000+ 문단, 청크·watchdog 검증용), fingerprint mismatch 유발
문서. Mock 시나리오: 협업적 취소(materializing 50% 시점 취소 주입 →
temp 삭제+목적지 미생성 검증), Rust timeout+late-drop, progress
이벤트 단조증가 검증. 회귀: 원본 SHA-256 해시 불변, InDesign 임시
폴더 파일 잔존 0개.
