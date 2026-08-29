# Task: 번역 모드 T2 구현 1차 후속 — agy 리뷰 Medium 결함 2건 수정

agy의 독립 코드 리뷰에서 Medium 결함 2건이 발견됐다. Claude가 코드로
재확인했고 둘 다 실제 결함이다. High는 없었다.

## 결함 1(Medium) — `URL.revokeObjectURL`을 클릭 직후 동기 호출

`src/components/layout/Header.tsx`의 `handleTranslationExport`에서
`anchor.click()` 직후 같은 틱에 `URL.revokeObjectURL(url)`을 동기
호출한다. WebView2(Tauri의 Windows 렌더링 엔진)에서 `anchor.click()`이
트리거하는 다운로드 파이프라인은 비동기적으로 Blob 스트림을 읽으므로,
그 전에 URL을 취소하면 I/O 부하 상황이나 특정 환경에서 다운로드 실패나
0바이트 파일이 생길 위험이 있다.

**고칠 방법**: `URL.revokeObjectURL(url)` 호출을 지연시킬 것(표준
관행대로 `setTimeout(() => URL.revokeObjectURL(url), 1000)` 정도). 정확한
지연 시간은 판단해서 정해도 된다 — 핵심은 즉시 동기 해제를 피하는 것.

**테스트**: 기존 "exports session segments through a Blob download"
테스트(`Header.test.tsx`)가 `revokeObjectURL`이 호출됐는지만 확인하고
있다면, 이제 **지연 호출**(예: 가짜 타이머 `vi.useFakeTimers()` +
`vi.advanceTimersByTime(...)`로 즉시는 호출 안 되고 지연 후에 호출됨을
확인)로 검증을 보강할 것.

## 결함 2(Medium) — 검증 완료 후에도 실패 안내 배너가 화면에 남음

`Header.tsx`의 `translationExportMessage`는 export 클릭이 실패했을 때
(`검증 필요 세그먼트 M개가 있습니다...`) 설정되고, **성공했을 때만**
`null`로 지워진다. 사용자가 실패 메시지를 본 뒤 에디터에서 해당 문단을
다시 방문해 `needsValidationCount`가 0으로 돌아와도, 배너는 지워지지
않고 (게다가 클릭 시점에 캡처된 옛 M 값 그대로) 화면에 계속 남는다 —
export 버튼 자체는 정상적으로 다시 활성화되므로 실제 기능은 안
막히지만, 사용자에게 혼란을 주는 낡은 안내문이다.

**고칠 방법**: `needsValidationCount`가 0으로 바뀌면 그 메시지를
자동으로 지울 것(예: `useEffect`로 `needsValidationCount === 0`일 때
`setTranslationExportMessage(null)`).

**테스트**: `needsValidationCount > 0`으로 배너를 띄운 뒤,
`needsValidationCount`가 0이 되도록 `segments`를 갱신하면 배너가
사라지는지 확인하는 테스트를 추가할 것.

## 참고(수정 안 해도 됨, 판단만)

agy가 Low 2건도 지적했다 — (a) `buildXliffDocument` 호출 시
`originalFileName`을 안 넘겨서 항상 기본값(`smartlinter_export`)으로
고정되는 것(`useBridgeStore().activeDocument`를 넘기면 개선 가능), (b)
`sortSegments`의 동시각 tie-break에 대한 테스트 보강. 둘 다 이번
라운드에서 반드시 고칠 필요는 없다 — 시간이 남으면 (a)만 가볍게
반영해도 되고, 아니면 그냥 건너뛰어도 된다(과설계 금지, T2는 여전히
스파이크 스코프).

## 절대 제약

- Rust는 여전히 건드리지 않는다.
- 이번 라운드는 위 결함 2건 수정 + 테스트만 한다(참고 항목은 선택).
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고 결과를 응답으로
정리해 출력할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
