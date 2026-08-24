//! SmartLinter Translation Memory (TM) & Guideline Loader Integration Tests
//!
//! Validates:
//! (1) TMX (XML) and JSON TM parsers (inline tags, entity decoding, language pairs)
//! (2) In-Memory N-gram + Levenshtein fuzzy matcher with Top-N ranking (75% ~ 100%)
//! (3) 10,000 Translation Units benchmark (< 50ms query response time requirement)
//! (4) .agents and custom QA rule parsing & PromptBuilder injection
//! (5) TM empty state flags and graceful handling

use std::time::Instant;

use smart_linter::ai::prompt_builder::{format_compressed_prompt_with_guidelines, PromptBuilder};
use smart_linter::tm::{
    clean_segment_text, compute_levenshtein, compute_similarity, normalize_text,
    parse_json_tm, parse_tm_content, parse_tmx, tokenize_ngrams, FuzzyMatcher, GuidelineLoader,
    GuidelineSet, MatcherConfig, QaRule, TmEntry, TmMatchGrade, TmStatus,
};

// ===========================================================================
// 1. TMX and JSON TM Parser Tests
// ===========================================================================

#[test]
fn test_tmx_parser_full_spec_and_entities() {
    let tmx_content = r#"<?xml version="1.0" encoding="utf-8"?>
<tmx version="1.4">
  <header creationtool="SmartLinter" creationtoolversion="1.0"
          segtype="sentence" o-tmf="ATM" adminlang="en"
          srclang="en" datatype="plaintext" />
  <body>
    <tu tuid="tu_101">
      <tuv xml:lang="en-US">
        <seg>Click <bpt i="1">&lt;b&gt;</bpt>Save &amp; Continue<ept i="1">&lt;/b&gt;</ept> to proceed.</seg>
      </tuv>
      <tuv xml:lang="ko-KR">
        <seg>진행하려면 <bpt i="1">&lt;b&gt;</bpt>저장 &amp; 계속<ept i="1">&lt;/b&gt;</ept>을 클릭하십시오.</seg>
      </tuv>
    </tu>
    <tu tuid="tu_102">
      <tuv lang="en">
        <seg>Virtual Private Cloud (VPC) provides isolated network environments.</seg>
      </tuv>
      <tuv lang="ko">
        <seg>VPC(Virtual Private Cloud)는 격리된 네트워크 환경을 제공합니다.</seg>
      </tuv>
    </tu>
    <tu tuid="tu_103">
      <tuv xml:lang="en">
        <seg>The maximum file size is &lt; 100 MB &quot;standard&quot; &#39;limit&#39;.</seg>
      </tuv>
      <tuv xml:lang="ko">
        <seg>최대 파일 크기는 100 MB 미만 &quot;표준&quot; &#39;한도&#39;입니다.</seg>
      </tuv>
    </tu>
  </body>
</tmx>"#;

    let entries = parse_tmx(tmx_content).expect("TMX parsing should succeed");
    assert_eq!(entries.len(), 3);

    // Unit 1: inline tags and &amp; decoding
    assert_eq!(entries[0].id.as_deref(), Some("tu_101"));
    assert_eq!(entries[0].source, "Click Save & Continue to proceed.");
    assert_eq!(entries[0].target, "진행하려면 저장 & 계속을 클릭하십시오.");
    assert_eq!(entries[0].source_lang.as_deref(), Some("en-US"));
    assert_eq!(entries[0].target_lang.as_deref(), Some("ko-KR"));

    // Unit 2: standard sentence
    assert_eq!(entries[1].id.as_deref(), Some("tu_102"));
    assert_eq!(
        entries[1].source,
        "Virtual Private Cloud (VPC) provides isolated network environments."
    );
    assert_eq!(
        entries[1].target,
        "VPC(Virtual Private Cloud)는 격리된 네트워크 환경을 제공합니다."
    );

    // Unit 3: entity decoding (&lt;, &gt;, &quot;, &#39;)
    assert_eq!(entries[2].id.as_deref(), Some("tu_103"));
    assert_eq!(
        entries[2].source,
        "The maximum file size is < 100 MB \"standard\" 'limit'."
    );
    assert_eq!(
        entries[2].target,
        "최대 파일 크기는 100 MB 미만 \"표준\" '한도'입니다."
    );
}

