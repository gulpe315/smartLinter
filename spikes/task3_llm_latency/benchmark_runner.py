"""
LLM Latency Benchmark Runner for Task 3
Connects to Ollama API, executes streaming QA queries, collects latency & TPS metrics,
validates JSON outputs, and computes p50/p90/p95 statistics.
"""

import json
import math
import statistics
import subprocess
import time
import urllib.request
from typing import Dict, List, Any, Optional

from dataset import load_dataset
from prompts import format_baseline_prompt, format_compressed_prompt

OLLAMA_API_URL = "http://127.0.0.1:11434/api/generate"

def get_gpu_vram_info() -> Dict[str, Any]:
    """Query NVIDIA GPU memory via nvidia-smi."""
    try:
        cmd = ["nvidia-smi", "--query-gpu=memory.used,memory.free,memory.total,utilization.gpu", "--format=csv,noheader,nounits"]
        output = subprocess.check_output(cmd, encoding="utf-8").strip()
        used, free, total, util = [x.strip() for x in output.split(",")]
        return {
            "vram_used_mb": float(used),
            "vram_free_mb": float(free),
            "vram_total_mb": float(total),
            "gpu_util_pct": float(util)
        }
    except Exception as e:
        return {"vram_used_mb": 0.0, "vram_free_mb": 0.0, "vram_total_mb": 8192.0, "gpu_util_pct": 0.0, "error": str(e)}

def query_ollama_streaming(
    prompt: str,
    model: str = "qwen2.5:7b",
    force_json: bool = False,
    temperature: float = 0.1
) -> Dict[str, Any]:
    """
    Sends a streaming generate request to Ollama and records precise timestamps.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_ctx": 4096
        }
    }
    if force_json:
        payload["format"] = "json"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_API_URL,
        data=data,
        headers={"Content-Type": "application/json"}
    )

    t_start = time.perf_counter()
    ttft_ms: Optional[float] = None
    chunks_received = 0
    full_response_text = ""
    server_meta: Dict[str, Any] = {}

    with urllib.request.urlopen(req, timeout=120) as resp:
        for line in resp:
            line = line.strip()
            if not line:
                continue
            chunk = json.loads(line.decode("utf-8"))
            chunks_received += 1
            text_piece = chunk.get("response", "")
            full_response_text += text_piece

            if ttft_ms is None and text_piece:
                ttft_ms = (time.perf_counter() - t_start) * 1000.0

            if chunk.get("done", False):
                server_meta = chunk

    t_end = time.perf_counter()
    total_wall_latency_ms = (t_end - t_start) * 1000.0
    if ttft_ms is None:
        ttft_ms = total_wall_latency_ms

    # Telemetry metrics from Ollama
    prompt_eval_count = server_meta.get("prompt_eval_count", 0)
    prompt_eval_dur_ms = server_meta.get("prompt_eval_duration", 0) / 1e6
    prompt_eval_tps = (prompt_eval_count / (prompt_eval_dur_ms / 1000.0)) if prompt_eval_dur_ms > 0 else 0.0

    eval_count = server_meta.get("eval_count", 0)
    eval_dur_ms = server_meta.get("eval_duration", 0) / 1e6
    gen_tps = (eval_count / (eval_dur_ms / 1000.0)) if eval_dur_ms > 0 else 0.0

    total_server_dur_ms = server_meta.get("total_duration", 0) / 1e6
    load_dur_ms = server_meta.get("load_duration", 0) / 1e6

    # JSON validation
    json_valid = False
    parsed_json = None
    try:
        clean_text = full_response_text.strip()
        if "```json" in clean_text:
            clean_text = clean_text.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_text:
            clean_text = clean_text.split("```")[1].split("```")[0].strip()
        parsed_json = json.loads(clean_text)
        if isinstance(parsed_json, dict) and ("status" in parsed_json or "issues" in parsed_json):
            json_valid = True
    except Exception:
        json_valid = False

    return {
        "wall_latency_ms": round(total_wall_latency_ms, 2),
        "ttft_ms": round(ttft_ms, 2),
        "prompt_tokens": prompt_eval_count,
        "prompt_eval_time_ms": round(prompt_eval_dur_ms, 2),
        "prompt_eval_tps": round(prompt_eval_tps, 2),
        "gen_tokens": eval_count,
        "gen_time_ms": round(eval_dur_ms, 2),
        "gen_tps": round(gen_tps, 2),
        "total_server_dur_ms": round(total_server_dur_ms, 2),
        "load_dur_ms": round(load_dur_ms, 2),
        "json_valid": json_valid,
        "raw_response": full_response_text,
        "parsed_json": parsed_json
    }

def calculate_percentile(data: List[float], p: float) -> float:
    """Compute percentile (0~100)."""
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = (len(sorted_data) - 1) * (p / 100.0)
    floor_idx = math.floor(idx)
    ceil_idx = math.ceil(idx)
    if floor_idx == ceil_idx:
        return sorted_data[int(idx)]
    return sorted_data[floor_idx] * (ceil_idx - idx) + sorted_data[ceil_idx] * (idx - floor_idx)

def compute_statistics(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate aggregate summary statistics."""
    n = len(records)
    if n == 0:
        return {}

    latencies = [r["wall_latency_ms"] for r in records]
    ttfts = [r["ttft_ms"] for r in records]
    gen_tokens = [r["gen_tokens"] for r in records]
    prompt_tokens = [r["prompt_tokens"] for r in records]
    gen_tpss = [r["gen_tps"] for r in records]
    prompt_eval_tpss = [r["prompt_eval_tps"] for r in records]
    json_valid_count = sum(1 for r in records if r["json_valid"])

    def stat_dict(arr: List[float]) -> Dict[str, float]:
        return {
            "mean": round(statistics.mean(arr), 2),
            "median": round(statistics.median(arr), 2),
            "p90": round(calculate_percentile(arr, 90), 2),
            "p95": round(calculate_percentile(arr, 95), 2),
            "min": round(min(arr), 2),
            "max": round(max(arr), 2),
            "stddev": round(statistics.stdev(arr) if len(arr) > 1 else 0.0, 2)
        }

    return {
        "sample_count": n,
        "json_valid_rate_pct": round((json_valid_count / n) * 100.0, 2),
        "wall_latency_ms": stat_dict(latencies),
        "ttft_ms": stat_dict(ttfts),
        "prompt_tokens": stat_dict(prompt_tokens),
        "gen_tokens": stat_dict(gen_tokens),
        "gen_tps": stat_dict(gen_tpss),
        "prompt_eval_tps": stat_dict(prompt_eval_tpss)
    }

