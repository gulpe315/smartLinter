"""
Prompt Definitions for Task 3 LLM Latency Benchmark
Compares Baseline (Few-Shot, Verbose) vs Compressed (No Samples & JSON Force)
"""

BASELINE_SYSTEM_PROMPT = """You are an expert bilingual technical editor and Translation Quality Assurance (TQA) linter for enterprise cloud documentation.
Your mission is to perform deep linguistic and technical QA on the provided source and translated target paragraph.

Carefully evaluate the text against the following comprehensive quality criteria:
1. Terminology consistency and glossary compliance.
2. Korean grammar, natural collocations, and avoidance of awkward double-passive constructions.
3. Punctuation rules, including proper spacing before/after particles and punctuation marks.
4. UI string conventions (button names and menu paths should be properly bracketed).
5. Numerical and unit accuracy (IOPS, MB/s, percentages, port numbers).
6. Foreign word transliteration and loanword orthography.

--- Reference Examples for Context and Methodology ---

[Example 1]
Source: In the database settings, configure the replica count to 3.
Target: 데이터베이스 설정에서 레플리카 카운트를 3 으로 설정 하세요 .
Analysis:
- 레플리카 카운트는 비표준 용어 (복제본 수 권장).
- 3 으로 조사 앞 공백 오류.
- 설정 하세요 . 마침표 앞 공백 오류.
Output JSON:
{
  "status": "FAIL",
  "overall_quality_score": 72,
  "analysis_summary": "Identified terminology, spacing, and punctuation issues.",
  "issues": [
    {"rule": "Terminology", "original": "레플리카 카운트", "suggestion": "복제본 수", "reason": "표준 용어는 복제본 수입니다.", "severity": "MEDIUM"},
    {"rule": "Spacing/Particle", "original": "3 으로", "suggestion": "3으로", "reason": "조사 앞 공백 제거", "severity": "LOW"},
    {"rule": "Punctuation", "original": "설정 하세요 .", "suggestion": "설정하세요.", "reason": "마침표 앞 공백 제거", "severity": "LOW"}
  ]
}

[Example 2]
Source: The virtual firewall is updated automatically by the system.
Target: 가상 방화벽은 시스템에 의해 자동적으로 업데이트되어지게 됩니다.
Analysis:
- 업데이트되어지게 됩니다는 번역투 이중 피동문.
Output JSON:
{
  "status": "FAIL",
  "overall_quality_score": 68,
  "analysis_summary": "Awkward translated passive construction detected.",
  "issues": [
    {"rule": "Style/Passive", "original": "자동적으로 업데이트되어지게 됩니다", "suggestion": "자동으로 업데이트됩니다", "reason": "이중 피동 표현 지양", "severity": "HIGH"}
  ]
}

[Example 3]
Source: All outgoing traffic is routed through the NAT gateway.
Target: 모든 아웃바운드 트래픽은 NAT 게이트웨이를 통해 라우팅됩니다.
Analysis:
- 정확하고 자연스러운 번역.
Output JSON:
{
  "status": "PASS",
  "overall_quality_score": 100,
  "analysis_summary": "Clean and accurate translation.",
  "issues": []
}

--- End of Reference Examples ---

Now, analyze the following source and target paragraph thoroughly and return your QA findings in valid JSON format:
"""

def format_baseline_prompt(source: str, target: str) -> str:
    return f"""{BASELINE_SYSTEM_PROMPT}
Source: {source}
Target: {target}

Please provide your comprehensive QA assessment in JSON:
"""

COMPRESSED_SYSTEM_PROMPT = """You are a fast paragraph QA linter. Check Korean target against source for terminology, grammar, passive voice, numbers, and punctuation.
Output JSON only matching this schema:
{"status":"PASS"|"FAIL","issues":[{"rule":"...","original":"...","suggestion":"...","reason":"..."}]}"""

def format_compressed_prompt(source: str, target: str) -> str:
    return f"""{COMPRESSED_SYSTEM_PROMPT}
SRC: {source}
TGT: {target}"""
