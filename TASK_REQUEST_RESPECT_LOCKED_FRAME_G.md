# 태스크 G: 잠긴 InDesign 프레임/레이어에 대한 치환 방어

Codex/agy 공동 진단(BUG_ANALYSIS4_CODEX.md, BUG_ANALYSIS4_AGY.md)을 바탕으로 한 안전성 수정입니다.
InDesign에서 `Object > Lock`으로 잠근 텍스트 프레임/레이어는 사용자가 "이 내용은 확정됐으니
건드리지 말라"는 의도로 잠근 경우가 많은데, 현재 `atomic_replacer.jsx`는 잠금 여부를 전혀 확인하지
않고 조용히 덮어씁니다(실제 라이브 테스트로 확인됨 — InDesign 스크립팅 특성상 잠금이 텍스트 DOM
쓰기 자체는 막지 않기 때문). 이걸 SmartLinter 쪽에서 명시적으로 방어해야 합니다.

## 요청 사항

### 1. ExtendScript: 치환 실행 전 잠금 검사 (핵심, 필수)

`plugins/indesign/extendscript/atomic_replacer.jsx`의 `execute()` 시작 부분, 대상 문단을
찾은 직후(트랜잭션 시작 전)에 잠금 여부를 검사하는 로직을 추가하세요. agy가 제시한 아래 방식을
참고하되, 정확한 InDesign API 세부사항은 Codex가 직접 확인해서 구현하세요:

```javascript
function isParagraphLocked(paragraph) {
    if (!paragraph || !paragraph.isValid) return false;
    var frames = paragraph.parentTextFrames;
    if (frames && frames.length > 0) {
        for (var i = 0; i < frames.length; i++) {
            var frame = frames[i];
            if (frame && frame.isValid) {
                if (frame.locked === true) return true;
                if (frame.itemLayer && frame.itemLayer.locked === true) return true;
            }
        }
    }
    return false;
}
```

- 잠긴 것으로 판단되면 트랜잭션(`app.doScript`)을 시작하지 말고 즉시
  `{ status: 'FAILED', message: '해당 텍스트 프레임 또는 레이어가 잠겨 있어 수정할 수 없습니다. InDesign에서 잠금을 해제한 후 다시 시도해 주세요.' }`
  형태로 반환하세요(기존 FAILED 반환 패턴과 동일하게).
- **주의**: `locateParagraph`(위치 보기)는 이 가드를 적용하지 마세요 — 선택/스크롤은 잠긴 항목에도
  안전하고, 사용자가 잠긴 문단이 어디 있는지 확인하는 것 자체는 막을 이유가 없습니다. 이번 가드는
  `execute()`(실제 치환)에만 적용합니다.
- 관련 기존 테스트를 깨지 마세요. 잠긴 프레임/잠긴 레이어 각각에 대해 FAILED로 안전하게 거부하는
  회귀 테스트를 추가하세요(mock 문단 객체에 `locked`/`itemLayer.locked`를 설정해서 검증).

### 2. 텔레메트리에 잠금 상태 포함 (사전 UX, 권장)

`plugins/indesign/extendscript/text_observer.jsx`의 `getActiveParagraph`/`captureActiveParagraph`가
생성하는 payload에 `isLocked: boolean` 필드를 추가하세요(위 1번과 같은 판정 로직 재사용 — 텍스트
옵저버 파일에 있는 게 자연스러우면 거기로 옮기고 atomic_replacer.jsx에서 import해서 같이 써도
됩니다. 중복 구현하지 마세요).

`shared/protocol/types.ts`의 `ParagraphPayload`와 대응하는 Rust 타입에 `isLocked?: boolean`
(옵셔널, 기존 호출부 깨지지 않게)을 추가하세요.

### 3. 프론트엔드: 잠긴 문단 카드 표시 + 사전 비활성화 (권장)

`src/types/qa.ts`의 `QACardData`에 `isLocked?: boolean`을 추가하고, `qaStore.ts`의 `addCard`/
`addReport`가 텔레메트리의 `isLocked` 값을 카드에 실어 나르도록 하세요.

`src/components/qa/QACardItem.tsx`에서 `card.isLocked`가 true면:
- 🔒 자물쇠 아이콘 등으로 시각적 표시.
- [적용] 버튼을 비활성화하고, 툴팁이나 짧은 안내로 "잠긴 프레임/레이어입니다"를 보여주세요.
- [위치 보기]/[무시]는 그대로 동작해야 합니다(적용만 막습니다).
- 단, 이 프론트엔드 사전 차단은 UX 개선일 뿐이고, 1번의 ExtendScript 가드가 최종 방어선입니다 —
  카드 생성 후 사용자가 나중에 잠갔을 수도 있으니 실제 치환 시점에도 반드시 재검사해야 합니다(이미
  1번에 포함됨).

기존 테스트를 깨지 마세요. 새 동작에 대한 테스트도 추가하세요.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build`가 전부 통과해야 합니다.
