"""Render an exported office-lunch replay with local LibreOffice and task fonts.

Run the exporter first. This read-only renderer never changes the immutable
Office/HTML bundles. DOCX uses the document skill renderer when installed or
explicitly supplied; other environments can use local LibreOffice directly.
No model, network request or system font install is performed here. Visual
inspection of every page remains a separate requirement.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import fitz


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--docx-renderer", type=Path)
    args = parser.parse_args()
    source, target = args.case_root.resolve(), args.output.resolve()
    docx_renderer = args.docx_renderer or Path("/root/.codex/skills/builtins/documents/render_docx.py")
    if args.docx_renderer and not docx_renderer.is_file():
        parser.error("The supplied --docx-renderer does not exist")
    if not docx_renderer.is_file():
        docx_renderer = None
    target.mkdir(parents=True, exist_ok=True)
    cases = json.loads((source / "replay-results.json").read_text())
    jobs = []
    for case in cases:
        root = source / case["case"]
        manifest = json.loads((source / case["manifest"]).read_text())
        for entry in manifest["files"]:
            if entry["format"] not in ("pptx", "docx"):
                continue
            file = (root / entry["path"]).resolve()
            if root not in file.parents or hashlib.sha256(file.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError("The selected artifact path or checksum is invalid")
            jobs.append((case["case"], entry["format"], file, entry["sha256"]))

    def render(job):
        case, format, file, sha = job
        out = target / case / format
        out.mkdir(parents=True, exist_ok=True)
        for old_png in out.glob("page-*.png"):
            old_png.unlink()
        if format == "docx" and docx_renderer:
            command = [sys.executable, str(docx_renderer), str(file), "--output_dir", str(out), "--emit_pdf", "--width", "1600", "--height", "2400"]
            result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        else:
            with tempfile.TemporaryDirectory(prefix="chugao-office-profile-") as profile:
                pdf_filter = "impress_pdf_Export" if format == "pptx" else "writer_pdf_Export"
                command = [shutil.which("soffice") or "soffice", "-env:UserInstallation=" + Path(profile).as_uri(), "--headless", "--convert-to", "pdf:" + pdf_filter, "--outdir", str(out), str(file)]
                result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        (out / "render.log").write_text("Command: " + json.dumps(command, ensure_ascii=False) + "\n" + result.stdout + result.stderr + f"\nExit code: {result.returncode}\n")
        if result.returncode:
            raise RuntimeError(f"Render failed for {case}/{format}; see {out / 'render.log'}")
        pdf = out / (file.stem + ".pdf")
        if not pdf.is_file():
            raise RuntimeError(f"Render produced no PDF for {case}/{format}")
        with fitz.open(pdf) as document:
            pages = len(document)
            if format == "pptx" or not docx_renderer:
                for index, page in enumerate(document, 1):
                    page.get_pixmap(matrix=fitz.Matrix(1600 / page.rect.width, 1600 / page.rect.width), alpha=False).save(out / f"page-{index:02d}.png")
        return {"case": case, "format": format, "sourceSha256": sha, "pages": pages,
                "renderer": "document-skill render_docx.py" if format == "docx" and docx_renderer else "LibreOffice",
                "pdf": str(pdf.relative_to(target)), "rendererExit": result.returncode,
                "visualInspection": "required separately"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(render, jobs))
    report = {"scope": "Local Office rendering only; no new model or market research", "fontconfigFile": os.environ.get("FONTCONFIG_FILE"), "results": results}
    (target / "render-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for result in results:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