#[test]
fn test_json_tm_parser_all_schema_variants() {
    // Schema 1: Array of objects
    let json_array = r#"[
      { "id": "arr-1", "source": "Create new instance", "target": "새 인스턴스 생성", "sourceLang": "en", "targetLang": "ko" },
      { "src": "Delete resource", "tgt": "리소스 삭제" }
    ]"#;
    let entries_arr = parse_json_tm(json_array).expect("JSON array TM should parse");
    assert_eq!(entries_arr.len(), 2);
    assert_eq!(entries_arr[0].id.as_deref(), Some("arr-1"));
    assert_eq!(entries_arr[0].source, "Create new instance");
    assert_eq!(entries_arr[0].target, "새 인스턴스 생성");
    assert_eq!(entries_arr[1].source, "Delete resource");
    assert_eq!(entries_arr[1].target, "리소스 삭제");

    // Schema 2: Object wrapper with entries
    let json_wrapper = r#"{
      "sourceLang": "en",
      "targetLang": "ko",
      "entries": [
        { "id": 1, "source": "Network Interface", "target": "네트워크 인터페이스" },
        { "id": 2, "source": "Security Group", "target": "보안 그룹" }
      ]
    }"#;
    let entries_wrap = parse_json_tm(json_wrapper).expect("JSON wrapper TM should parse");
    assert_eq!(entries_wrap.len(), 2);
    assert_eq!(entries_wrap[0].source_lang.as_deref(), Some("en"));
    assert_eq!(entries_wrap[0].target_lang.as_deref(), Some("ko"));
    assert_eq!(entries_wrap[1].source, "Security Group");

    // Schema 3: Key-Value translation map
    let json_map = r#"{
      "translations": {
        "Auto Scaling": "오토 스케일링",
        "Load Balancer": "로드 밸런서"
      }
    }"#;
    let entries_map = parse_json_tm(json_map).expect("JSON map TM should parse");
    assert_eq!(entries_map.len(), 2);
}

#[test]
fn test_auto_detect_tm_format() {
    let tmx = "<tmx><body><tu><tuv><seg>Src</seg></tuv><tuv><seg>Tgt</seg></tuv></tu></body></tmx>";
    let json = r#"[{"source": "Src", "target": "Tgt"}]"#;

    let res_tmx = parse_tm_content(tmx, None).expect("Auto detect TMX");
    assert_eq!(res_tmx.len(), 1);

    let res_json = parse_tm_content(json, None).expect("Auto detect JSON");
    assert_eq!(res_json.len(), 1);
}

#[test]
fn test_tm_utility_functions() {
    let cleaned = clean_segment_text("<b>Title</b> &amp; <i>Subtitle</i>");
    assert_eq!(cleaned, "Title & Subtitle");

    let norm = normalize_text("  Click   the   SUBMIT   button.  ");
    assert_eq!(norm, "click the submit button.");

    let ngrams = tokenize_ngrams("cloud", 2);
    assert_eq!(ngrams, vec!["cl", "lo", "ou", "ud"]);

    let dist = compute_levenshtein("kitten", "sitting");
    assert_eq!(dist, 3);

    let sim = compute_similarity("kitten", "sitting");
    assert!(sim > 0.50 && sim < 0.65);
}

// ===========================================================================
// 2. Fuzzy Matcher & Scoring Tests
// ===========================================================================

