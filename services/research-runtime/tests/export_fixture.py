"""Generate the explicitly labelled offline fixture; no HTTP/model calls."""
import argparse
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from proposal_export import ProposalDocument, export_proposal

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
fixtures = Path(__file__).parent / "fixtures"
os.environ["CHUGAO_PROPOSAL_INPUT"] = str(fixtures / "proposal_v2_input.json")
os.environ["CHUGAO_PROPOSAL_OUTPUTS"] = str(args.output.resolve())
proposal = ProposalDocument.model_validate_json((fixtures / "proposal_v2.json").read_text())
print(json.dumps(export_proposal(proposal), ensure_ascii=False, indent=2))
