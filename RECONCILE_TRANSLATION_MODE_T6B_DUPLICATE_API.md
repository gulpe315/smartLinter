# 재조율: T6b InDesign 문서 복제 API 사실관계 정정

`RECONCILED_TRANSLATION_MODE_T6.md` §2.2("`sourceDoc.duplicate()`로
복제 문서 생성")는 **틀렸다.** T6b 구현 지시서 작성을 위해 코드/API를
조사하던 중 발견해, 구현 착수 전에 먼저 재조율한다.

## 확인된 사실관계

Claude가 InDesign ExtendScript 공식 API 문서
(https://www.indesignjs.de/extendscriptAPI/indesign-latest/Document.html,
Adobe InDesign 2026 21.0.0.192 Object Model)에서 `Document` 클래스의
Methods 섹션 **전체 85개 메서드를 빠짐없이 나열**해 확인했다.
`duplicate()`는 목록에 없다. (`close`, `save`, `saveACopy`, `revert`,
`saveAsCloud`, `saveACopyCloud`는 있음 — 전체 목록은 이 문서 하단 참고.)

추가로 웹 검색 결과도 이를 뒷받침한다: "duplicate 메서드는 페이지/
캐릭터/그룹 단위에만 있고 문서 전체 단위는 없다, 문서 전체를
복제하려면 `saveACopy()` 계열을 쓴다"는 커뮤니티 설명과, InDesign
스크립팅 커뮤니티 예제들이 실제로 `app.activeDocument =
app.documents.itemByName(...)` 식으로 활성 문서를 **명시적으로
전환**하는 관용구를 쓰는 것도 확인했다(즉 "새 문서를 만들면 자동으로
activeDocument가 된다"는 것도 duplicate 이외의 경로, 예를 들어 `app.open()`
쪽에서나 성립하는 이야기이지 존재하지 않는 `duplicate()`엔 애초에
해당 사항이 없다).

동시에, T6b 지시서 작성을 위한 코드 조사에서
`plugins/indesign/extendscript/atomic_replacer.jsx`의
`SmartLinterAtomicReplacer.prototype.execute`(540번째 줄)이
`options.doc` 같은 파라미터를 받지 않고 항상
`inApp.activeDocument`(565~581번째 줄 4곳)로 대상 문서를 암묵
도출한다는 것도 확인했다 — 이 역시 §2.3("이미 doc을 파라미터로 받는
구조라 리팩터링 불필요")과 다르다.

## 제안하는 정정 흐름 (Claude 1차 제안, 확정 아님)

InDesign에는 메모리 상의 "숨은 복제 문서" 개념 자체가 없다(Word의
`Word.DocumentCreated`에 대응하는 게 없음) — 복제는 항상 디스크 파일을
거쳐야 한다는 게 이번에 드러난 핵심 차이다. 제안:

1. §5 재스캔/검증 통과 후, ExtendScript 내장 `Folder.temp`(OS 임시
   디렉토리, 별도 Tauri/Rust 의존성 불필요)에 충돌 없는 임시 파일명으로
   `sourceDoc.saveACopy(tempFile)` — 이 시점에 실제 디스크에 사본이
   생긴다(Word와 달리 이 복제 단계 자체가 이미 "쓰기"임, 원본은
   `saveACopy`가 원본을 변경하지 않는다는 API 계약을 신뢰).
2. `app.open(tempFile)` — InDesign에서 문서를 열면 그 문서가
   `app.activeDocument`가 되는 것은 매우 표준적이고 안정적인 동작(모든
   InDesign 스크립트가 이를 전제로 함) — 이게 사실이면
   `atomic_replacer.jsx`를 **전혀 리팩터링할 필요가 없다**(암묵적
   `activeDocument` 참조가 그대로 맞아떨어짐). **agy/Codex에게 이 전제
   자체도 재검증을 요청한다** — Claude는 이게 업계에서 당연하게
   쓰이는 동작이라고 알고 있으나 §2.2처럼 API 표면 자체를 잘못 알고
   있었던 전례가 방금 있었으므로, 두 자문 모두 이것도 다시 한번
   확인/반박해달라.
3. 기존 `atomic_replacer.jsx` 엔진으로 문단별 치환 적용(§5 이중
   fingerprint 대조 포함, 기존 T3b 재시도 패턴과 동일 계층에서 Rust
   COM 배선 신설 필요 — 이 부분은 T6b 지시서에서 별도 다룸).
4. 실패 시: 연 임시 문서를 `close(SaveOptions.NO)`로 닫고, 1번에서
   만든 임시 파일을 **디스크에서 실제로 삭제**한다(Word처럼 "저장 안
   하면 그냥 사라짐"이 아니라, 이미 디스크에 쓰인 실제 파일이므로
   명시적 삭제 스텝이 반드시 필요 — 빠뜨리면 임시 디렉토리에 고아
   파일이 쌓인다). 원본은 1번의 `saveACopy`가 원본을 건드리지 않는다는
   계약에 의해 항상 무변경.
5. 성공 시: Tauri `tauri-plugin-dialog`로 사용자가 최종 저장 경로를
   선택하게 하고 `doc.saveAs(finalFile)`로 그 경로에 저장(열어둔 채
   유지). `saveAs` 이후 1번의 임시 파일이 디스크에 그대로 남는지
   (rename이 아니라 새 위치에 별도 저장이라 원래 임시 파일 경로가
   orphan으로 남을 가능성)도 확인해 필요하면 `saveAs` 성공 직후 임시
   파일을 별도로 삭제하는 스텝을 추가해야 한다.

## agy/Codex에게 요청하는 것

1. `Document.duplicate()`가 정말 존재하지 않는다는 결론에 동의하는가?
   (동의 안 하면 구체적 근거 API 문서/버전을 제시해달라 — Claude가
   확인한 건 InDesign 2026(21.0.0.192) 기준 한 사이트뿐이므로 다른
   근거가 있다면 재검토할 것.)
2. 위 "제안하는 정정 흐름" 1~5번이 타당한가, 특히 "`app.open()`이 연
   문서를 자동으로 activeDocument로 만든다"는 전제가 실제로 안전하게
   기댈 수 있는 동작인가(버전/플랫폼 차이 위험은 없는가)?
3. 임시 파일의 실패 시 삭제/성공 시 orphan 정리를 Rust(Tauri fs)와
   ExtendScript(`File.remove()`) 중 어느 계층에서 담당하는 게 이
   프로젝트의 기존 책임 분리 원칙(예: Word T6a가 "원본 접근은 항상
   플러그인 로컬에서 끝난다"는 원칙을 지킨 것)과 일관적인가?
4. 이 정정이 §3(서식 Materializer, T6c)이나 §4(본문 외 콘텐츠 보존)
   의 다른 전제에 영향을 주는가? (Claude 판단으로는 duplicate 방식이
   바뀌어도 "문서 전체가 통째로 복제된다"는 결과 자체는 동일하게
   유지되므로 영향 없어 보이지만, 확인 요청.)

명령 실행이나 파일 쓰기 없이, 파일 읽기만 하세요(agy) / 읽기 전용이므로
파일 조회 명령은 자유롭게 쓰셔도 됩니다(codex) — 이 프로젝트 자체를
수정하지 말고 이 문서에 대한 답변만 텍스트로 달라.

## 참고: `Document` Methods 전체 목록(확인용, 85개)

addEventListener, adjustLayout, align, asynchronousExportFile,
changeColor, changeComposer, changeGlyph, changeGrep, changeObject,
changeText, changeTransliterate, checkIn, clearFrameFittingOptions,
close, colorTransform, createAlternateLayout, createEmailQRCode,
createFromMathML, createHyperlinkQRCode, createMissingFontObject,
createPlainTextQRCode, createTOC, createTextMsgQRCode,
createVCardQRCode, deleteAlternateLayout, deleteUnusedTags,
distribute, embed, exportFile, exportForCloudLibrary,
exportPageItemsSelectionToSnippet, exportPageItemsToSnippet,
exportStrokeStyles, extractLabel, findColor, findGlyph, findGrep,
findObject, findText, findTransliterate, getAlternateLayoutsForFolio,
getElements, getSelectedTextDirection, getStyleConflictResolutionStrategy,
handleMathMLMessage, importAdobeSwatchbookProcessColor,
importAdobeSwatchbookSpotColor, importDtd, importFormats,
importPdfComments, importStyles, importXML, insertLabel,
internalMethod, loadConditions, loadMasters, loadSwatches,
loadXMLTags, mapStylesToXMLTags, mapXMLTagsToStyles, packageForPrint,
place, placeAndLink, placeCloudAsset, print, printBooklet, recompose,
redo, removeEventListener, resetAllButtons, resetAllMultiStateObjects,
revert, revertToProject, save, saveACopy, saveACopyCloud, saveAsCloud,
saveSwatches, saveXMLTags, select, synchronizeWithVersionCue, toSource,
toSpecifier, undo, updateCrossReferences