#[test]
fn test_fuzzy_matcher_exact_and_similarity_scoring_tiers() {
    let entries = vec![
        TmEntry::new(
            "Click the Submit button to finalize your configuration.",
            "설정을 완료하려면 Submit 버튼을 클릭하십시오.",
        )
        .with_id("TU-01"),
        TmEntry::new(
            "Click the Cancel button to discard all changes.",
            "모든 변경 사항을 삭제하려면 Cancel 버튼을 클릭하십시오.",
        )
        .with_id("TU-02"),
        TmEntry::new(
            "Configure the virtual machine instance CPU and memory specifications.",
            "가상 머신 인스턴스 CPU 및 메모리 사양을 구성합니다.",
        )
        .with_id("TU-03"),
    ];

    let matcher = FuzzyMatcher::from_entries(entries);

    // 1. Exact match (100% -> Exact tier)
    let exact_res = matcher.search("Click the Submit button to finalize your configuration.");
    assert!(!exact_res.is_empty());
    assert_eq!(exact_res[0].score, 1.0);
    assert_eq!(exact_res[0].grade, TmMatchGrade::Exact);
    assert_eq!(exact_res[0].score_percent(), 100.0);
    assert!(exact_res[0].is_exact_match());

    // 2. High similarity match (1 word modified: ~88% -> High tier)
    let high_res = matcher.search("Click the Submit button to complete your configuration.");
    assert!(!high_res.is_empty());
    assert!(high_res[0].score >= 0.85 && high_res[0].score < 1.0);
    assert_eq!(high_res[0].grade, TmMatchGrade::High);
    assert_eq!(high_res[0].tu_id.as_deref(), Some("TU-01"));

    // 3. Medium similarity match (~75% ~ 84% -> Medium tier)
    let med_res = matcher.search("Click the Next button to finalize configuration.");
    assert!(!med_res.is_empty());
    assert!(med_res[0].score >= 0.75);

    // 4. Low similarity / Irrelevant query (< 75% -> filtered out)
    let low_res = matcher.search("Database backup retention policy settings.");
    assert!(low_res.is_empty(), "Should reject matches below 75%");
}

#[test]
fn test_fuzzy_matcher_top_n_ranking_order() {
    let entries = vec![
        TmEntry::new("To configure network gateway, open the console.", "네트워크 게이트웨이를 구성하려면 콘솔을 엽니다.").with_id("1"),
        TmEntry::new("To configure network routes, open the console.", "네트워크 라우트를 구성하려면 콘솔을 엽니다.").with_id("2"),
        TmEntry::new("To configure network gateway, open the admin panel.", "네트워크 게이트웨이를 구성하려면 관리자 패널을 엽니다.").with_id("3"),
        TmEntry::new("To deploy network gateway, open the console.", "네트워크 게이트웨이를 배포하려면 콘솔을 엽니다.").with_id("4"),
    ];

    let config = MatcherConfig {
        min_score: 0.75,
        top_n: 3,
        ngram_size: 2,
        ngram_filter_threshold: 0.25,
    };
    let matcher = FuzzyMatcher::with_config(config);
    let mut matcher = matcher;
    matcher.load_entries(entries, Some("network.tmx".to_string()));

    // Query closest to entry 1
    let query = "To configure network gateway, open the console.";
    let matches = matcher.search_with_params(query, 3, 0.75);

    assert_eq!(matches.len(), 3);
    // Rank 1 must be exact match (score 1.0)
    assert_eq!(matches[0].tu_id.as_deref(), Some("1"));
    assert_eq!(matches[0].score, 1.0);

    // Scores must be strictly in descending order
    assert!(matches[0].score >= matches[1].score);
    assert!(matches[1].score >= matches[2].score);
}

// ===========================================================================
// 3. Empty State Handling Tests
// ===========================================================================

#[test]
fn test_empty_tm_state_and_flags() {
    let mut matcher = FuzzyMatcher::new();
    assert!(matcher.is_empty());
    assert_eq!(matcher.len(), 0);
    assert!(matches!(matcher.status(), TmStatus::Empty));
    assert!(matcher.status().is_empty());
    assert_eq!(matcher.status().entry_count(), 0);

    // Search on empty matcher returns empty results immediately without panic
    let results = matcher.search("Test query string");
    assert!(results.is_empty());

    // Load then clear
    matcher.load_entries(
        vec![TmEntry::new("Hello", "안녕하세요")],
        Some("test.tmx".to_string()),
    );
    assert!(!matcher.is_empty());
    assert_eq!(matcher.len(), 1);
    assert_eq!(matcher.status().entry_count(), 1);

    matcher.clear();
    assert!(matcher.is_empty());
    assert_eq!(matcher.len(), 0);
    assert!(matches!(matcher.status(), TmStatus::Empty));
}

