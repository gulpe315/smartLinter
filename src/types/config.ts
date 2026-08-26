/**
 * SmartLinter Configuration, Models, Guidelines, and Translation Memory Types
 *
 * Provides strongly-typed models aligned with Rust AI/TM backend structures.
 */

export interface ModelDetails {
  parentModel?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameterSize?: string;
  quantizationLevel?: string;
  contextLength?: number;
  embeddingLength?: number;
}

export interface ModelInfo {
  name: string;
  model: string;
  modifiedAt?: string;
  sizeBytes: number;
  digest?: string;
  details?: ModelDetails;
  parameterSize?: string;
  quantizationLevel?: string;
  vramWarning: boolean;
  vramWarningReason?: string;
}

export interface QaRule {
  id?: string;
  category: string;
  description: string;
  severity?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  example?: string;
}

/** v1 QA languages use BCP-47 primary subtags; extend this union with future profiles. */
export type LanguageTag = 'ko' | 'en' | 'ja' | 'zh';

export interface GuidelineSet {
  language: LanguageTag;
  name: string;
  description?: string;
  rules: QaRule[];
  rawContent: string;
}

export interface TmEntry {
  id?: string;
  source: string;
  target: string;
  sourceLang?: string;
  targetLang?: string;
}

/**
 * Evaluates whether a model exceeds the safe 8GB VRAM budget.
 * Threshold: > 5.5 GB disk size or parameter size > 8B (e.g. 14B, 32B, 70B).
 */
export function evaluateVramWarning(
  sizeBytes: number,
  parameterSize?: string
): { vramWarning: boolean; vramWarningReason?: string } {
  const VRAM_SAFE_SIZE_LIMIT_BYTES = 5_500_000_000; // ~5.12 GiB

  let warning = false;
  const reasons: string[] = [];

  if (sizeBytes > VRAM_SAFE_SIZE_LIMIT_BYTES) {
    warning = true;
    const sizeGb = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2);
    reasons.push(`모델 크기(${sizeGb} GB)가 8GB VRAM 권장 안전 한도(~5.12 GiB)를 초과합니다.`);
  }

  if (parameterSize) {
    const trimmed = parameterSize.trim().toUpperCase();
    if (trimmed.endsWith('B')) {
      const numVal = parseFloat(trimmed.slice(0, -1));
      if (!isNaN(numVal) && numVal > 8.0) {
        warning = true;
        reasons.push(`파라미터 크기(${numVal}B)가 8GB VRAM 권장 한도(8.0B)를 초과합니다.`);
      }
    } else if (
      trimmed.includes('14B') ||
      trimmed.includes('32B') ||
      trimmed.includes('70B') ||
      trimmed.includes('72B')
    ) {
      warning = true;
      reasons.push(`대형 파라미터 아키텍처(${trimmed})가 감지되었습니다.`);
    }
  }

  return {
    vramWarning: warning,
    vramWarningReason: warning ? reasons.join(' ') : undefined,
  };
}

/**
 * Built-in default guidelines when no custom project file is provided.
 */
export const DEFAULT_GUIDELINES: GuidelineSet = {
  language: 'ko',
  name: '기본 표준 가이드라인 (Built-in)',
  description: 'SmartLinter 기본 제공 한국어 기술문서 표준 번역 및 교정 규칙',
  rules: [
    {
      id: 'R-01',
      category: 'Terminology',
      description: '표준 용어에 맞춰 UI 버튼 및 메뉴명을 일관되게 번역하고, 제품명은 원문을 유지합니다.',
      severity: 'HIGH',
      example: 'Good: [설정] 버튼을 클릭하세요 / Bad: 옵션 단추를 누르세요',
    },
    {
      id: 'R-02',
      category: 'Style',
      description: '모든 문장에 정중한 경어체(하십시오/해요체)를 일관되게 적용합니다.',
      severity: 'HIGH',
      example: 'Good: 문서를 저장하십시오 / Bad: 문서를 저장해라',
    },
    {
      id: 'R-03',
      category: 'Formatting',
      description: '모든 플레이스홀더, 인라인 태그, 각주 [^1], 마크다운 링크 [text](url)를 손상 없이 보존합니다.',
      severity: 'HIGH',
      example: 'Good: [공식 문서](https://example.com) 참조 / Bad: 공식 문서 참조',
    },
    {
      id: 'R-04',
      category: 'Grammar',
      description: '불필요한 피동형(되어지다, 되어진다) 및 어색한 번역투 표현을 지양하고 능동형으로 작성합니다.',
      severity: 'MEDIUM',
      example: 'Good: 설정을 변경할 수 있습니다 / Bad: 설정의 변경이 가능해집니다',
    },
    {
      id: 'R-05',
      category: 'Punctuation',
      description: '한국어 맞춤법 및 띄어쓰기 규정을 준수하며, 단위 표기 앞에는 공백을 유지합니다.',
      severity: 'LOW',
      example: 'Good: 10 GB 용량 / Bad: 10GB용량',
    },
  ],
  rawContent: `# 기본 표준 가이드라인
- [Terminology] 표준 용어에 맞춰 UI 버튼 및 메뉴명을 일관되게 번역하고, 제품명은 원문을 유지합니다.
- [Style] 모든 문장에 정중한 경어체(하십시오/해요체)를 일관되게 적용합니다.
- [Formatting] 모든 플레이스홀더, 인라인 태그, 각주 [^1], 마크다운 링크 [text](url)를 손상 없이 보존합니다.
- [Grammar] 불필요한 피동형(되어지다, 되어진다) 및 어색한 번역투 표현을 지양하고 능동형으로 작성합니다.
- [Punctuation] 한국어 맞춤법 및 띄어쓰기 규정을 준수하며, 단위 표기 앞에는 공백을 유지합니다.
`,
};
