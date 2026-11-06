"""Local structural/regression checks. All evidence and upstream calls are offline."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import proposal_export as exporter
from proposal_export import ProposalDocument, export_proposal
from lxml import html as lhtml
from docx import Document
from pptx import Presentation

FIXTURES = Path(__file__).parent / "fixtures"


class ProposalExportTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.root = Path(self.work.name)
        self.source = json.loads((FIXTURES / "proposal_v2_input.json").read_text())
        self.proposal = json.loads((FIXTURES / "proposal_v2.json").read_text())
        self.input = self.root / "input.json"
        self.out = self.root / "outputs"
        self.env = patch.dict(os.environ, {"CHUGAO_PROPOSAL_INPUT": str(self.input), "CHUGAO_PROPOSAL_OUTPUTS": str(self.out)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.work.cleanup()

    def run_export(self, proposal=None):
        self.input.write_text(json.dumps(self.source, ensure_ascii=False))
        return export_proposal(ProposalDocument.model_validate(proposal or self.proposal))

    def manifest(self):
        return json.loads((self.out / "proposal-manifest.json").read_text())

    def path(self, fmt):
        return self.out / next(entry["path"] for entry in self.manifest()["files"] if entry["format"] == fmt)

    def assert_unpublished(self):
        self.assertFalse((self.out / "proposal-manifest.json").exists())
        self.assertFalse(list(self.out.glob("proposal-*")))

    def assert_footer_references(self, slide, expected):
        refs = [shape for shape in slide.shapes if shape.name.startswith("chugao-footer-reference:")]
        ids = [shape.name.split(":", 1)[1] for shape in refs]
        self.assertCountEqual(ids, expected)
        version = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text.startswith("版本 "))
        for shape in refs:
            self.assertLessEqual(shape.left + shape.width, version.left)
            self.assertLessEqual(shape.top + shape.height, int(7.3 * 914400))
            self.assertTrue(all(run.font.size.pt == 9 for paragraph in shape.text_frame.paragraphs for run in paragraph.runs))
        for index, left in enumerate(refs):
            for right in refs[index + 1:]:
                overlap = (left.left < right.left + right.width and right.left < left.left + left.width
                           and left.top < right.top + right.height and right.top < left.top + left.height)
                self.assertFalse(overlap, "Footer reference boxes overlap")
        note = json.loads(slide.notes_slide.notes_text_frame.text.split("\n", 1)[1])
        self.assertCountEqual(note["pageEvidenceIds"], expected)
        return refs

    def test_16_24_and_32_citations_fit_without_smaller_fonts_or_missing_sources(self):
        for count in (16, 24, 32):
            with self.subTest(citations=count):
                ids = [f"footer-{index:02d}" for index in range(count)]
                self.source["evidence"] = [{"id": identifier, "url": "https://example.com/" + identifier,
                                            "title": "Source " + identifier} for identifier in ids]
                claim_ids = ids[:30]
                self.proposal = {
                    "contract_version": 2, "package_version": self.source["finalResearchPackage"]["version"],
                    "title": "Footer capacity", "slides": [{"title": "Complete citations", "layout": "evidence",
                        "evidence_ids": ids[30:],
                        "claims": [{"text": "Citation group " + str(index), "status": "unknown", "evidence_ids": claim_ids[index:index + 6]}
                                   for index in range(0, len(claim_ids), 6)]}],
                }
                self.run_export()
                deck = Presentation(self.path("pptx"))
                refs = self.assert_footer_references(deck.slides[0], ids)
                self.assertEqual(len({shape.top for shape in refs}), 1 if count == 16 else 2)
                self.assertCountEqual(self.manifest()["evidence_ids"], ids)
                appendix = [shape.name for slide in deck.slides for shape in slide.shapes
                            if shape.name.startswith("chugao-appendix-body:来源 ")]
                self.assertCountEqual(appendix, [f"chugao-appendix-body:来源 [{index}]" for index in range(1, count + 1)])
                with ZipFile(self.path("pptx")) as archive:
                    relationships = "\n".join(archive.read(name).decode() for name in archive.namelist() if name.endswith(".rels"))
                for identifier in ids:
                    self.assertIn("https://example.com/" + identifier, relationships)

    def test_paginated_claims_rows_and_steps_only_cite_items_rendered_on_that_page(self):
        for layout in ("overview", "comparison", "process"):
            with self.subTest(layout=layout):
                section = {"title": "Pagination " + layout, "layout": layout, "evidence_ids": ["section-source"]}
                entries = []
                for index in range(5):
                    entry = {"status": "unknown", "evidence_ids": [f"item-{index}"]}
                    if layout == "overview":
                        entry["text"] = f"CLAIM-{index}：" + "必须保留完整的条件与引用" * 8
                    elif layout == "comparison":
                        entry["cells"] = [f"ROW-{index}-{column}：" + "待验证的使用条件" * 5 for column in range(5)]
                    else:
                        entry.update(title=f"STEP-{index}", detail=f"DETAIL-{index}：" + "必须保留完整条件" * 7)
                    entries.append(entry)
                if layout == "overview":
                    section["claims"] = entries
                else:
                    section["claims"] = [{"text": "LEAD：" + "先核对完整的使用条件" * 10,
                                          "status": "unknown", "evidence_ids": ["lead-source"]}]
                    if layout == "comparison":
                        section["table"] = {"columns": ["方案", "适用条件", "成本边界", "验证证据", "改变决定的条件"], "rows": entries}
                    else:
                        section["steps"] = entries
                ids = ["section-source", "lead-source", *(f"item-{index}" for index in range(5))]
                self.source["evidence"] = [{"id": identifier, "url": "https://example.com/" + identifier,
                                            "title": identifier} for identifier in ids]
                self.proposal = {"contract_version": 2, "package_version": self.source["finalResearchPackage"]["version"],
                                 "title": "Physical page references", "slides": [section]}
                self.run_export()
                deck = Presentation(self.path("pptx"))
                pages = [slide for slide in deck.slides if slide.has_notes_slide
                         and slide.notes_slide.notes_text_frame.text.startswith("CHUGAO_CONTENT_V2\n")]
                self.assertGreater(len(pages), 1)
                seen = []
                for index, slide in enumerate(pages):
                    texts = [shape.text for shape in slide.shapes if shape.has_text_frame]
                    rows = [[cell.text for cell in row.cells][:-1] for shape in slide.shapes if shape.has_table
                            for row in list(shape.table.rows)[1:]]
                    expected = ["section-source"] if index == 0 else []
                    for entry in section.get("claims", []):
                        if entry["text"] in texts:
                            expected.extend(entry["evidence_ids"])
                            seen.extend(entry["evidence_ids"])
                    if layout == "comparison":
                        visible = [entry for entry in entries if entry["cells"] in rows]
                    elif layout == "process":
                        visible = [entry for entry in entries if entry["detail"] in texts and entry["title"] in texts]
                    else:
                        visible = []
                    for entry in visible:
                        expected.extend(entry["evidence_ids"])
                        seen.extend(entry["evidence_ids"])
                    self.assert_footer_references(slide, expected)
                self.assertCountEqual(seen, [*(f"item-{index}" for index in range(5)), *([] if layout == "overview" else ["lead-source"])])
                if layout == "comparison":
                    self.assertFalse(any(shape.has_table for shape in pages[0].shapes), "A long lead must not acquire references from later table rows")

    def test_fontconfig_collection_uses_selected_sc_face(self):
        # Debian packages Noto CJK as a TTC; SC need not be its first font face.
        exporter._measurement_font.cache_clear()
        try:
            with patch.object(exporter.subprocess, "run") as match, patch("PIL.ImageFont.truetype") as load:
                match.return_value.returncode = 0
                match.return_value.stdout = "/offline/NotoSansCJK-Regular.ttc\n2"
                load.return_value.getname.return_value = (exporter.FONT, "Regular")
                self.assertIs(exporter._measurement_font(""), load.return_value)
                load.assert_called_once_with("/offline/NotoSansCJK-Regular.ttc", 1000, index=2)
        finally:
            exporter._measurement_font.cache_clear()

    def test_native_formats_have_same_sources_caveats_and_version(self):
        result = self.run_export()
        self.assertEqual(result["status"], "draft")
        manifest = self.manifest()
        self.assertEqual(len(manifest["files"]), 3)
        for entry in manifest["files"]:
            data = (self.out / entry["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
            self.assertEqual(len(data), entry["bytes"])
        deck = Presentation(self.path("pptx"))
        self.assertGreater(len(deck.slides), len(self.proposal["slides"]))
        self.assertEqual(sum(shape.has_table for slide in deck.slides for shape in slide.shapes), 2)
        self.assertGreater(sum(shape.shape_type == 1 for slide in deck.slides for shape in slide.shapes), 0)
        slide_text = "\n".join(shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame)
        doc = Document(self.path("docx"))
        self.assertEqual(len(doc.tables), 2)
        doc_text = "\n".join(paragraph.text for paragraph in doc.paragraphs)
        page = lhtml.fromstring(self.path("html").read_text())
        self.assertEqual(len(page.xpath("//table")), 2)
        self.assertTrue(page.xpath('//*[@id="evidence-1"]'))
        for caveat in self.proposal["caveats"] + self.source["finalResearchPackage"]["caveats"]:
            self.assertIn(caveat, slide_text)
            self.assertIn(caveat, doc_text)
            self.assertIn(caveat, page.text_content())
        self.assertIn(self.proposal["package_version"][:12], slide_text)
        self.assertIn(self.proposal["package_version"], doc_text)
        self.assertIn(self.proposal["package_version"], page.text_content())
        for suffix in ("pptx", "docx"):
            with ZipFile(self.path(suffix)) as archive:
                relationships = "\n".join(archive.read(name).decode() for name in archive.namelist() if name.endswith(".rels"))
                self.assertIn("https://example.com/fixture/office-lunch", relationships)
        self.assertTrue(page.xpath('//a[@href="https://example.com/fixture/office-lunch"]'))

    def test_observed_without_citation_is_rejected(self):
        self.proposal["slides"][-1]["claims"][0]["evidence_ids"] = []
        with self.assertRaisesRegex(ValueError, "structured evidence_ids"):
            self.run_export()
        self.assert_unpublished()

    def test_unknown_evidence_id_is_rejected(self):
        self.proposal["slides"][-1]["claims"][0]["evidence_ids"] = ["fabricated-id"]
        with self.assertRaisesRegex(ValueError, "Unknown evidence"):
            self.run_export()
        self.assert_unpublished()

    def test_link_only_does_not_support_observation(self):
        self.source["evidence"][0]["status"] = "link_only"
        with self.assertRaisesRegex(ValueError, "captured evidence"):
            self.run_export()
        self.assert_unpublished()

    def test_rejected_source_does_not_support_observation(self):
        self.source["evidence"][0]["selected"] = False
        with self.assertRaisesRegex(ValueError, "Rejected evidence"):
            self.run_export()
        self.assert_unpublished()

    def test_hypothesis_needs_basis(self):
        self.proposal["slides"][0]["claims"][2].pop("assumption_basis")
        with self.assertRaisesRegex(ValueError, "assumption_basis"):
            self.run_export()
        self.assert_unpublished()

    def test_table_uses_shared_basis_reference_without_dropping_original_basis(self):
        table = self.proposal["slides"][1]["table"]
        self.proposal["slides"][1]["claims"] = [{"text": "先核对使用条件", "status": "recommendation"}]
        table["rows"] = table["rows"][:2]
        basis = "基于办公室使用场景提出候选路线，尚未完成用户实测和设备条件核对，需要保留清洁与共享设施的使用限制。"
        for row in table["rows"]:
            row["assumption_basis"] = basis
        self.run_export()
        deck = Presentation(self.path("pptx"))
        native = next(shape.table for shape in deck.slides[1].shapes if shape.has_table)
        status = native.cell(1, len(table["columns"])).text
        self.assertIn("依据 B", status)
        texts = [shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame]
        self.assertEqual(texts.count(basis), 1)
        note = json.loads(deck.slides[1].notes_slide.notes_text_frame.text.split("\n", 1)[1])
        self.assertEqual(note["slide"]["table"]["rows"][0]["assumption_basis"], basis)
        self.assertIn(basis, self.path("html").read_text())

    def test_inferred_scope_cannot_be_user_requirement(self):
        self.proposal["slides"][0]["claims"][0]["text"] = "单人午餐与三档蒸煮"
        with self.assertRaisesRegex(ValueError, "confirmed user requirement"):
            self.run_export()
        self.assert_unpublished()

    def test_verified_cannot_be_self_promoted(self):
        self.proposal["slides"][-1]["claims"][0]["status"] = "verified"
        with self.assertRaisesRegex(ValueError, "verifiedClaims"):
            self.run_export()
        self.assert_unpublished()

    def test_verified_entry_requires_the_same_claim_and_ids(self):
        claim = self.proposal["slides"][-1]["claims"][0]
        claim["status"] = "verified"
        self.source["finalResearchPackage"]["verifiedClaims"] = [{"text": claim["text"], "evidenceIds": ["fixture-01"]}]
        result = self.run_export()
        self.assertEqual(result["status"], "draft")

    def test_insufficient_research_cannot_be_review_ready(self):
        self.proposal["status"] = "review_ready"
        with self.assertRaisesRegex(ValueError, "quality.status=supported"):
            self.run_export()
        self.assert_unpublished()

    def test_supported_with_structured_evidence_can_be_review_ready(self):
        self.proposal["status"] = "review_ready"
        self.source["finalResearchPackage"]["quality"]["status"] = "supported"
        result = self.run_export()
        self.assertEqual(result["status"], "review_ready")
        self.assertIn("待评审提案", self.path("html").read_text())

    def test_stale_research_version_is_rejected(self):
        self.proposal["package_version"] = "old-version"
        with self.assertRaisesRegex(ValueError, "package_version"):
            self.run_export()
        self.assert_unpublished()

    def test_legacy_case_is_forced_draft_and_caveats_survive(self):
        old = json.loads((FIXTURES / "legacy_case_proposal.json").read_text())
        old["status"] = "review_ready"
        self.source["evidence"] = []
        result = self.run_export(old)
        self.assertEqual(result["status"], "draft")
        deck = Presentation(self.path("pptx"))
        text = "\n".join(shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame)
        self.assertIn("研究草稿", text)
        self.assertGreater(len(deck.slides), len(old["slides"]))
        for caveat in old["caveats"]:
            self.assertIn(caveat, text)

    def test_renderer_error_does_not_publish_a_partial_bundle(self):
        with patch.object(exporter, "_html", side_effect=RuntimeError("injected HTML failure")):
            with self.assertRaisesRegex(RuntimeError, "injected HTML failure"):
                self.run_export()
        self.assert_unpublished()
        self.assertFalse(list(self.out.glob(".proposal-stage-*")))

    def test_renderer_error_keeps_previous_bundle_selected(self):
        self.run_export()
        pointer = (self.out / "proposal-manifest.json").read_bytes()
        hashes = {row["path"]: (self.out / row["path"]).read_bytes() for row in self.manifest()["files"]}
        self.proposal["subtitle"] += " 新版本。"
        with patch.object(exporter, "_html", side_effect=RuntimeError("injected HTML failure")):
            with self.assertRaises(RuntimeError):
                self.run_export()
        self.assertEqual(pointer, (self.out / "proposal-manifest.json").read_bytes())
        for relative, data in hashes.items():
            self.assertEqual(data, (self.out / relative).read_bytes())

    def test_idempotent_export_reuses_immutable_bundle(self):
        first = self.run_export()
        pointer = (self.out / "proposal-manifest.json").read_bytes()
        second = self.run_export()
        self.assertEqual(first, second)
        self.assertEqual(pointer, (self.out / "proposal-manifest.json").read_bytes())
        self.assertEqual(len([path for path in self.out.glob("proposal-*") if path.is_dir()]), 1)

    def test_exporter_version_change_never_reuses_previous_layout_bytes(self):
        render = exporter._html
        marker = "<!-- previous-layout-fixture -->"

        def previous_layout(proposal, context, path):
            render(proposal, context, path)
            path.write_text(path.read_text(encoding="utf-8") + marker, encoding="utf-8")

        with patch.object(exporter, "EXPORTER_VERSION", "2.1.0"), patch.object(exporter, "_html", side_effect=previous_layout):
            previous = self.run_export()
        old_manifest = self.manifest()
        old_bytes = {entry["path"]: (self.out / entry["path"]).read_bytes() for entry in old_manifest["files"]}
        self.assertIn(marker, self.path("html").read_text(encoding="utf-8"))

        current = self.run_export()
        manifest = self.manifest()
        self.assertNotEqual(exporter.EXPORTER_VERSION, "2.1.0")
        self.assertEqual(old_manifest["exporter_version"], "2.1.0")
        self.assertEqual(manifest["exporter_version"], exporter.EXPORTER_VERSION)
        self.assertEqual(current["package_version"], previous["package_version"])
        self.assertNotEqual(current["export_hash"], previous["export_hash"])
        self.assertNotEqual(manifest["bundle"], old_manifest["bundle"])
        self.assertNotIn(marker, self.path("html").read_text(encoding="utf-8"))
        self.assertEqual(len([path for path in self.out.glob("proposal-*") if path.is_dir()]), 2)
        pointer = (self.out / "proposal-manifest.json").read_bytes()
        self.assertEqual(self.run_export(), current)
        self.assertEqual((self.out / "proposal-manifest.json").read_bytes(), pointer)
        for relative, data in old_bytes.items():
            self.assertEqual((self.out / relative).read_bytes(), data)
        self.assertEqual(json.loads((self.out / old_manifest["bundle"] / "bundle-manifest.json").read_text()), old_manifest)

    def test_concurrent_same_export_selects_one_complete_bundle(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        self.source["products"] = ["html"]
        self.input.write_text(json.dumps(self.source, ensure_ascii=False))
        proposal = ProposalDocument.model_validate(self.proposal)
        barrier = Barrier(2)
        render = exporter._html
        def synchronize(*args):
            render(*args)
            barrier.wait(timeout=10)
        with patch.object(exporter, "_html", side_effect=synchronize):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(export_proposal, proposal) for _ in range(2)]
                values = [future.result(timeout=10) for future in futures]
        self.assertEqual(values[0], values[1])
        self.assertEqual(len([p for p in self.out.glob("proposal-*") if p.is_dir()]), 1)
        self.assertEqual(self.manifest()["status"], "draft")

    def test_existing_bundle_tampering_is_detected(self):
        self.run_export()
        self.path("html").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "immutable bundle has changed"):
            self.run_export()

    def test_html_escapes_content_and_disallows_active_content(self):
        injection = '<script>alert("x")</script>'
        self.proposal["title"] = injection
        self.proposal["slides"][-1]["claims"][1]["text"] = injection
        self.run_export()
        page = lhtml.fromstring(self.path("html").read_text())
        self.assertFalse(page.xpath("//script|//iframe|//form|//object|//img"))
        csp = page.xpath('//meta[@http-equiv="Content-Security-Policy"]')[0].get("content")
        self.assertIn("script-src 'none'", csp)
        self.assertIn("connect-src 'none'", csp)
        self.assertIn(injection, page.text_content())
        for anchor in page.xpath("//a[@href]"):
            self.assertTrue(anchor.get("href").startswith(("#", "http://", "https://")))
            if anchor.get("href").startswith("https:"):
                self.assertIn("noopener", anchor.get("rel"))

    def test_non_http_citation_link_is_rejected(self):
        for bad in ("javascript:alert(1)", "file:///etc/passwd", "https://name:secret@example.com", "https://example.com/\nunsafe"):
            with self.subTest(url=bad):
                self.source["evidence"][0]["url"] = bad
                with self.assertRaises(ValueError):
                    self.run_export()
                self.assert_unpublished()

    def test_arbitrary_paths_and_assets_cannot_enter_schema(self):
        self.proposal["slides"][0]["asset_path"] = "/etc/passwd"
        with self.assertRaises(ValueError):
            self.run_export()
        self.assert_unpublished()

    def test_dense_table_paginates_without_shrinking_or_losing_rows(self):
        table = self.proposal["slides"][1]["table"]
        for row in table["rows"]:
            row["cells"] = ["过长文本" * 13] * 3
        table["rows"] += [copy.deepcopy(table["rows"][0]), copy.deepcopy(table["rows"][0])]
        self.run_export()
        deck = Presentation(self.path("pptx"))
        tables = []
        for slide in deck.slides:
            if not slide.has_notes_slide:
                continue
            value = slide.notes_slide.notes_text_frame.text
            if not value.startswith("CHUGAO_CONTENT_V2\n"):
                continue
            if json.loads(value.split("\n", 1)[1])["contentIndex"] == 2:
                tables.extend(shape.table for shape in slide.shapes if shape.has_table)
        self.assertGreater(len(tables), 1)
        rows = [[cell.text for cell in list(row.cells)[:-1]] for native in tables for row in list(native.rows)[1:]]
        self.assertEqual(rows, [row["cells"] for row in table["rows"]])
        for native in tables:
            for row in list(native.rows)[1:]:
                for cell in list(row.cells)[:-1]:
                    self.assertTrue(all(run.font.size.pt == 16 for paragraph in cell.text_frame.paragraphs for run in paragraph.runs))

    def test_long_lead_gets_its_own_page_before_dense_table(self):
        section = self.proposal["slides"][1]
        section["claims"] = [{"text": "比较条件尚待补充" * 15, "status": "unknown"}]
        section["table"] = {
            "columns": ["方案", "适用条件", "成本边界", "验证证据", "改变决定的条件"],
            "rows": [{"cells": ["待验证的实际使用条件" * 5 + "补充"] * 5, "status": "unknown"} for _ in range(2)],
        }
        self.run_export()
        deck = Presentation(self.path("pptx"))
        pages = []
        for slide in deck.slides:
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.startswith("CHUGAO_CONTENT_V2\n"):
                note = json.loads(slide.notes_slide.notes_text_frame.text.split("\n", 1)[1])
                if note["contentIndex"] == 2:
                    self.assertEqual(note["slide"], ProposalDocument.model_validate(self.proposal).slides[1].model_dump())
                    pages.append(slide)
        self.assertGreater(len(pages), 1)
        self.assertFalse(any(shape.has_table for shape in pages[0].shapes))
        visible = "\n".join(shape.text for slide in pages for shape in slide.shapes if shape.has_text_frame)
        self.assertEqual(visible.count(section["claims"][0]["text"]), 1)
        rows = [[cell.text for cell in list(row.cells)[:-1]] for slide in pages for shape in slide.shapes if shape.has_table for row in list(shape.table.rows)[1:]]
        self.assertEqual(rows, [row["cells"] for row in section["table"]["rows"]])

    def test_forged_bundle_status_is_rejected(self):
        self.run_export()
        path = self.out / self.manifest()["bundle"] / "bundle-manifest.json"
        value = json.loads(path.read_text())
        value["status"] = "review_ready"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "metadata does not match"):
            self.run_export()

    def test_old_price_cannot_return_through_assumption_basis(self):
        self.proposal["slides"][1]["table"]["rows"][0]["assumption_basis"] = "已假设售价299元"
        with self.assertRaisesRegex(ValueError, "numeric values"):
            self.run_export()
        self.assert_unpublished()

    def test_old_price_hypothesis_cannot_reappear(self):
        claim = self.proposal["slides"][0]["claims"][2]
        claim["text"] = "建议以299元作为基础款价格假设。"
        with self.assertRaisesRegex(ValueError, "exactly match"):
            self.run_export()
        self.assert_unpublished()

    def test_missing_or_rejected_hypothesis_cannot_be_exported(self):
        for key in ("absent-old-price", "hyp-container-first"):
            with self.subTest(key=key):
                self.proposal["slides"][0]["claims"][2]["hypothesis_id"] = key
                self.source["finalResearchPackage"]["hypotheses"][0]["status"] = "rejected"
                with self.assertRaisesRegex(ValueError, "retained, non-rejected"):
                    self.run_export()
                self.assert_unpublished()

    def test_old_price_cannot_return_through_hypothesis_table(self):
        self.proposal["slides"][1]["table"]["rows"][0]["cells"][1] = "入门售价299元"
        with self.assertRaisesRegex(ValueError, "numeric values"):
            self.run_export()
        self.assert_unpublished()

    def test_new_numeric_recommendation_needs_provenance(self):
        self.proposal["slides"][2]["steps"][0]["detail"] = "建议售价299元。"
        with self.assertRaisesRegex(ValueError, "Numeric recommendations"):
            self.run_export()
        self.assert_unpublished()

    def test_unchanged_hypothesis_cannot_support_new_price_recommendation(self):
        step = self.proposal["slides"][2]["steps"][0]
        step["detail"] = "建议售价299元。"
        step["hypothesis_ids"] = ["hyp-container-first"]
        with self.assertRaisesRegex(ValueError, "numeric values"):
            self.run_export()
        self.assert_unpublished()

    def test_retained_numeric_hypothesis_can_support_table_value(self):
        self.source["finalResearchPackage"]["hypotheses"][1]["text"] += "预设测试价格299元，尚未做定价验证。"
        self.proposal["slides"][1]["table"]["rows"][0]["cells"][1] = "测试价格299元"
        self.run_export()
        self.assertEqual(self.manifest()["status"], "draft")

    def test_user_provided_text_is_cited_without_hyperlinks_in_all_formats(self):
        record = self.source["evidence"][0]
        record.update({"status": "provided", "url": "attachment:fixture-user-text", "contentKind": "user_provided_text", "sourceAvailability": "captured"})
        self.run_export()
        deck = Presentation(self.path("pptx"))
        ppt_text = "\n".join(shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame)
        doc = Document(self.path("docx"))
        doc_text = "\n".join(paragraph.text for paragraph in doc.paragraphs)
        page = lhtml.fromstring(self.path("html").read_text())
        for text in (ppt_text, doc_text, page.text_content()):
            self.assertIn("用户材料记载", text)
            self.assertIn("attachment:fixture-user-text", text)
            self.assertIn("不构成外部独立来源", text)
        self.assertFalse(page.xpath('//a[starts-with(@href,"attachment:") or starts-with(@href,"file:") or starts-with(@href,"http:") or starts-with(@href,"https:")]'))
        for fmt in ("pptx", "docx"):
            with ZipFile(self.path(fmt)) as archive:
                rels = "\n".join(archive.read(name).decode() for name in archive.namelist() if name.endswith(".rels"))
                self.assertNotIn("attachment:", rels)
                self.assertNotIn("/hyperlink", rels)

    def test_empty_attachment_and_image_placeholder_do_not_support_observations(self):
        record = self.source["evidence"][0]
        record.update({"status": "provided", "url": "attachment:fixture-image", "contentKind": "user_provided_text", "sourceAvailability": "captured"})
        for text in ("", "   "):
            with self.subTest(content=text):
                record["content"] = text
                with self.assertRaisesRegex(ValueError, "original text"):
                    self.run_export()
                self.assert_unpublished()
        record.update({"contentKind": "image_placeholder", "content": "等待图像分析"})
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.run_export()
        self.assert_unpublished()

    def test_captured_status_cannot_promote_search_excerpt(self):
        record = self.source["evidence"][0]
        record.update({"status": "captured", "contentKind": "search_excerpt", "sourceAvailability": "captured"})
        with self.assertRaisesRegex(ValueError, "contentKind/sourceAvailability"):
            self.run_export()
        self.assert_unpublished()

    def test_original_content_requires_truthful_available_state(self):
        for changes in ({"sourceAvailability": "purged"}, {"sourceAvailability": "not_fetched"}, {"contentKind": None}, {"content": ""}):
            with self.subTest(changes=changes):
                original = copy.deepcopy(self.source["evidence"][0])
                self.source["evidence"][0].update(changes)
                with self.assertRaisesRegex(ValueError, "original text"):
                    self.run_export()
                self.assert_unpublished()
                self.source["evidence"][0] = original

    def test_attachment_identity_cannot_be_forged_by_external_url(self):
        record = self.source["evidence"][0]
        record.update({"status": "provided", "contentKind": "user_provided_text"})
        with self.assertRaisesRegex(ValueError, "owned attachment identifier"):
            self.run_export()
        self.assert_unpublished()
        record.update({"status": "captured", "url": "attachment:fake-web-source", "contentKind": "captured_text"})
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.run_export()
        self.assert_unpublished()

    def test_32_package_caveats_of_500_chars_survive_all_formats(self):
        caveats = []
        for index in range(32):
            prefix = f"第{index:02d}项限制："
            body = prefix + "须补证" * ((500 - len(prefix)) // 3)
            caveats.append(body + "界" * (500 - len(body)))
        self.source["finalResearchPackage"]["caveats"] = caveats
        self.run_export()
        deck = Presentation(self.path("pptx"))
        fragments = {}
        for slide in deck.slides:
            for shape in slide.shapes:
                if shape.has_text_frame and shape.name.startswith("chugao-appendix-body:限制 "):
                    fragments.setdefault(shape.name, []).append(shape.text)
        ppt_caveats = ["".join(values) for values in fragments.values()]
        doc_text = "\n".join(paragraph.text for paragraph in Document(self.path("docx")).paragraphs)
        html_text = lhtml.fromstring(self.path("html").read_text()).text_content()
        for caveat in caveats:
            self.assertIn(caveat, ppt_caveats)
            self.assertIn(caveat, doc_text)
            self.assertIn(caveat, html_text)

    def test_source_event_time_labels_preserve_meaning_in_every_format(self):
        cases = [
            ({"fetchedAt": "2026-10-18T01:00:00Z", "capturedAt": "2025-01-01T00:00:00Z", "createdAt": "2024-01-01T00:00:00Z"}, "抓取时间：2026-10-18T01:00:00Z"),
            ({"capturedAt": "2025-01-01T00:00:00Z", "createdAt": "2024-01-01T00:00:00Z"}, "留档时间：2025-01-01T00:00:00Z"),
            ({"createdAt": "2024-01-01T00:00:00Z"}, "记录创建时间：2024-01-01T00:00:00Z"),
            ({}, "来源时间未提供"),
        ]
        for fields, expected in cases:
            with self.subTest(expected=expected):
                record = self.source["evidence"][0]
                for field in ("fetchedAt", "capturedAt", "createdAt"):
                    record.pop(field, None)
                record.update(fields)
                self.source["finalResearchPackage"]["generatedAt"] = "2099-01-01T00:00:00Z"
                self.run_export()
                deck = Presentation(self.path("pptx"))
                ppt_text = "\n".join(shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame)
                doc_text = "\n".join(paragraph.text for paragraph in Document(self.path("docx")).paragraphs)
                html_text = lhtml.fromstring(self.path("html").read_text()).text_content()
                for content in (ppt_text, doc_text, html_text):
                    self.assertIn(expected, content)
                    self.assertNotIn("2099-01-01", content)
                    self.assertNotIn("发布日期", content)

    def test_v2_cannot_hide_untyped_claims_in_legacy_sections(self):
        self.proposal["sections"] = [{"title": "假市场规模", "body": "已经核验的虚构市场数字。"}]
        with self.assertRaisesRegex(ValueError, "legacy"):
            self.run_export()
        self.assert_unpublished()

    def test_actual_three_inputs_export_without_semantic_edits(self):
        package = json.loads((FIXTURES / "office_lunch_actual_package.json").read_text())
        self.source = {"products": ["pptx", "docx", "html"], "evidence": package["evidence"], "finalResearchPackage": package}
        inputs = json.loads((FIXTURES / "office_lunch_actual_tool_inputs.json").read_text())
        for record in inputs:
            proposal = record["arguments"]["proposal"]
            with self.subTest(call_id=record["callId"]):
                before = copy.deepcopy(proposal)
                self.run_export(proposal)
                self.assertEqual(proposal, before)
                deck = Presentation(self.path("pptx"))
                preserved = {}
                for slide in deck.slides:
                    if not slide.has_notes_slide:
                        continue
                    value = slide.notes_slide.notes_text_frame.text
                    if value.startswith("CHUGAO_CONTENT_V2\n"):
                        note = json.loads(value.split("\n", 1)[1])
                        preserved[note["contentIndex"]] = note["slide"]
                expected = ProposalDocument.model_validate(proposal)
                self.assertEqual(preserved, {index: slide.model_dump() for index, slide in enumerate(expected.slides, 1)})
                html_text = lhtml.fromstring(self.path("html").read_text()).text_content()
                doc = Document(self.path("docx"))
                doc_text = "\n".join(paragraph.text for paragraph in doc.paragraphs)
                visible = "\n".join(shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame)
                visible += "\n" + "\n".join(cell.text for slide in deck.slides for shape in slide.shapes if shape.has_table for row in shape.table.rows for cell in row.cells)
                for slide in expected.slides:
                    for item in exporter._items(slide):
                        if item.assumption_basis:
                            self.assertIn(item.assumption_basis, visible)
                            self.assertIn(item.assumption_basis, doc_text)
                            self.assertIn(item.assumption_basis, html_text)
                for caveat in package["caveats"]:
                    self.assertIn(caveat, visible)
                    self.assertIn(caveat, doc_text)
                    self.assertIn(caveat, html_text)
                self.assertTrue(any(shape.name.startswith("chugao-appendix-body:限制 ") for shape in deck.slides[-1].shapes), "The last appendix page must not strand just the final source links")

    def test_word_small_tables_and_processes_remain_grouped(self):
        for slide in self.proposal["slides"]:
            if slide.get("table") or slide.get("steps"):
                slide["claims"] = [{"text": "根据" + slide["title"] + "确定下一步比较任务。", "status": "recommendation"}]
        self.run_export()
        doc = Document(self.path("docx"))
        leads = [claim["text"] for slide in self.proposal["slides"] if slide.get("table") or slide.get("steps") for claim in slide.get("claims", [])]
        self.assertTrue(leads)
        for lead in leads:
            paragraph = next(paragraph for paragraph in doc.paragraphs if paragraph.text.endswith(lead))
            self.assertTrue(paragraph.paragraph_format.keep_with_next)
        for table in doc.tables:
            for row in list(table.rows)[:-1]:
                self.assertTrue(all(paragraph.paragraph_format.keep_with_next for cell in row.cells for paragraph in cell.paragraphs))
        paragraphs = [paragraph for paragraph in doc.paragraphs if paragraph.text.startswith(("1. 核对", "2. 收集", "3. 检验", "4. 回到"))]
        self.assertEqual(len(paragraphs), 4)
        self.assertTrue(all(paragraph.paragraph_format.keep_together for paragraph in paragraphs))
        self.assertTrue(all(paragraph.paragraph_format.keep_with_next for paragraph in paragraphs[:-1]))
        first_paragraphs = "\n".join(paragraph.text for paragraph in doc.paragraphs[:4])
        self.assertNotIn(self.proposal["package_version"], first_paragraphs)
        self.assertEqual(doc.core_properties.identifier, self.proposal["package_version"])

    def test_shared_process_basis_is_shown_once_with_all_source_semantics(self):
        package = json.loads((FIXTURES / "office_lunch_actual_package.json").read_text())
        proposal = json.loads((FIXTURES / "office_lunch_actual_tool_inputs.json").read_text())[1]["arguments"]["proposal"]
        self.source = {"products": ["pptx", "docx", "html"], "evidence": package["evidence"], "finalResearchPackage": package}
        basis = proposal["slides"][2]["steps"][0]["assumption_basis"]
        self.run_export(proposal)
        deck = Presentation(self.path("pptx"))
        texts = [shape.text for slide in deck.slides for shape in slide.shapes if shape.has_text_frame]
        self.assertEqual(texts.count(basis), 1)
        page = lhtml.fromstring(self.path("html").read_text())
        self.assertEqual(page.text_content().count(basis), 1)
        process_links = page.xpath('//*[@class="process"]//a[starts-with(@href,"#basis-")]')
        self.assertEqual(len(process_links), 5)
        self.assertEqual(len({link.get("href") for link in process_links}), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