// ===========================================================================
// 4. Guideline Loader & PromptBuilder Integration Tests
// ===========================================================================

#[test]
fn test_guideline_loader_markdown_and_json_parsing() {
    // 1. Markdown .agents content
    let md_content = r#"# Technical Documentation QA Guidelines
Standards for Korean technical translation and review.

## Terminology
- [UI Button] Do not translate UI action button names like [Submit], [Cancel]
- [Brand] Always retain "SmartLinter" in English

## Honorifics & Style
- Use standard polite honorific ending (-하십시오, -합니다)
- Avoid redundant passive voice (-되어집니다)

## Punctuation
- Retain code markdown blocks `code` and placeholders intact
"#;

    let md_guidelines = GuidelineLoader::load_from_str(md_content, Some(".agents"))
        .expect("Failed to parse markdown guidelines");

    assert_eq!(md_guidelines.name, "Technical Documentation QA Guidelines");
    assert_eq!(md_guidelines.rules.len(), 5);

    let prompt_rules = md_guidelines.build_prompt_rules();
    assert!(prompt_rules.contains("- [UI Button] Do not translate UI action button"));
    assert!(prompt_rules.contains("- [Brand] Always retain \"SmartLinter\""));
    assert!(prompt_rules.contains("- [Honorifics & Style] Use standard polite honorific"));

    // 2. JSON qa_rules.json content
    let json_rules = r#"{
      "name": "Custom Product Rules",
      "rules": [
        { "id": "TERM-01", "category": "Terminology", "description": "Keep VPC untranslated", "severity": "HIGH" },
        { "id": "NUM-01", "category": "Formatting", "description": "Ensure space before unit (100 MB)", "severity": "MEDIUM" }
      ]
    }"#;

    let json_guidelines = GuidelineLoader::load_from_str(json_rules, Some("qa_rules.json"))
        .expect("Failed to parse JSON guidelines");

    assert_eq!(json_guidelines.name, "Custom Product Rules");
    assert_eq!(json_guidelines.rules.len(), 2);
    assert_eq!(json_guidelines.rules[0].id.as_deref(), Some("TERM-01"));

    let json_prompt_rules = json_guidelines.build_prompt_rules();
    assert!(json_prompt_rules.contains("- [Terminology] Keep VPC untranslated"));
    assert!(json_prompt_rules.contains("- [Formatting] Ensure space before unit (100 MB)"));

    // 3. Programmatic builder test
    let custom_set = GuidelineSet::new("Custom Set")
        .with_rule(QaRule::new("RuleCat", "Custom Rule Desc").with_severity("HIGH"));
    assert_eq!(custom_set.len(), 1);
    assert_eq!(custom_set.build_prompt_rules(), "- [RuleCat] Custom Rule Desc");
}

#[test]
fn test_guideline_prompt_builder_seamless_integration() {
    let md_content = r#"## Terminology
- Do not translate product name "SmartLinter"
## Style
- Always use polite honorifics (하십시오)
"#;

    let guidelines = GuidelineLoader::load_from_str(md_content, Some(".agents"))
        .expect("Parse guidelines");
    let rules_str = guidelines.build_prompt_rules();

    let src = "SmartLinter provides automated real-time quality assurance.";
    let tgt = "SmartLinter는 자동화된 실시간 품질 보증을 제공합니다.";

    let prompt = format_compressed_prompt_with_guidelines(src, tgt, Some(&rules_str));

    assert!(prompt.contains("Guidelines:"));
    assert!(prompt.contains("Do not translate product name \"SmartLinter\""));
    assert!(prompt.contains("Always use polite honorifics (하십시오)"));
    assert!(prompt.contains("SRC: SmartLinter provides automated real-time quality assurance."));
    assert!(prompt.contains("TGT: SmartLinter는 자동화된 실시간 품질 보증을 제공합니다."));

    let builder_prompt = PromptBuilder::new()
        .source(src)
        .target(tgt)
        .guidelines(rules_str)
        .build_prompt();

    assert!(builder_prompt.contains("Guidelines:"));
}

