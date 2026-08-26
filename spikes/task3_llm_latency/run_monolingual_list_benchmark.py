"""Paired live benchmark for the monolingual Korean comma-list prompt variants."""
import json
import statistics
import sys
import time
from pathlib import Path

from benchmark_runner import calculate_percentile, query_ollama_streaming
from dataset import load_dataset
from prompts import format_monolingual_variant_prompt

MODEL = "exaone3.5:7.8b"
VARIANTS = ("current", "A", "B")
CASE_IDS = (
    "monolingual_weekdays_clean_list",
    "monolingual_weekdays_suffix_typo",
    "monolingual_weekdays_spacing_error",
    "monolingual_ordinary_typo_control",
)
REPETITIONS = 3

def issue_text(parsed):
    if not isinstance(parsed, dict):
        return ""
    return json.dumps(parsed.get("issues", []), ensure_ascii=False).lower()

def verdict(case_id, result):
    text = issue_text(result["parsed_json"])
    status = (result["parsed_json"] or {}).get("status", "").upper() if isinstance(result["parsed_json"], dict) else ""
    if case_id == "monolingual_weekdays_clean_list":
        return {"pass_or_no_invented_comma_issue": status == "PASS" or ("spacing" not in text and "punctuation" not in text and "쉼표" not in text and "," not in text)}
    if case_id == "monolingual_weekdays_suffix_typo":
        typo = "일오일" in text and ("일요일" in text or "오타" in text or "맞춤" in text or "typo" in text)
        spacing_only = ("spacing" in text or "punctuation" in text or "공백" in text or "쉼표" in text) and not typo
        return {"identifies_typo_not_spacing": typo and not spacing_only}
    if case_id == "monolingual_weekdays_spacing_error":
        return {"catches_real_spacing": "일요일" in text and ("spacing" in text or "공백" in text or "띄어" in text or "쉼표" in text or "," in text)}
    return {"catches_ordinary_typo": "합니디" in text and ("합니다" in text or "오타" in text or "맞춤" in text or "typo" in text)}

def main():
    cases = {case["id"]: case for case in load_dataset() if case["id"] in CASE_IDS}
    if set(cases) != set(CASE_IDS):
        raise RuntimeError("Targeted monolingual cases are missing from dataset.json")
    records = []
    print(f"Warming {MODEL} with the exact variant-A path (excluded from metrics)...", flush=True)
    warm = query_ollama_streaming(format_monolingual_variant_prompt(cases[CASE_IDS[0]]["target"], "A"), model=MODEL, force_json=True)
    print(f"Warm-up: {warm['wall_latency_ms']}ms JSON={warm['json_valid']}", flush=True)
    for repetition in range(1, REPETITIONS + 1):
        for case_id in CASE_IDS:
            for variant in VARIANTS:
                result = query_ollama_streaming(format_monolingual_variant_prompt(cases[case_id]["target"], variant), model=MODEL, force_json=True)
                result.update({"case_id": case_id, "variant": variant, "repetition": repetition, "verdict": verdict(case_id, result)})
                records.append(result)
                print(f"r{repetition} {case_id} {variant}: {result['wall_latency_ms']}ms json={result['json_valid']} {result['verdict']}", flush=True)
    summaries = {}
    for variant in VARIANTS:
        group = [record for record in records if record["variant"] == variant]
        case_summary = {}
        for case_id in CASE_IDS:
            matches = [record for record in group if record["case_id"] == case_id]
            key = next(iter(matches[0]["verdict"]))
            case_summary[case_id] = {"metric": key, "passed_runs": sum(record["verdict"][key] for record in matches), "total_runs": len(matches)}
        latencies = [record["wall_latency_ms"] for record in group]
        summaries[variant] = {"cases": case_summary, "mean_latency_ms": round(statistics.mean(latencies), 2), "p95_latency_ms": round(calculate_percentile(latencies, 95), 2), "json_valid_rate_pct": round(100 * sum(record["json_valid"] for record in group) / len(group), 2), "mean_prompt_tokens": round(statistics.mean(record["prompt_tokens"] for record in group), 2)}
    output = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "model": MODEL, "repetitions": REPETITIONS, "warmup": warm, "summaries": summaries, "records": records}
    path = Path(__file__).parent / "monolingual_list_benchmark_results.json"
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summaries, ensure_ascii=False, indent=2))
    print(f"Saved {path}")

if __name__ == "__main__":
    main()
