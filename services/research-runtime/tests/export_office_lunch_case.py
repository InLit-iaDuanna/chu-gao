"""Export unchanged review inputs and a labelled reviewer-authored example.

No model, HTTP request or new market research is performed. Output directories
must be new when reviewing in-progress renderer changes: immutable bundles from
the same exporter version are deliberately reused on repeated calls.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from proposal_export import EXPORTER_VERSION, ProposalDocument, export_proposal
from pptx import Presentation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    target = args.output.resolve()
    target.mkdir(parents=True, exist_ok=True)
    fixtures = Path(__file__).parent / "fixtures"
    package = json.loads((fixtures / "office_lunch_actual_package.json").read_text())
    source = {"products": ["pptx", "docx", "html"], "evidence": package["evidence"], "finalResearchPackage": package}
    input_path = target / "exporter-input.json"
    input_path.write_text(json.dumps(source, ensure_ascii=False, indent=2))
    calls = json.loads((fixtures / "office_lunch_actual_tool_inputs.json").read_text())
    runs = [(f"original-input-{index}", row["arguments"]["proposal"], "unchanged supplied model tool input") for index, row in enumerate(calls, 1)]
    curated = json.loads((fixtures / "office_lunch_curated_proposal.json").read_text())
    runs.append(("reviewer-curated", curated, "reviewer-authored example using the same frozen evidence; not a new model run or completed market study"))
    results = []
    os.environ["CHUGAO_PROPOSAL_INPUT"] = str(input_path)
    for label, proposal, scope in runs:
        work = target / label
        os.environ["CHUGAO_PROPOSAL_OUTPUTS"] = str(work)
        before = json.dumps(proposal, ensure_ascii=False, sort_keys=True)
        result = export_proposal(ProposalDocument.model_validate(proposal))
        if json.dumps(proposal, ensure_ascii=False, sort_keys=True) != before:
            raise RuntimeError("Export mutated the original semantic proposal")
        manifest = json.loads((work / result["manifest"]).read_text())
        pptx = work / next(row["path"] for row in manifest["files"] if row["format"] == "pptx")
        record = {"case": label, "scope": scope, "exporterVersion": EXPORTER_VERSION,
                  "inputSha256": hashlib.sha256(before.encode()).hexdigest(),
                  "packageVersion": package["version"], "exportHash": result["export_hash"],
                  "slides": len(Presentation(pptx).slides), "manifest": str((work / result["manifest"]).relative_to(target)),
                  "semanticInputUnchanged": True}
        results.append(record)
        print(json.dumps(record, ensure_ascii=False))
    (target / "replay-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