// ===========================================================================
// 5. 10,000 Translation Units Performance Benchmark (<50ms requirement)
// ===========================================================================

/// Generates a realistic synthetic Translation Memory dataset with N translation units.
fn generate_synthetic_tm(count: usize) -> Vec<TmEntry> {
    let prefixes = [
        "To create a new",
        "To configure the",
        "To delete the selected",
        "Click the",
        "Navigate to the",
        "Ensure that the",
        "Verify that your",
        "The system will automatically",
        "In order to initialize",
        "You can customize the",
    ];

    let components = [
        "virtual machine instance",
        "Virtual Private Cloud network",
        "load balancer listener",
        "security group inbound rule",
        "block storage volume snapshot",
        "relational database cluster",
        "Kubernetes worker node pool",
        "identity access management role",
        "object storage bucket policy",
        "DNS private zone record",
    ];

    let actions = [
        "and select the desired configuration parameters.",
        "and restart the daemon to apply changes.",
        "from the management dashboard sidebar.",
        "according to your organization's security policy.",
        "before launching production workloads.",
        "in the target availability zone.",
        "with the specified backup retention period.",
        "to ensure high availability and disaster recovery.",
        "using the command-line interface or REST API.",
        "without interrupting active user sessions.",
    ];

    let ko_prefixes = [
        "새로운",
        "지정된",
        "선택한",
        "대시보드에서",
        "콘솔로 이동하여",
        "시스템이 자동으로",
        "보안 정책에 따라",
        "안정적인 운영을 위해",
        "초기화를 진행하려면",
        "원하는 설정으로",
    ];

    let ko_components = [
        "가상 머신 인스턴스를",
        "VPC 네트워크를",
        "로드 밸런서 리스너를",
        "보안 그룹 인바운드 규칙을",
        "블록 스토리지 볼륨 스냅샷을",
        "관계형 데이터베이스 클러스터를",
        "쿠버네티스 워커 노드 풀을",
        "IAM 접근 권한 역할을",
        "오브젝트 스토리지 버킷을",
        "DNS 전용 영역 레코드를",
    ];

    let ko_actions = [
        "생성하고 설정 파라미터를 지정하십시오.",
        "구성하고 데몬을 재시작하여 적용하십시오.",
        "삭제하고 확인 대화상자에서 승인하십시오.",
        "검토하고 조직의 보안 지침을 준수하십시오.",
        "운영 환경 배포 전에 반드시 확인하십시오.",
        "해당 가용 영역에 안전하게 배치하십시오.",
        "백업 보존 기간을 지정하여 설정하십시오.",
        "고가용성 및 재해 복구를 위해 활성화하십시오.",
        "CLI 또는 REST API를 통해 관리하십시오.",
        "사용자 세션 중단 없이 원활하게 반영하십시오.",
    ];

    let mut entries = Vec::with_capacity(count);

    for i in 0..count {
        let p_idx = i % prefixes.len();
        let c_idx = (i / prefixes.len()) % components.len();
        let a_idx = (i / (prefixes.len() * components.len())) % actions.len();

        let source = format!("{} {} {} (ID: #{})", prefixes[p_idx], components[c_idx], actions[a_idx], i);
        let target = format!("{} {} {} (ID: #{})", ko_prefixes[p_idx], ko_components[c_idx], ko_actions[a_idx], i);

        entries.push(
            TmEntry::new(source, target)
                .with_id(format!("TU-{:06}", i))
                .with_languages("en-US", "ko-KR"),
        );
    }

    entries
}

