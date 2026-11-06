import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    with tempfile.TemporaryDirectory(prefix="research-check-") as temporary:
        folder = Path(temporary)
        content = {
            "schemaVersion": 2, "policyVersion": "design-evidence-v2",
            "taskId": "assembly-task", "briefId": "assembly-brief",
            "report": {"text": "Synthetic source", "stageId": "assembly-stage", "attemptId": "assembly-check",
                       "hash": hashlib.sha256(json.dumps("Synthetic source").encode()).hexdigest()},
            "finalBrief": {"goal": "Synthetic assembly check", "confirmedRequirements": ["Synthetic content only"],
                           "scope": "Offline", "alternatives": [], "acceptanceCriteria": [], "openQuestions": []},
            "hypotheses": [], "competitors": [], "caveats": ["Offline assembly check"],
            "quality": {"schemaVersion": 1, "status": "draft", "issues": []},
            "evidence": [], "evidenceManifest": {"schemaVersion": 1, "sources": []},
        }
        version = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        package = {**content, "version": version, "generatedAt": "2000-01-01T00:00:00.000Z"}
        (folder / "input.json").write_text(json.dumps({
            "runId": "assembly-check", "gatewayUrl": "http://research-gateway:8080/api/research/internal",
            "gatewayToken": "disabled-check-only", "model": "gpt-6.1-sol", "query": "Synthetic assembly check",
            "maxCalls": 2, "scope": "exploratory", "research": "Synthetic source", "products": ["pptx", "docx", "html"],
            "finalResearchPackage": package, "evidence": [],
        }))
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("engine.py")), str(folder)], env={**os.environ, "RESEARCH_CHECK_ONLY": "1"}, text=True, capture_output=True, timeout=90)
        if result.returncode:
            print(result.stderr[-12000:])
            raise SystemExit(result.returncode)
        print(result.stdout[-2000:])
        if os.environ.get("RESEARCH_ENGINE") == "deerflow":
            from pptx import Presentation
            from docx import Document
            presentation = Presentation()
            slide = presentation.slides.add_slide(presentation.slide_layouts[5])
            slide.shapes.title.text = "Synthetic editable proposal"
            presentation.save(folder / "probe.pptx")
            assert len(Presentation(folder / "probe.pptx").slides) == 1
            document = Document()
            document.add_heading("Synthetic brief", 0)
            document.save(folder / "probe.docx")
            assert Document(folder / "probe.docx").paragraphs[0].text == "Synthetic brief"
            from proposal_export import ProposalDocument, export_proposal
            os.environ["CHUGAO_PROPOSAL_INPUT"] = str(folder / "input.json")
            os.environ["CHUGAO_PROPOSAL_OUTPUTS"] = str(folder / "native-outputs")
            exported = export_proposal(ProposalDocument.model_validate({
                "contract_version": 2, "package_version": version, "status": "draft",
                "title": "Synthetic editable export", "slides": [{"title": "Offline scope", "layout": "overview", "claims": [
                    {"text": "Synthetic content only", "status": "user_requirement"}
                ]}], "caveats": ["Offline assembly check"],
            }))
            root = folder / "native-outputs"
            manifest = json.loads((root / exported["manifest"]).read_text())
            assert manifest["schema_version"] == 2 and manifest["status"] == "draft"
            assert manifest["package_version"] == version
            assert {entry["format"] for entry in manifest["files"]} == {"pptx", "docx", "html"}
            assert set(exported["files"]) == {entry["path"] for entry in manifest["files"]}
            paths = {}
            for entry in manifest["files"]:
                path = root / entry["path"]
                assert not path.is_symlink() and path.resolve().parent.parent == root.resolve()
                data = path.read_bytes()
                assert hashlib.sha256(data).hexdigest() == entry["sha256"] and len(data) == entry["bytes"]
                paths[entry["format"]] = path
            assert Presentation(paths["pptx"]).slides[0].shapes
            assert Document(paths["docx"]).paragraphs
            from runtime_contracts import load_proposal_bundle
            selected, _ = load_proposal_bundle(root, version)
            assert selected == manifest
            print(json.dumps({"office_libraries": "read-write-passed", "proposal_contract": 2, "llm_calls": 0}))


if __name__ == "__main__":
    main()