def run_full_benchmark(
    model_name: str = "qwen2.5:7b",
    iterations_per_condition: int = 35
) -> Dict[str, Any]:
    """
    Executes the comprehensive benchmark for Baseline vs Compressed.
    """
    dataset = load_dataset()
    num_paragraphs = len(dataset)

    print("=" * 70)
    print(f"Starting LLM Latency Benchmark Spike (Task 3)")
    print(f"Model: {model_name} | Iterations per condition: {iterations_per_condition}")
    gpu_info_init = get_gpu_vram_info()
    print(f"Initial GPU VRAM: Used {gpu_info_init['vram_used_mb']:.1f}MB / Free {gpu_info_init['vram_free_mb']:.1f}MB (Total {gpu_info_init['vram_total_mb']:.1f}MB)")
    print("=" * 70)

    # 1. Warm-up Phase (3 iterations)
    print("\\n[Phase 0] Warming up model & GPU (3 runs)...")
    for i in range(3):
        sample = dataset[i % num_paragraphs]
        p = format_compressed_prompt(sample["source"], sample["target"])
        res = query_ollama_streaming(p, model=model_name, force_json=True)
        print(f"  Warm-up #{i+1}: Latency {res['wall_latency_ms']}ms, TTFT {res['ttft_ms']}ms, Gen {res['gen_tokens']} tokens ({res['gen_tps']} tps)")

    gpu_info_warmed = get_gpu_vram_info()
    print(f"Warmed-up GPU VRAM: Used {gpu_info_warmed['vram_used_mb']:.1f}MB / Free {gpu_info_warmed['vram_free_mb']:.1f}MB")

    # 2. Baseline Benchmark (Few-Shot, Verbose)
    print(f"\\n[Phase 1] Running Baseline Benchmark ({iterations_per_condition} runs)...")
    baseline_records: List[Dict[str, Any]] = []
    for i in range(iterations_per_condition):
        sample = dataset[i % num_paragraphs]
        prompt = format_baseline_prompt(sample["source"], sample["target"])
        res = query_ollama_streaming(prompt, model=model_name, force_json=False)
        res["iteration"] = i + 1
        res["paragraph_id"] = sample["id"]
        res["category"] = sample["category"]
        baseline_records.append(res)
        print(f"  [Baseline #{i+1:02d}/{iterations_per_condition}] {sample['id']} -> Latency: {res['wall_latency_ms']}ms | TTFT: {res['ttft_ms']}ms | Prompt: {res['prompt_tokens']}tok | Gen: {res['gen_tokens']}tok ({res['gen_tps']} tps) | JSON: {res['json_valid']}")

    # 3. Compressed Benchmark ("No Samples & JSON Force")
    print(f"\\n[Phase 2] Running Compressed Benchmark ({iterations_per_condition} runs)...")
    compressed_records: List[Dict[str, Any]] = []
    for i in range(iterations_per_condition):
        sample = dataset[i % num_paragraphs]
        prompt = format_compressed_prompt(sample["source"], sample["target"])
        res = query_ollama_streaming(prompt, model=model_name, force_json=True)
        res["iteration"] = i + 1
        res["paragraph_id"] = sample["id"]
        res["category"] = sample["category"]
        compressed_records.append(res)
        print(f"  [Compressed #{i+1:02d}/{iterations_per_condition}] {sample['id']} -> Latency: {res['wall_latency_ms']}ms | TTFT: {res['ttft_ms']}ms | Prompt: {res['prompt_tokens']}tok | Gen: {res['gen_tokens']}tok ({res['gen_tps']} tps) | JSON: {res['json_valid']}")

    gpu_info_final = get_gpu_vram_info()

    baseline_stats = compute_statistics(baseline_records)
    compressed_stats = compute_statistics(compressed_records)

    # Compute improvement percentages
    def calc_delta(b_val: float, c_val: float, lower_is_better: bool = True) -> Dict[str, Any]:
        if b_val == 0:
            return {"delta": 0.0, "pct_improvement": 0.0}
        diff = b_val - c_val if lower_is_better else c_val - b_val
        pct = (diff / b_val) * 100.0
        return {
            "baseline": b_val,
            "compressed": c_val,
            "diff": round(diff, 2),
            "pct_improvement": round(pct, 2)
        }

    comparison = {
        "mean_wall_latency_ms": calc_delta(baseline_stats["wall_latency_ms"]["mean"], compressed_stats["wall_latency_ms"]["mean"], True),
        "p95_wall_latency_ms": calc_delta(baseline_stats["wall_latency_ms"]["p95"], compressed_stats["wall_latency_ms"]["p95"], True),
        "mean_ttft_ms": calc_delta(baseline_stats["ttft_ms"]["mean"], compressed_stats["ttft_ms"]["mean"], True),
        "p95_ttft_ms": calc_delta(baseline_stats["ttft_ms"]["p95"], compressed_stats["ttft_ms"]["p95"], True),
        "mean_prompt_tokens": calc_delta(baseline_stats["prompt_tokens"]["mean"], compressed_stats["prompt_tokens"]["mean"], True),
        "mean_gen_tokens": calc_delta(baseline_stats["gen_tokens"]["mean"], compressed_stats["gen_tokens"]["mean"], True),
        "mean_gen_tps": calc_delta(baseline_stats["gen_tps"]["mean"], compressed_stats["gen_tps"]["mean"], False)
    }

    result = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "hardware": {
            "gpu_name": "NVIDIA GeForce RTX 3050",
            "vram_total_mb": gpu_info_init["vram_total_mb"],
            "vram_used_during_benchmark_mb": gpu_info_warmed["vram_used_mb"],
            "vram_free_headroom_mb": gpu_info_warmed["vram_free_mb"]
        },
        "model": {
            "name": model_name,
            "quantization": "Q4_K_M",
            "parameter_size": "7.6B"
        },
        "iterations_per_condition": iterations_per_condition,
        "baseline_stats": baseline_stats,
        "compressed_stats": compressed_stats,
        "comparison": comparison,
        "baseline_raw_records": baseline_records,
        "compressed_raw_records": compressed_records
    }

    return result