#[test]
fn test_benchmark_10k_translation_units_under_50ms() {
    const TM_SIZE: usize = 10_000;
    println!("\n========================================================");
    println!("  Task 6 Benchmark: 10,000 TU In-Memory Matcher Latency");
    println!("========================================================");

    // 1. Synthetic data generation & index construction
    let gen_start = Instant::now();
    let entries = generate_synthetic_tm(TM_SIZE);
    let gen_duration = gen_start.elapsed();
    assert_eq!(entries.len(), TM_SIZE);
    println!("  [1] Generated {} synthetic TUs in {:?}", TM_SIZE, gen_duration);

    let load_start = Instant::now();
    let matcher = FuzzyMatcher::from_entries(entries);
    let load_duration = load_start.elapsed();
    assert_eq!(matcher.len(), TM_SIZE);
    println!("  [2] Built In-Memory Index (10,000 TUs) in {:?}", load_duration);

    // 2. Query Benchmark Suite (Realistic varied queries)
    let test_queries = vec![
        // Query 1: Exact Match (Fast path)
        ("Exact Match Query", "To create a new virtual machine instance and select the desired configuration parameters. (ID: #0)"),
        // Query 2: Close Fuzzy Match (1-2 word change, ~90% similarity)
        ("High Fuzzy Query (90%)", "To configure a new virtual machine instance and select the desired configuration parameters. (ID: #0)"),
        // Query 3: Medium Fuzzy Match (~78% similarity)
        ("Medium Fuzzy Query (78%)", "To create a new virtual machine instance and choose the configuration options. (ID: #0)"),
        // Query 4: Middle of dataset match
        ("Mid-Dataset Fuzzy Query", "To delete the selected block storage volume snapshot in the target availability zone. (ID: #5000)"),
        // Query 5: End of dataset exact match
        ("Tail Exact Query", "You can customize the DNS private zone record without interrupting active user sessions. (ID: #9999)"),
        // Query 6: Completely Irrelevant Query (Pruning speed)
        ("Negative/Irrelevant Query", "Supercalifragilisticexpialidocious quantum computing algorithm encryption matrix"),
    ];

    println!("\n  [3] Executing Query Latency Benchmark (Threshold: 75%, Top 5):");
    println!("  --------------------------------------------------------");

    let mut latencies_micros: Vec<u128> = Vec::new();

    for (label, query) in &test_queries {
        // Warm-up run
        let _ = matcher.search_with_params(query, 5, 0.75);

        // Measured run
        let start = Instant::now();
        let results = matcher.search_with_params(query, 5, 0.75);
        let elapsed = start.elapsed();
        let elapsed_micros = elapsed.as_micros();
        latencies_micros.push(elapsed_micros);

        let elapsed_ms = elapsed.as_secs_f64() * 1000.0;
        println!(
            "  * {:<28} : {:>7.3} ms ({:>6} µs) | Matches: {}",
            label, elapsed_ms, elapsed_micros, results.len()
        );

        // Strict acceptance criteria: Must be strictly under 50ms!
        assert!(
            elapsed_ms < 50.0,
            "Query '{}' took {:.3} ms which exceeds the 50ms ceiling requirement!",
            label,
            elapsed_ms
        );
    }

    // 3. Aggregate Statistical Summary
    let total_micros: u128 = latencies_micros.iter().sum();
    let mean_micros = total_micros as f64 / latencies_micros.len() as f64;
    let mean_ms = mean_micros / 1000.0;
    let max_micros = *latencies_micros.iter().max().unwrap();
    let max_ms = max_micros as f64 / 1000.0;

    println!("  --------------------------------------------------------");
    println!("  Benchmark Summary (10,000 TUs):");
    println!("  - Mean Query Response Time: {:.3} ms ({:.1} µs)", mean_ms, mean_micros);
    println!("  - Worst Query Response Time: {:.3} ms ({} µs)", max_ms, max_micros);
    println!("  - Acceptance Criteria (<50ms): PASS (Faster by ~{:.1}x)", 50.0 / mean_ms.max(0.001));
    println!("========================================================\n");

    assert!(mean_ms < 50.0);
    assert!(max_ms < 50.0);
}
