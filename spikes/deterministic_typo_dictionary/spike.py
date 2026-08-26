#!/usr/bin/env python3
"""Isolated precision spike; deliberately has no production imports."""
from __future__ import annotations
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "dictionary.json").read_text(encoding="utf-8"))
CORPUS = json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))

PROTECTED = re.compile(r"https?://\S+|`[^`]*`|\{\{[^}]*\}\}|<[^>]+>")
DELIMITED = re.compile(r"[,/·]|\([^)]*\)")

def protected_spans(text):
    return [(m.start(), m.end()) for m in PROTECTED.finditer(text)]

def overlaps(span, spans):
    return any(span[0] < end and start < span[1] for start, end in spans)

def word_pattern(token):
    return re.compile(rf"(?<![가-힣A-Za-z0-9]){re.escape(token)}(?![가-힣A-Za-z0-9])")

def list_block(text):
    # Tier 2 is limited to a delimiter-separated single line, not prose.
    return bool(DELIMITED.search(text)) and "\n" not in text

def ordered_anchor_count(text, anchors, typo_start):
    positions = []
    for index, anchor in enumerate(anchors):
        for match in word_pattern(anchor).finditer(text):
            positions.append((match.start(), index))
    positions.sort()
    before = [index for start, index in positions if start < typo_start]
    after = [index for start, index in positions if start > typo_start]
    # Compatible order means the context does not reverse the declared sequence.
    compatible = (not before or not after or max(before) <= min(after))
    return len({index for _, index in positions}), compatible

def detect_dictionary(text):
    hits = []
    protected = protected_spans(text)
    for category in DATA["categories"]:
        for typo, correction in category["typos"].items():
            for match in word_pattern(typo).finditer(text):
                span = match.span()
                if overlaps(span, protected):
                    continue
                if category["tier"] == 2:
                    count, compatible = ordered_anchor_count(text, category["anchors"], span[0])
                    if not (list_block(text) and count >= 2 and compatible):
                        continue
                hits.append({"category": category["id"], "tier": category["tier"], "token": typo,
                             "correction": correction, "span": list(span), "confidence": "high"})
    return hits

MARKER = re.compile(
    r"^(?:(?P<circled>①|②|③|④|⑤|⑥)|(?P<dotted>가|나|다|라|마|바|I|II|III|IV|V|VI)[.)])\s",
    re.M,
)
def detect_markers(text):
    markers = list(MARKER.finditer(text))
    if len(markers) < 2:
        return []
    families = DATA["list_markers"]["families"]
    hits = []
    previous = None
    family_name = None
    for match in markers:
        marker = match.group("circled") or match.group("dotted")
        current_family = next((name for name, values in families.items() if marker in values), None)
        if current_family is None:
            continue
        index = families[current_family].index(marker)
        if previous is not None and current_family == family_name and index != previous + 1:
            # Duplicate and skipped markers are evidence only; never correction candidates.
            start = match.start("circled") if match.group("circled") else match.start("dotted")
            end = match.end("circled") if match.group("circled") else match.end("dotted")
            hits.append({"category": "list_markers", "tier": 3, "token": marker,
                         "correction": None, "span": [start, end],
                         "confidence": "low", "reason": "non-monotonic marker progression; no auto-correction"})
        previous, family_name = index, current_family
    return hits

def detect(text):
    return detect_dictionary(text) + detect_markers(text)

def main():
    records = []
    for group in ("true_positive", "false_positive_traps", "clean_paragraphs"):
        for case in CORPUS[group]:
            records.append({"group": group, **case, "hits": detect(case["text"])})
    stats = defaultdict(lambda: {"expected": 0, "found": 0, "flags": 0, "tp_flags": 0, "fp": []})
    all_fp = []
    for record in records:
        category = record.get("category")
        if record["group"] == "true_positive":
            stats[category]["expected"] += len(record["expected"])
            found = {hit["token"] for hit in record["hits"] if hit["category"] == category}
            stats[category]["found"] += len(found & set(record["expected"]))
            stats[category]["tp_flags"] += len(found & set(record["expected"]))
            stats[category]["flags"] += len(record["hits"])
        else:
            for hit in record["hits"]:
                stats[hit["category"]]["flags"] += 1
                stats[hit["category"]]["fp"].append({"case": record["id"], "token": hit["token"], "reason": hit.get("reason", "matched despite a negative case")})
                all_fp.append({"case": record["id"], "category": hit["category"], "token": hit["token"], "reason": hit.get("reason", "matched despite a negative case")})
    output = {"records": records, "metrics": {}, "false_positives": all_fp}
    for category, value in sorted(stats.items()):
        precision = value["tp_flags"] / value["flags"] if value["flags"] else None
        output["metrics"][category] = {"expected_true_positives": value["expected"], "detected_true_positives": value["found"], "recall": value["found"] / value["expected"], "flags": value["flags"], "precision": precision, "false_positives": value["fp"]}
    expected = sum(v["expected"] for v in stats.values())
    found = sum(v["found"] for v in stats.values())
    flags = sum(v["flags"] for v in stats.values())
    output["overall"] = {"expected_true_positives": expected, "detected_true_positives": found, "recall": found / expected, "flags": flags, "precision": sum(v["tp_flags"] for v in stats.values()) / flags if flags else None, "false_positive_count": len(all_fp)}
    (ROOT / "results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(output["metrics"], ensure_ascii=False, indent=2))
    print(json.dumps(output["overall"], ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
