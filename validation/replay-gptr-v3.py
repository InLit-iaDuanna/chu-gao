"""Replay retained source selection, never a live model or a semantic judgement.

Input is the real TS heuristic export from replay-evidence-v3.mjs. This script
does not invent model_review routes and does not treat snippets as read pages.
"""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "services" / "research-runtime"))
from design_research import DesignMaterialSelector, make_task_spec


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=SOURCE / "validation" / "evidence-v3-candidates.json")
    parser.add_argument("--output", type=Path, default=SOURCE / "validation" / "gptr-v3-retained-source-replay.json")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    brief = payload["brief"]
    spec = make_task_spec({"query": brief["question"], "brief": brief, "links": brief.get("links", [])})
    pages = [
        {"url": row["originalUrl"], "evidenceId": row["id"], "title": row.get("title", ""),
         "raw_content": row["content"], "contentKind": "captured_text", "quality": row["quality"]}
        for row in payload["evidence"]
        if row.get("status") == "captured" and isinstance(row.get("content"), str) and row["content"].strip()
    ]
    with patch.object(socket.socket, "connect", side_effect=AssertionError("Offline source replay forbids network")):
        selected = DesignMaterialSelector(spec).select(pages, purpose="offline.retained_source_selection")
    result = {
        "notice": "Original case text + current TS heuristic routing + real pinned GPTR/LangChain local selector. No model call, no fresh crawl, no semantic verification, no research-quality score.",
        "inputSha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "inputCandidates": len(payload["evidence"]), "retainedFullTextSources": len(pages),
        "taskSpec": spec, "manifest": selected["manifest"], "selectedContext": selected["context"],
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"retainedFullTextSources": len(pages), "selectedSources": len(selected["sources"]),
                      "usedChars": selected["manifest"]["usedChars"], "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
