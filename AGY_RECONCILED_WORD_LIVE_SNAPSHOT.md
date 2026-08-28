# Word Live Paragraph Snapshot — agy 최종 재조율 리포트

**문서 일자**: 2026-08-28  
**검토 대상**: [`AGY_SCOPING_WORD_LIVE_SNAPSHOT.md`](file:///D:/data/dev/App/SmartLinter/AGY_SCOPING_WORD_LIVE_SNAPSHOT.md), [`CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md`](file:///D:/data/dev/App/SmartLinter/CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md)  
**작성자**: agy (Advanced Agentic Assistant)

---

## 1. 개요 및 재조율 총평 (Executive Summary)

Codex의 스코핑 문서([`CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md`](file:///D:/data/dev/App/SmartLinter/CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md))를 면밀히 검토한 결과, **Fail-Closed 원칙 준수, 요청-응답 상관관계(Correlation) 메커니즘, Office.js의 비침습적(Non-invasive) 읽기 가능성** 등 핵심 아키텍처에 대한 두 모델의 기술적 판단은 완벽하게 일치합니다.

사용자께서 질의하신 세 가지 쟁점에 대한 **agy의 최종 재조율 입장**은 다음과 같습니다:

| 쟁점 | 초기 agy 안 | Codex 안 | **agy 최종 재조율 입장** |
| :--- | :--- | :--- | :--- |
| **1. 배치(Step 4) 포함 여부** | 1차에 단건+배치 동시 포함 | 단건 우선 완성 후 배치 분리 | **프로토콜/백엔드 스키마는 1차에 단일 배열 구조(`paragraphIds: string[]`)로 통합 배선하되, 검증 및 롤아웃은 단건(Gate) → 배치(Bulk/Restore) 순으로 단계적 진행** |
| **2. 타임아웃 값** | 2.5초 (2,500ms) | 3.0초 (3,000ms) | **3.0초 (3,000ms)로 통일 (Codex 안 전면 수용)** |
| **3. AMBIGUOUS 판정 로직** | 첫 번째 매치 조기 채택 (결함) | 전수 수집 후 후보 개수로 판정 | **agy 초안의 다중 후보 미감지 결함 인정 및 Codex의 전수 수집(Full-scan Collection) 안 100% 전면 수용** |

---

## 2. 쟁점 1: 배치(Step 4) 버전 스코프 및 구현 순서 재조율

### 2.1 현황 및 사실 관계 확인
- **프론트엔드 호출 현황**:
  - [`qaStore.ts:608`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L608): `applyAllMatchingCards` (Bulk Apply)에서 `getLiveParagraphSnapshots(targetParagraphIds)` 호출
  - [`qaStore.ts:779`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L779): `validateLiveCards` (Hydration Restore & Revalidate)에서 `getLiveParagraphSnapshots(paragraphIds)` 호출
  - [`qaStore.ts:964`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L964): 신규 카드 등록 시 `getLiveParagraphSnapshot(paragraphId, hash)` 단건 호출
- agy가 지적했듯, 만약 배치 Primitive가 제공되지 않으면 Word 환경에서 **"모두 적용(Bulk Apply)"** 및 **"앱 재기동 시 카드 복원(Hydration Restore)"**이 Fail-Closed 가드에 걸려 영구히 차단되는 것은 사실입니다.

### 2.2 Codex의 우려사항 분석 및 타당성
- Codex가 우려한 핵심은 **"Word의 실행 비용 모델과 동시성(Concurrency)"**입니다:
  - InDesign은 이미 상주 중인 데몬(`smartlinter_daemon.jsx`)에 COM 1회 왕복으로 단건/배치를 초고속 처리하지만, Word는 브라우저 런타임(WebView2) 환경에서 `context.document.body.paragraphs.load('text')`가 문서 크기에 비례합니다.
  - LLM 추론 후 신규 카드 단건 검증과 대시보드 포커스/스크롤에 의한 대규모 배치 검증이 동시에 발생할 경우, Word.run 실행 큐잉과 직렬화 정책이 부실하면 브리지에 병목이나 락이 걸릴 위험이 있습니다.

### 2.3 최종 재조율 결론: "통합 프로토콜 배선 + 단계적 롤아웃 검증"

> [!IMPORTANT]
> **프로토콜 구조를 단건/배치로 두 번 나누는 것은 불필요한 중복 작업과 마이그레이션 리스크를 유발합니다.**  
> 프로토콜 스키마와 Rust 세션 계층은 처음부터 **배열 기반 단일 메시지(`paragraphIds: string[]`)**로 완성하고, 실제 기능 활성화 및 테스트만 단계적으로 밟는 것이 가장 안전합니다.

1. **프로토콜 및 백엔드 단일화**:
   - `LIVE_SNAPSHOT_REQUEST` 프로토콜에 `paragraphIds: string[]`를 단일 채택합니다.
   - 단건 조회(`get_live_paragraph_snapshot`)는 `paragraphIds: [id]` (길이 1)로 발송하고, Rust 명령 레벨에서 결과 배열의 첫 번째 요소를 반환합니다.
   - 배치 조회(`get_live_paragraph_snapshots`)는 `paragraphIds: [id1, id2, ...]`로 발송하고 결과 배열 전체를 반환합니다.
   - 이렇게 하면 백엔드와 프로토콜은 단 1회의 작업으로 단건과 배치를 완벽하게 지원하며 추후 재수정 위험이 전혀 없습니다.
2. **구현 및 검증 단계(Rollout Sequence)**:
   - **Step A (단건 기반 무결성 검증)**: 단건 요청-응답 루프를 완성하고, LLM 추론 후 신규 카드 등록 게이트(Part 2)가 유령 카드 없이 정확히 통과/차단되는지 확인.
   - **Step B (배치 연계 및 동시성 큐잉 검증)**: 동일하게 열려있는 배치 채널을 통해 Bulk Apply 및 Hydration Restore(Part 4) 연계 동작과 대용량 문서 동시성 큐잉을 검증.

---

## 3. 쟁점 2: 타임아웃 값 (2.5초 vs 3.0초)

### 3.1 최종 결정: **3.0초 (3,000ms)로 통일**

### 3.2 합의 및 수용 근거
1. **시스템 일관성 (System Consistency)**:
   - [`plugins/word/src/bridge_client.ts:247`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/bridge_client.ts#L247)의 기존 REST 폴백 타임아웃이 `3000ms`로 정의되어 있습니다.
   - Word 브리지 관련 통신 데드라인을 3.0초로 통일함으로써 컴포넌트 간 타임아웃 불일치로 인한 예외적인 레이스 컨디션을 방지합니다.
2. **대용량 문서 여유 마진 (Headroom for Large Documents)**:
   - 수백~수천 문단의 대형 Word 문서에서 `body.paragraphs.load('text')` + Office.js DOM 동기화 및 WebView2 GC 지연이 발생할 경우, 2.5초보다는 3.0초가 약 500ms의 추가 여유를 제공하여 불필요한 `BUSY`(카드 드롭) 오판정을 억제합니다.
3. **UX 반응성과의 조화**:
   - 3.0초는 사용자가 체감하기에 UI 프리징으로 느끼지 않는 합리적인 상한선이며, 15초(치환 트랜잭션 타임아웃)와 명확히 분리된 스냅샷 전용 타임아웃으로 적절합니다.

---

## 4. 쟁점 3: AMBIGUOUS (동일 해시 다중 후보) 판정 로직

### 4.1 agy 초안의 결함 확인 및 인정
사용자 및 Codex의 지적이 **100% 정확**합니다.  
agy 스코핑 초안(6.2절)의 알고리즘은 다음과 같은 **심각한 결함**을 포함하고 있었습니다:

```typescript
// ⚠️ agy 초안의 결함 코드: 첫 번째 매치만 등록하고 이후 매치는 무시함
if (targetIdSet.has(pId) && !resultMap.has(pId)) {
  resultMap.set(pId, {
    paragraphId: pId,
    status: 'FOUND',
    currentText: text,
    currentHash: hash,
  });
}
```

- **결함 분석**:
  - 문서 내에 동일한 문장(예: 반복되는 "주의사항:", "참고사항", 짧은 제목 등)이 2개 이상 존재하여 12자리 해시 프리픽스가 일치하는 경우, 위 코드는 **첫 번째 문단만 `FOUND`로 채택**하고 이후 문단을 무시합니다.
  - 또한 Fast-Path(Selection)에서 일치 항목을 발견하면 조기 탈출(`return`)해 버리므로, 문서의 다른 위치에 동일 해시 문단이 존재하는지 여부를 알 수 없습니다.
  - 이로 인해 실전에서 전혀 다른 위치의 문단으로 오타 치환이 적용되거나 잘못된 스냅샷이 채택되는 **Silent Mis-targeting** 위험이 존재했습니다.

### 4.2 Codex 안 전면 수용: 전수 수집(Full-scan Collection) 기반 판정
2026-08-26 InDesign `atomic_replacer.jsx`의 [`scanStoryForHashMatches`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/atomic_replacer.jsx#L290-L296)에서 확립된 **"다중 매치 발생 시 휴리스틱으로 추측하지 않고 정직하게 AMBIGUOUS로 거부한다"**는 안전 원칙을 Word에도 100% 동일하게 관철합니다.

- **개정된 탐색 알고리즘**:
  1. Fast-Path 조기 탈출을 폐기하고, 문서 전체(`context.document.body.paragraphs`)를 전수 순회합니다.
  2. 요청된 각 `paragraphId`에 대해 일치하는 모든 문단 인스턴스를 배열로 수집합니다.
  3. 수집된 후보군 크기로 엄격 판정:
     - `candidates.length === 0` ➔ **`NOT_FOUND`**
     - `candidates.length === 1` ➔ **`FOUND`** (유일 매칭)
     - `candidates.length >= 2` ➔ **`AMBIGUOUS`** (안전한 거부, fail-closed drop)
  4. 단일 요청에 `baseHash`(Full SHA-256)가 포함된 경우, 12자리 프리픽스가 일치하더라도 전체 해시가 일치하지 않는 후보를 걸러내는 2차 검증을 수행합니다.

---

## 5. 개정된 Word Snapshot Provider 구현 명세

아래는 위 세 가지 합의 사항(단일/배치 통합 수용, 3.0s 타임아웃 호환, AMBIGUOUS 전수 수집)을 반영한 최종 TypeScript 구현 명세입니다:

```typescript
// plugins/word/src/snapshot_provider.ts
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import {
  LiveSnapshotRequest,
  LiveSnapshotResponse,
  LiveSnapshotItem,
} from '../../../shared/protocol/types.ts';

interface MatchedCandidate {
  text: string;
  hash: string;
}

export async function queryLiveParagraphSnapshots(
  request: LiveSnapshotRequest,
  wordRunner: (cb: (context: any) => Promise<any>) => Promise<any>
): Promise<LiveSnapshotResponse> {
  const targetIdSet = new Set(request.paragraphIds);
  // paragraphId -> MatchedCandidate[] (전수 후보 수집용)
  const candidateMap = new Map<string, MatchedCandidate[]>();
  for (const id of request.paragraphIds) {
    candidateMap.set(id, []);
  }

  try {
    await wordRunner(async (context: any) => {
      // 1. 문서 본문 전체 문단 비침습적 로드 (선택영역/포커스 불변)
      const bodyParas = context.document.body.paragraphs;
      bodyParas.load('text');
      await context.sync();

      // 2. 전수 스캔 및 후보군 수집
      if (bodyParas.items && bodyParas.items.length > 0) {
        for (const p of bodyParas.items) {
          const text = p.text || '';
          const hash = computeParagraphHash(text);
          const pId = `word-para-${hash.slice(0, 12)}`;

          if (targetIdSet.has(pId)) {
            const list = candidateMap.get(pId)!;
            list.push({ text, hash });
          }
        }
      }
    });

    // 3. 수집된 후보군 개수 기반 엄격 판정
    const results: LiveSnapshotItem[] = request.paragraphIds.map((id) => {
      const candidates = candidateMap.get(id) || [];

      // Case A: 일치하는 문단 없음
      if (candidates.length === 0) {
        return {
          paragraphId: id,
          status: 'NOT_FOUND',
          message: 'Paragraph not found in active Word document',
        };
      }

      // Case B: 동일 해시 문단이 2개 이상 존재 -> 안전 거부
      if (candidates.length > 1) {
        // 단, baseHash(Full SHA-256)가 제공된 경우 전체 해시로 추가 좁히기 시도
        if (request.baseHash) {
          const exactMatches = candidates.filter((c) => c.hash === request.baseHash);
          if (exactMatches.length === 1) {
            return {
              paragraphId: id,
              status: 'FOUND',
              currentText: exactMatches[0].text,
              currentHash: exactMatches[0].hash,
            };
          }
        }
        return {
          paragraphId: id,
          status: 'AMBIGUOUS',
          message: `Multiple (${candidates.length}) paragraphs matched paragraphId '${id}'`,
        };
      }

      // Case C: 정확히 1개 매칭 (유일성 확인 완료)
      const match = candidates[0];
      if (request.baseHash && match.hash !== request.baseHash) {
        return {
          paragraphId: id,
          status: 'NOT_FOUND',
          message: 'Paragraph hash mismatch with requested baseHash',
        };
      }

      return {
        paragraphId: id,
        status: 'FOUND',
        currentText: match.text,
        currentHash: match.hash,
      };
    });

    return { requestId: request.requestId, results };
  } catch (err: any) {
    return {
      requestId: request.requestId,
      results: request.paragraphIds.map((id) => ({
        paragraphId: id,
        status: 'ERROR',
        message: `Office.js snapshot error: ${err?.message || String(err)}`,
      })),
    };
  }
}
```

---

## 6. 최종 합의된 구현 실행 로드맵

두 모델의 합의를 토대로 확정된 최종 실행 로드맵은 다음과 같습니다:

```mermaid
graph TD
    subgraph Step 1: 프로토콜 및 코어 배선
        A["shared/protocol types.ts<br/>(단일 배열 스키마 LIVE_SNAPSHOT_REQUEST/RESPONSE)"]
        B["src-tauri messages.rs & session.rs<br/>(pending correlation & 3.0s timeout)"]
        C["plugins/word snapshot_provider.ts<br/>(전수 수집 & AMBIGUOUS 안전 판정)"]
        A --> B
        A --> C
    end

    subgraph Step 2: 단건 게이트 검증 (Phase 1)
        D["commands.rs Word 비동기 분기 연결"]
        E["Word 환경에서 LLM 추론 후<br/>신규 QA 카드 실시간 등록/차단 e2e 검증"]
        B --> D
        C --> D
        D --> E
    end

    subgraph Step 3: 배치 기능 활성화 및 동시성 검증 (Phase 2)
        F["commands.rs get_live_paragraph_snapshots 연계"]
        G["Bulk Apply (모두 적용) & Hydration Restore 검증"]
        H["대용량 문서 Word.run 동시성 큐잉 안정성 실측"]
        E --> F
        F --> G
        F --> H
    end
```

---
*본 문서는 2026-08-28 agy와 Codex의 스코핑 답변 재조율을 거쳐 작성된 최종 합의 리포트입니다.*
