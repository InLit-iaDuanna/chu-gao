"""Python half of cross-language-proposal.mjs. Uses actual tool and sidecar readers."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

# Read-only reuse of preinstalled dependency folders, never install during replay.
for extra in os.environ.get("CHUGAO_REPLAY_EXTRA_PYTHONPATH", "").split(os.pathsep):
    if extra:
        sys.path.append(extra)
runtime = Path(__file__).resolve().parents[1] / "services/research-runtime"
sys.path.insert(0, str(runtime))
folder = Path(sys.argv[1]).resolve()
source = json.loads((folder / "input.json").read_text())
proposal = json.loads((folder / "proposal.json").read_text())
checks = []


def no_network(*args, **kwargs):
    raise AssertionError("External network is disabled in this offline replay")


socket.create_connection = no_network
original_connect = socket.socket.connect


def no_inet_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        return no_network()
    return original_connect(self, address)


socket.socket.connect = no_inet_connect
os.environ.update({
    "CHUGAO_PROPOSAL_INPUT": str(folder / "input.json"),
    "CHUGAO_PROPOSAL_OUTPUTS": str(folder / "exports"),
    "RESEARCH_RUN_ROOT": str(folder / "sidecar-runs"),
    "RESEARCH_ENGINE": "deerflow",
    "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
})
from chugao_tools import chugao_create_proposal
from proposal_export import EXPORTER_VERSION
from runtime_contracts import load_proposal_bundle
from pptx import Presentation
from docx import Document

exported = chugao_create_proposal.invoke({"proposal": proposal})
checks.append("actual LangChain chugao_create_proposal.invoke accepted TS package")
manifest, selected = load_proposal_bundle(folder / "exports", source["finalResearchPackage"]["version"])
assert manifest["package_version"] == source["finalResearchPackage"]["version"]
assert manifest["status"] == "draft"
assert set(manifest["evidence_ids"]) == {"fixture-01", "fixture-user-text"}
assert {entry["format"] for entry in manifest["files"]} == {"pptx", "docx", "html"}
checks.append("actual Python sidecar bundle reader validated package, paths and file hashes")
try:
    load_proposal_bundle(folder / "exports", "different-package-version")
except ValueError:
    checks.append("actual Python sidecar reader rejects different final package")
else:
    raise AssertionError("Different package version unexpectedly accepted")


class ParsedHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.hrefs = []
        self.tables = 0
        self.scripts = 0

    def handle_data(self, value):
        self.text.append(value)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tables += tag == "table"
        self.scripts += tag == "script"
        if "href" in attrs:
            self.hrefs.append(attrs["href"])


def office_text_and_links(file):
    parts, links = [], []
    with zipfile.ZipFile(file) as archive:
        for name in archive.namelist():
            if name.endswith(".xml"):
                parts.extend(ET.fromstring(archive.read(name)).itertext())
            if name.endswith(".rels"):
                tree = ET.fromstring(archive.read(name))
                links.extend(item.get("Target", "") for item in tree if item.get("Type", "").endswith("/hyperlink"))
    return "\n".join(parts), links


structures = {}
for file in selected:
    if file.suffix == ".pptx":
        deck = Presentation(file)
        structures["pptx"] = {"slides": len(deck.slides), "nativeTables": sum(shape.has_table for slide in deck.slides for shape in slide.shapes)}
        assert structures["pptx"]["nativeTables"] == 2
        text, links = office_text_and_links(file)
    elif file.suffix == ".docx":
        document = Document(file)
        structures["docx"] = {"nativeTables": len(document.tables), "paragraphs": len(document.paragraphs)}
        assert structures["docx"]["nativeTables"] == 2
        text, links = office_text_and_links(file)
    else:
        parser = ParsedHTML()
        parser.feed(file.read_text())
        text, links = "\n".join(parser.text), parser.hrefs
        structures["html"] = {"nativeTables": parser.tables, "scriptElements": parser.scripts}
        assert parser.tables == 2 and parser.scripts == 0
    assert "离线跨语言合同验收" in text
    assert "用户材料记载" in text
    assert "抓取时间：2000-01-01T00:00:00.000Z" in text
    assert "来源时间未提供" in text
    assert "2000-01-02T00:00:00.000Z" not in text  # generatedAt is not a source time.
    assert not any(link.startswith("attachment:") for link in links)
    assert "https://example.com/fixture/office-lunch" in links
    for item in source["finalResearchPackage"]["finalBrief"]["confirmedRequirements"]:
        assert item in text
    for item in source["finalResearchPackage"]["caveats"]:
        assert item in text
    assert source["finalResearchPackage"]["hypotheses"][0]["text"] in text
    checks.append(f"actual {file.suffix[1:]} structure, labels, requirements, hypothesis, caveats and links roundtrip")

# Use the production sidecar's real file listing. Only the final engine result
# envelope is assembled here from the validated manifest; no graph/model is run.
spec = importlib.util.spec_from_file_location("cross_language_sidecar_app", runtime / "app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
run_dir = app.run_dir(source["runId"])
public_outputs = run_dir / "outputs"
public_outputs.mkdir(parents=True, exist_ok=True)
for file in selected:
    shutil.copy2(file, public_outputs / file.name)
result = {
    "files": [file.name for file in selected],
    "text": "离线合同夹具已导出；不是新完成的市场调研。",
    "packageVersion": source["finalResearchPackage"]["version"],
    "evidenceIds": manifest["evidence_ids"],
    "artifactManifest": [{**entry, "name": Path(entry["path"]).name} for entry in manifest["files"]],
}
app.write_state(run_dir, {"runId": source["runId"], "status": "completed", "seq": 1, "result": result})
(run_dir / "events.jsonl").write_text(json.dumps({"seq": 1, "type": "result", "data": result}, ensure_ascii=False) + "\n")
remote = asyncio.run(app.get_run(source["runId"], after=0))
assert set(file["name"] for file in remote["files"]) == set(result["files"])
checks.append("actual sidecar app.get_run lists all generated artifact bytes")
(folder / "remote-response.json").write_text(json.dumps(remote, ensure_ascii=False, indent=2) + "\n")
(folder / "python-result.json").write_text(json.dumps({
    "entryPoint": "chugao_tools.chugao_create_proposal.invoke",
    "exporterVersion": EXPORTER_VERSION, "exportHash": manifest["export_hash"],
    "checks": checks, "structures": structures, "exported": exported,
}, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": "passed", "checksPassed": len(checks), "exportHash": manifest["export_hash"]}))
