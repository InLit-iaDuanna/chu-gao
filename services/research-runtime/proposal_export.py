"""Bounded, evidence-aware native proposal exporter.

All requested formats are generated from one semantic content model.  A complete
bundle is immutable and becomes visible only via an atomic manifest replacement.
This validates provenance structure, not whether a source semantically entails a
claim.  That remains the research quality gate and human review's responsibility.
"""
from __future__ import annotations

import hashlib
import errno
import html
import json
import math
import os
import re
import subprocess
import tempfile
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

EXPORTER_VERSION = "2.1.1"
FONT = "Noto Sans CJK SC"
STATUS_LABELS = {
    "observed": "来源记载", "verified": "已核验", "user_requirement": "用户要求",
    "hypothesis": "待验证假设", "recommendation": "设计建议", "unknown": "尚缺证据",
}
ClaimStatus = Literal["observed", "verified", "user_requirement", "hypothesis", "recommendation", "unknown"]
EvidenceId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProposalClaim(StrictModel):
    text: str = Field(min_length=1, max_length=120)
    status: ClaimStatus
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    assumption_basis: str = Field(default="", max_length=160, description="For a hypothesis claim, copy the retained hypothesis basis exactly. Do not summarize or paraphrase it.")
    hypothesis_id: EvidenceId | None = None


class ProposalRow(StrictModel):
    cells: list[Annotated[str, Field(min_length=1, max_length=52)]] = Field(min_length=2, max_length=5)
    status: ClaimStatus
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=4)
    assumption_basis: str = Field(default="", max_length=100)
    hypothesis_ids: list[EvidenceId] = Field(default_factory=list, max_length=4)


class ProposalTable(StrictModel):
    columns: list[Annotated[str, Field(min_length=1, max_length=20)]] = Field(min_length=2, max_length=5)
    rows: list[ProposalRow] = Field(min_length=2, max_length=5)

    @model_validator(mode="after")
    def rectangular(self):
        if any(len(row.cells) != len(self.columns) for row in self.rows):
            raise ValueError("Every table row must match the column count")
        return self


class ProposalStep(StrictModel):
    title: str = Field(min_length=1, max_length=26)
    detail: str = Field(min_length=1, max_length=82)
    status: ClaimStatus
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=4)
    assumption_basis: str = Field(default="", max_length=100)
    hypothesis_ids: list[EvidenceId] = Field(default_factory=list, max_length=4)


class ProposalSlide(StrictModel):
    title: str = Field(min_length=1, max_length=72)
    layout: Literal["overview", "comparison", "process", "tradeoffs", "evidence"] = Field(default="overview", description="A semantic section, not a fixed physical slide. The exporter paginates without changing claims, status, citations or hypothesis basis.")
    claims: list[ProposalClaim] = Field(default_factory=list, max_length=5)
    table: ProposalTable | None = None
    steps: list[ProposalStep] = Field(default_factory=list, max_length=5)
    # Only contract v1 accepts prose without claim status. It is visibly a draft.
    points: list[Annotated[str, Field(min_length=1, max_length=90)]] = Field(default_factory=list, max_length=6)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)


class ProposalSection(StrictModel):
    """Legacy v1 input; v2 derives all formats from slides to prevent divergence."""
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=3000)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=8)


class ProposalDocument(StrictModel):
    contract_version: Literal[1, 2] = 1
    package_version: str = Field(default="", max_length=128)
    status: Literal["draft", "review_ready"] = "draft"
    title: str = Field(min_length=1, max_length=80)
    subtitle: str = Field(default="", max_length=240)
    slides: list[ProposalSlide] = Field(min_length=1, max_length=16)
    sections: list[ProposalSection] = Field(default_factory=list, max_length=24)
    caveats: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def semantic_layout(self):
        if self.contract_version == 1:
            if not all(slide.points or slide.claims or slide.table or slide.steps for slide in self.slides):
                raise ValueError("Slides must have content")
            return self
        if not self.package_version:
            raise ValueError("v2 requires immutable package_version")
        if self.sections or any(slide.points for slide in self.slides):
            raise ValueError("v2 uses structured slides for all formats; legacy points/sections are draft-only")
        for slide in self.slides:
            if slide.layout in ("comparison", "tradeoffs"):
                if slide.table is None or slide.steps or len(slide.claims) > 1:
                    raise ValueError("comparison/tradeoffs requires a table and at most one lead claim")
            elif slide.layout == "process":
                if not 2 <= len(slide.steps) <= 5 or slide.table or len(slide.claims) > 1:
                    raise ValueError("process requires 2–5 structured steps and at most one lead claim")
            elif not slide.claims or slide.table or slide.steps:
                raise ValueError("overview/evidence requires 1–5 structured claims")
        return self


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _safe_url(value: str) -> str:
    if not isinstance(value, str) or re.search(r"[\s\x00-\x1f\x7f]", value):
        raise ValueError("Evidence URL must be a non-empty public http(s) URL without whitespace")
    parsed = urlsplit(value)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Evidence URL must use http(s), without embedded credentials")
    # Links are never fetched by this exporter. Disallow backslashes to avoid parser disagreement.
    if "\\" in value:
        raise ValueError("Evidence URL contains a backslash")
    return value


def _is_attachment_url(value):
    return isinstance(value, str) and re.fullmatch(r"attachment:[A-Za-z0-9_-]{1,120}", value) is not None


def _is_user_material(record):
    return (record.get("status") == "provided" and _is_attachment_url(record.get("url"))
            and record.get("contentKind") == "user_provided_text")


def _citation_target(record):
    if str(record.get("url", "")).startswith("attachment:"):
        if not _is_user_material(record):
            raise ValueError("Attachment citations require persisted provided/user_provided_text provenance")
        return None  # A source identifier is neither a network URL nor a local file link.
    if record.get("status") == "provided" or record.get("contentKind") == "user_provided_text":
        raise ValueError("User-provided text requires an owned attachment identifier, not an external URL")
    return _safe_url(record.get("url", ""))


def _has_original_text(record):
    if (record.get("sourceAvailability") != "captured"
            or not isinstance(record.get("content"), str) or not record["content"].strip()
            or record.get("relevance") == "rejected" or record.get("selected") is False):
        return False
    if _is_user_material(record):
        return True
    return (record.get("status") == "captured" and record.get("contentKind") == "captured_text"
            and not str(record.get("url", "")).startswith("attachment:"))


def _origin_label(record):
    return "用户材料 " + record["url"] if _is_user_material(record) else str(urlsplit(record["url"]).hostname)


def _source_time(record):
    # These are provenance event times, never the source's publication date.
    for key, label in (("fetchedAt", "抓取时间"), ("capturedAt", "留档时间"), ("createdAt", "记录创建时间")):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return label + "：" + value.strip()
    return "来源时间未提供"


def _dedupe(values):
    return list(dict.fromkeys(values))


def _norm(text):
    return re.sub(r"\s+", "", str(text)).strip("。.!！")


def _items(slide):
    yield from slide.claims
    if slide.table:
        yield from slide.table.rows
    yield from slide.steps


def _slide_ids(slide):
    return _dedupe([*slide.evidence_ids, *(identifier for item in _items(slide) for identifier in item.evidence_ids)])


def _facts_text(item):
    if isinstance(item, ProposalClaim):
        return item.text
    if isinstance(item, ProposalStep):
        return item.detail
    return "；".join(item.cells)


def _hypothesis_ids(item):
    return ([item.hypothesis_id] if item.hypothesis_id else []) if isinstance(item, ProposalClaim) else item.hypothesis_ids


def _number_units(text):
    # This is a numeric provenance check, not semantic entailment. It catches old
    # prices/times/dimensions returning through a recommendation or table row.
    unit = r"(?:万元|美元|欧元|人民币|分钟|小时|秒钟|千克|公斤|毫升|厘米|毫米|千瓦|元|秒|克|升|瓦|%|％|(?:USD|CNY|RMB|EUR|mm|cm|kg|ml|kWh|Wh|W|L|g|min)\b)"
    number = r"\d+(?:[.,]\d+)*(?:\s*[-~～–至]\s*\d+(?:[.,]\d+)*)?"
    pattern = r"(?:[¥￥$€]\s*" + number + r"|" + number + r"\s*" + unit + r")"
    matches = re.findall(pattern, str(text), flags=re.IGNORECASE)
    return {re.sub(r"[-~～–至]", "-", re.sub(r"\s|,", "", match)).lower() for match in matches}


def _source_package(source):
    package = source.get("finalResearchPackage")
    return package if isinstance(package, dict) else {}


def _validate(proposal, source):
    package = _source_package(source)
    entries = source.get("evidence", [])
    if not isinstance(entries, list):
        raise ValueError("evidence must be a list")
    evidence = {}
    for entry in entries:
        identifier = entry.get("id") if isinstance(entry, dict) else None
        if not identifier or identifier in evidence:
            raise ValueError("Evidence IDs must be present and unique")
        evidence[identifier] = entry
    referenced = _dedupe([*(identifier for slide in proposal.slides for identifier in _slide_ids(slide)),
                          *(identifier for section in proposal.sections for identifier in section.evidence_ids)])
    if len(referenced) > 32:
        raise ValueError("A proposal may cite at most 32 sources; select decision-relevant evidence")
    for identifier in referenced:
        if identifier not in evidence:
            raise ValueError("Unknown evidence ID: " + identifier)
        _citation_target(evidence[identifier])
    warnings = []
    effective_status = proposal.status
    if proposal.contract_version == 1:
        effective_status = "draft"
        warnings.append("旧版文本提案缺少逐条论据状态，本文件仅为待核验草稿。")
    else:
        if package.get("schemaVersion") != 2 or package.get("version") != proposal.package_version:
            raise ValueError("Proposal package_version must match the supplied immutable v2 research package")
        quality = package.get("quality", {})
        quality = quality if isinstance(quality, dict) else {}
        if effective_status == "review_ready" and quality.get("status") != "supported":
            raise ValueError("review_ready requires finalResearchPackage.quality.status=supported")
        if effective_status == "review_ready" and not referenced:
            raise ValueError("review_ready requires structured source citations")
        requirements = package.get("finalBrief", {}).get("confirmedRequirements", [])
        confirmed = {_norm(item.get("text", "") if isinstance(item, dict) else item) for item in requirements}
        retained = {}
        for hypothesis in package.get("hypotheses", []):
            if not isinstance(hypothesis, dict) or not hypothesis.get("id") or hypothesis["id"] in retained:
                raise ValueError("Package hypothesis IDs must be present and unique")
            retained[hypothesis["id"]] = hypothesis
        for slide in proposal.slides:
            for item in _items(slide):
                if item.status in ("observed", "verified"):
                    if not item.evidence_ids:
                        raise ValueError("Observed/verified claims require structured evidence_ids")
                    for identifier in item.evidence_ids:
                        record = evidence[identifier]
                        # State alone is insufficient: a cached search snippet or
                        # an image placeholder is not extracted/captured original text.
                        if record.get("relevance") == "rejected" or record.get("selected") is False:
                            raise ValueError("Rejected evidence cannot support a factual claim: " + identifier)
                        if not _has_original_text(record):
                            raise ValueError("Observed/verified claims require captured evidence with original text and truthful contentKind/sourceAvailability: " + identifier)
                    if item.status == "verified":
                        # A model cannot promote its own conclusion just by choosing a label.
                        verified = package.get("verifiedClaims", [])
                        exact = [v for v in verified if isinstance(v, dict) and _norm(v.get("text", "")) == _norm(_facts_text(item))]
                        if not any(set(item.evidence_ids) <= set(v.get("evidenceIds", [])) for v in exact):
                            raise ValueError("verified requires an exact verifiedClaims entry from the research package")
                if item.status == "user_requirement" and _norm(_facts_text(item)) not in confirmed:
                    raise ValueError("user_requirement must match a confirmed user requirement")
                ids = _hypothesis_ids(item)
                for identifier in ids:
                    if identifier not in retained or retained[identifier].get("status") == "rejected":
                        raise ValueError("Hypothesis must refer to a retained, non-rejected package hypothesis: " + identifier)
                if item.status == "hypothesis":
                    if not item.assumption_basis:
                        raise ValueError("Hypotheses require an explicit assumption_basis")
                    if not ids:
                        raise ValueError("Hypotheses require hypothesis_id/hypothesis_ids from the frozen package")
                    if isinstance(item, ProposalClaim):
                        if _norm(item.text) != _norm(retained[ids[0]].get("text", "")):
                            raise ValueError("Hypothesis claim text must exactly match its retained package version")
                        if _norm(item.assumption_basis) != _norm(retained[ids[0]].get("basis", "")):
                            raise ValueError("Hypothesis assumption_basis must exactly match its retained package version")
                    retained_numbers = set().union(*(_number_units(retained[identifier].get("text", "")) for identifier in ids))
                    if not _number_units(_facts_text(item) + " " + item.assumption_basis) <= retained_numbers:
                        raise ValueError("Hypothesis numeric values must occur in its retained package text")
                if item.status == "recommendation" and _number_units(_facts_text(item)):
                    captured = [identifier for identifier in item.evidence_ids if _has_original_text(evidence[identifier])]
                    if not ids and not captured:
                        raise ValueError("Numeric recommendations require a retained hypothesis or captured evidence")
                    if ids and not captured:
                        retained_numbers = set().union(*(_number_units(retained[identifier].get("text", "")) for identifier in ids))
                        if not _number_units(_facts_text(item) + " " + item.assumption_basis) <= retained_numbers:
                            raise ValueError("Recommendation numeric values must occur in retained hypothesis text")
                if item.status != "hypothesis" and item.assumption_basis:
                    raise ValueError("assumption_basis is only valid for hypothesis status")
        if quality.get("status") != "supported":
            warnings.append("研究证据尚未达到交付条件，结论需要补证。")
    if effective_status == "draft":
        warnings.insert(0, "研究草稿：不应作为已完成市场调研或已验证性能承诺。")
    if any(_is_user_material(evidence[identifier]) for identifier in referenced):
        warnings.append("用户材料记载来自用户提供的文本，不构成外部独立来源或图像分析结论。")
    caveats = [*warnings, *proposal.caveats]
    package_caveats = package.get("caveats", [])
    if not isinstance(package_caveats, list) or len(package_caveats) > 32:
        raise ValueError("Package caveats must contain at most 32 entries")
    for caveat in package_caveats:
        if not isinstance(caveat, str):
            raise ValueError("Package caveats must be strings")
        if len(caveat) > 500:
            raise ValueError("A package caveat exceeds the 500-character readable export limit")
        if caveat.strip():
            caveats.append(caveat.strip())
    caveats = _dedupe(caveats)
    if len(caveats) > 64:
        raise ValueError("Too many caveats; reconcile duplicated or superseded constraints first")
    formats = set(source.get("products", [])) & {"pptx", "docx", "html"}
    if not formats:
        raise ValueError("At least one requested format is required")
    bases = []
    basis_numbers = {}
    for slide in proposal.slides:
        for item in _items(slide):
            if item.assumption_basis and item.assumption_basis not in basis_numbers:
                basis_numbers[item.assumption_basis] = len(bases) + 1
                bases.append({"id": f"B{len(bases) + 1}", "text": item.assumption_basis})
    return {"evidence": evidence, "references": referenced, "numbers": {v: i + 1 for i, v in enumerate(referenced)},
            "warnings": warnings, "caveats": caveats, "status": effective_status, "formats": sorted(formats),
            "bases": bases, "basis_numbers": basis_numbers,
            "package_version": package.get("version") if proposal.contract_version == 2 else None}


def _reference_label(identifier, context):
    return f"[{context['numbers'][identifier]}]"


def _status_label(item, context):
    provided = [_is_user_material(context["evidence"][identifier]) for identifier in item.evidence_ids]
    if item.status in ("observed", "verified") and any(provided):
        if all(provided):
            return "用户材料记载" + ("（已核对）" if item.status == "verified" else "")
        return STATUS_LABELS[item.status] + "（含用户材料）"
    return STATUS_LABELS[item.status]


def _labels(item, context):
    refs = " ".join(_reference_label(value, context) for value in item.evidence_ids)
    return _status_label(item, context) + (" " + refs if refs else "")


def _source_title(identifier, context):
    return str(context["evidence"][identifier].get("title") or _origin_label(context["evidence"][identifier]))


def _units(text):
    """Fallback width in ems; font-backed measurement is preferred when available."""
    return sum(0 if unicodedata.combining(ch) else 1 if ord(ch) > 255 else .68 for ch in text)


@lru_cache(maxsize=8)
def _measurement_font(explicit_path):
    """Resolve the declared font without installing fonts or changing global config."""
    from PIL import ImageFont
    path, face_index = explicit_path, 0
    if not path:
        try:
            result = subprocess.run(["fc-match", "-f", "%{file}\n%{index}", FONT], capture_output=True, text=True, timeout=2)
            fields = result.stdout.strip().splitlines() if result.returncode == 0 else []
            path = fields[0] if fields else ""
            face_index = int(fields[1]) if len(fields) > 1 else 0
        except (OSError, ValueError, subprocess.TimeoutExpired):
            path = ""
    if path:
        try:
            font = ImageFont.truetype(path, 1000, index=face_index)
            if font.getname()[0] == FONT:
                return font
        except (OSError, ValueError):
            pass
    return None


def _wrapped_lines(text, width_inches, font_pt):
    # Pillow's getlength reports advance width; unlike fit_text, we never change
    # the chosen font size. Leave room for CJK punctuation and renderer variance.
    font = _measurement_font(os.environ.get("CHUGAO_PROPOSAL_FONT_FILE", ""))
    width = max(.1, width_inches * 72 / font_pt * .94)

    def measure(value):
        return font.getlength(value) / 1000 if font else _units(value)

    total = 0
    for paragraph in text.split("\n"):
        if not paragraph:
            total += 1
            continue
        lines, current = 1, 0.0
        for token in re.findall(r"[A-Za-z0-9]+(?:[._:/%?&=+-][A-Za-z0-9]*)*|[ \t]+|.", paragraph):
            size = measure(token)
            if current and current + size > width:
                lines += 1
                current = 0.0
            if size <= width:
                current += size
            else:
                for character in token:
                    length = measure(character)
                    if current and current + length > width:
                        lines += 1
                        current = 0.0
                    current += length
        total += lines
    return max(1, total)


def _text_height(text, width, size):
    return _wrapped_lines(text, width, size) * size * 1.5 / 72 + .06


def _basis_label(item, context):
    if not item.assumption_basis:
        return ""
    return f"依据 B{context['basis_numbers'][item.assumption_basis]}"


def _item_label(item, context):
    value = _labels(item, context)
    basis = _basis_label(item, context)
    return value + (" · " + basis if basis else "")


def _row_values(table, context):
    return [row.cells + [_item_label(row, context)] for row in table.rows]


def _column_widths(table, context, total):
    """Give real text columns capacity; provenance is a short, linked reference."""
    values = _row_values(table, context)
    status_width = min(1.75, total * .22)
    weights = []
    for index, heading in enumerate(table.columns):
        weight = max(_units(heading), *(min(24, _units(row[index])) for row in values))
        weights.append(max(7, min(18, weight)))
    usable = total - status_width
    widths = [usable * value / sum(weights) for value in weights]
    return [*widths, status_width]


def _chunks(items, height, capacity):
    """Paginate complete semantic items; never modify a status, basis or source."""
    group, used = [], 0.0
    for item in items:
        required = height(item)
        if required > capacity + .001:
            raise ValueError("An indivisible item exceeds page capacity; this is a renderer contract error")
        if group and used + required > capacity:
            yield group
            group, used = [], 0.0
        group.append(item)
        used += required
    if group:
        yield group


def _section_pages(leads, lead_height, items, item_height, capacity, overhead=0):
    """Keep a lead once, moving it to its own page when a whole item needs room."""
    leads, remaining = list(leads), list(items)
    required = sum(lead_height(item) for item in leads)
    if leads and remaining and required + overhead + item_height(remaining[0]) > capacity:
        for group in _chunks(leads, lead_height, capacity):
            yield group, []
        leads = []
    while remaining:
        available = capacity - overhead - sum(lead_height(item) for item in leads)
        group, used = [], 0.0
        for item in remaining:
            height = item_height(item)
            if group and used + height > available:
                break
            if height > available + .001:
                raise ValueError("An indivisible item exceeds page capacity; this is a renderer contract error")
            group.append(item)
            used += height
        yield leads, group
        leads, remaining = [], remaining[len(group):]


def _appendix_columns(items, height, capacity):
    heights = [height(item) for item in items]
    indices = list(range(len(items)))
    groups = list(_chunks(indices, lambda index: heights[index], capacity))
    # A final single column often strands only the last references. Rebalance
    # the same ordered entries across the existing pages, without smaller text.
    if len(groups) > 1 and len(groups) % 2:
        columns = len(groups) + 1
        low, high = max(max(heights), sum(heights) / columns), capacity
        for _ in range(18):
            middle = (low + high) / 2
            candidate = list(_chunks(indices, lambda index: heights[index], middle))
            if len(candidate) <= columns:
                high, groups = middle, candidate
            else:
                low = middle
    return [[items[index] for index in group] for group in groups]


def _split_paragraph(text, width, size, max_height):
    """Split appendix text by capacity, preserving every original character."""
    while text and _text_height(text, width, size) > max_height:
        low, high = 1, len(text)
        while low < high:
            middle = (low + high + 1) // 2
            if _text_height(text[:middle], width, size) <= max_height:
                low = middle
            else:
                high = middle - 1
        split = low
        boundaries = [text.rfind(mark, max(1, split // 2), split) + 1 for mark in ("。", "；", ";", "\n", " ")]
        if max(boundaries) > 0:
            split = max(boundaries)
        yield text[:split]
        text = text[split:]
    if text:
        yield text


def _pptx(proposal, context, path):
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx.oxml.xmlchemy import OxmlElement
    from pptx.util import Inches, Pt

    presentation = Presentation()
    presentation.slide_width, presentation.slide_height = Inches(13.333), Inches(7.5)
    colors = {"ink": "172F33", "muted": "526869", "accent": "246A61", "rule": "D7E1DF", "bg": "F2F6F4", "white": "FFFFFF", "warn": "84591F"}
    content_bottom = 6.52

    def font(run, size, color="ink", bold=False):
        run.font.name, run.font.size, run.font.bold = FONT, Pt(size), bold
        run.font.color.rgb = RGBColor.from_string(colors.get(color, color))
        props = run._r.get_or_add_rPr()
        for node_name in ("a:ea", "a:latin"):
            element = props.find(node_name, props.nsmap)
            if element is None:
                element = OxmlElement(node_name)
                props.append(element)
            element.set("typeface", FONT)

    def text(slide, x, y, width, height, value, size=20, color="ink", bold=False, link=None):
        if y + height > 7.3 or x + width > 13.2:
            raise ValueError("Text box exceeds page bounds")
        if _text_height(value, width, size) > height + .08:
            raise ValueError("Text box capacity is smaller than its measured contents")
        shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(width), Inches(height))
        frame = shape.text_frame
        frame.auto_size, frame.word_wrap = MSO_AUTO_SIZE.NONE, True
        frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
        frame.text = value
        for paragraph in frame.paragraphs:
            paragraph.space_before = paragraph.space_after = Pt(0)
            paragraph.line_spacing = 1.18
            for run in paragraph.runs:
                font(run, size, color, bold)
                if link:
                    run.hyperlink.address = link
                    run.font.color.rgb = RGBColor.from_string(colors.get(color, color))
                    run.font.underline = False
        return shape

    def page(title, label="研究提案"):
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        text(slide, .65, .28, 10.65, .29, proposal.title, 9, "muted")
        state = "研究草稿" if context["status"] == "draft" else "待评审提案"
        text(slide, 11.45, .28, 1.25, .30, state, 9, "warn", True)
        text(slide, .65, .76, 11.95, .29, label, 9, "accent", True)
        title_h = _text_height(title, 12.0, 30)
        text(slide, .65, 1.12, 12.0, title_h, title, 30, bold=True)
        return slide, 1.12 + title_h + .22

    def top_for(title):
        return 1.12 + _text_height(title, 12.0, 30) + .22

    def footer(slide, ids=()):
        refs = _dedupe(ids)
        # The contract permits 32 sources. Two rows of 16 fixed-size links end
        # before the version column; the full sources remain in the appendix.
        start_y = 6.68 if len(refs) > 16 else 7.0
        for i, identifier in enumerate(refs):
            shape = text(slide, .65 + (i % 16) * .50, start_y + (i // 16) * .32, .46, .28, _reference_label(identifier, context), 9, "accent", link=_citation_target(context["evidence"][identifier]))
            shape.name = "chugao-footer-reference:" + identifier
        text(slide, 8.9, 7.0, 3.2, .27, "版本 " + (context["package_version"] or "legacy-draft")[:12], 8, "muted")
        text(slide, 12.16, 7.0, .50, .28, str(len(presentation.slides)), 9, "muted")

    def page_ids(item, part, entries):
        return _dedupe([*(item.evidence_ids if part == 1 else []),
                        *(identifier for entry in entries for identifier in entry.evidence_ids)])

    def claim_height(item):
        return .27 + _text_height(item.text, 11.98, 20) + .14

    def claim(slide, item, y):
        label = _item_label(item, context)
        text(slide, .67, y, 11.95, .27, label, 9, "warn" if item.status in ("hypothesis", "unknown") else "accent", True)
        height = _text_height(item.text, 11.98, 20)
        text(slide, .67, y + .27, 11.98, height, item.text, 20)
        return y + .27 + height + .14

    def notes(slide, index, item, ids):
        # Preserve exact pre-pagination semantics, including source/hypothesis IDs,
        # even when shared bases are displayed once in the visible appendix.
        slide.notes_slide.notes_text_frame.text = "CHUGAO_CONTENT_V2\n" + _json({"contentIndex": index, "slide": item.model_dump(), "pageEvidenceIds": ids})

    for index, item in enumerate(proposal.slides, 1):
        if proposal.contract_version == 1 and item.points:
            entries = [ProposalClaim(text=value, status="recommendation") for value in item.points]
        else:
            entries = item.claims
        label = f"{index:02d} / " + {"overview": "研究判断", "evidence": "证据记录", "comparison": "方案比较", "tradeoffs": "设计取舍", "process": "验证流程"}[item.layout]

        section_top = max(top_for(item.title), top_for(item.title + "（续）"))
        if item.layout in ("overview", "evidence") or (proposal.contract_version == 1 and item.points):
            for part, group in enumerate(_chunks(entries, claim_height, content_bottom - section_top), 1):
                title = item.title if part == 1 else item.title + "（续）"
                slide, y = page(title, label)
                for entry in group:
                    y = claim(slide, entry, y)
                ids = page_ids(item, part, group)
                footer(slide, ids)
                notes(slide, index, item, ids)

        elif item.layout in ("comparison", "tradeoffs"):
            widths = _column_widths(item.table, context, 12.0)
            values = _row_values(item.table, context)
            def row_height(row):
                return max(.61, *(_text_height(value, width - .24, 12 if col == len(widths) - 1 else 16) + .20 for col, (value, width) in enumerate(zip(row, widths))))
            heading = item.table.columns + ["论据 / 依据"]
            header_h = max(.47, *(_text_height(value, width - .24, 12) + .15 for value, width in zip(heading, widths)))
            capacity = content_bottom - section_top
            rows = list(zip(item.table.rows, values))
            for part, (page_leads, group) in enumerate(_section_pages(entries, claim_height, rows, lambda pair: row_height(pair[1]), capacity, header_h), 1):
                title = item.title if part == 1 else item.title + "（续）"
                slide, y = page(title, label)
                for entry in page_leads:
                    y = claim(slide, entry, y)
                ids = page_ids(item, part, [*page_leads, *(row for row, _ in group)])
                if not group:
                    footer(slide, ids)
                    notes(slide, index, item, ids)
                    continue
                heights = [header_h, *(row_height(values) for _, values in group)]
                graphic = slide.shapes.add_table(len(group) + 1, len(widths), Inches(.65), Inches(y), Inches(12.0), Inches(sum(heights)))
                native = graphic.table
                for column, width in zip(native.columns, widths):
                    column.width = Inches(width)
                for row, height in zip(native.rows, heights):
                    row.height = Inches(height)
                for ri, row in enumerate([heading, *(values for _, values in group)]):
                    for ci, value in enumerate(row):
                        cell = native.cell(ri, ci)
                        cell.margin_left = cell.margin_right = Inches(.12)
                        cell.margin_top = cell.margin_bottom = Inches(.10)
                        cell.fill.solid()
                        cell.fill.fore_color.rgb = RGBColor.from_string(colors["accent"] if ri == 0 else colors["bg"] if ri % 2 else colors["white"])
                        cell.text = value
                        cell.text_frame.auto_size = MSO_AUTO_SIZE.NONE
                        for paragraph in cell.text_frame.paragraphs:
                            paragraph.space_before = paragraph.space_after = Pt(0)
                            paragraph.line_spacing = 1.18
                            for run in paragraph.runs:
                                font(run, 12 if ri == 0 or ci == len(widths) - 1 else 16, "white" if ri == 0 else "ink", ri == 0)
                footer(slide, ids)
                notes(slide, index, item, ids)

        elif item.layout == "process":
            def step_height(pair):
                _, step = pair
                return max(_text_height(step.title, 3.27, 19), .28 + _text_height(step.detail, 7.82, 17)) + .13
            capacity = content_bottom - section_top
            for part, (page_leads, group) in enumerate(_section_pages(entries, claim_height, list(enumerate(item.steps, 1)), step_height, capacity), 1):
                title = item.title if part == 1 else item.title + "（续）"
                slide, y = page(title, label)
                for entry in page_leads:
                    y = claim(slide, entry, y)
                for number, step in group:
                    marker = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(.67), Inches(y + .04), Inches(.40), Inches(.40))
                    marker.fill.solid()
                    marker.fill.fore_color.rgb = RGBColor.from_string(colors["accent"])
                    marker.line.fill.background()
                    text(slide, .79, y + .06, .28, .30, str(number), 10, "white", True)
                    text(slide, 1.29, y, 3.27, _text_height(step.title, 3.27, 19), step.title, 19, bold=True)
                    text(slide, 4.82, y, 7.82, .27, _item_label(step, context), 9, "accent")
                    text(slide, 4.82, y + .28, 7.82, _text_height(step.detail, 7.82, 17), step.detail, 17)
                    y += step_height((number, step))
                ids = page_ids(item, part, [*page_leads, *(step for _, step in group)])
                footer(slide, ids)
                notes(slide, index, item, ids)

    # One visible appendix stream replaces repeated warning pages. Full original
    # caveats and full shared bases remain present, ordered and addressable.
    appendix = []
    for basis in context["bases"]:
        appendix.append(("假设依据 " + basis["id"], basis["text"], None))
    for number, caveat in enumerate(context["caveats"], 1):
        appendix.append((f"限制 C{number}", caveat, None))
    for identifier in context["references"]:
        record = context["evidence"][identifier]
        appendix.append(("来源 " + _reference_label(identifier, context), _source_title(identifier, context) + "\n" + _origin_label(record) + " · " + _source_time(record), _citation_target(record)))
    if appendix:
        column_width, size = 5.20, 13
        capacity = content_bottom - top_for("依据与研究边界")
        fragments = []
        for label, body, link in appendix:
            for part, fragment in enumerate(_split_paragraph(body, column_width, size, capacity - .14)):
                fragments.append((label + ("（续）" if part else ""), fragment, link, part))
        groups = _appendix_columns(fragments, lambda value: _text_height(value[1], column_width, size) + .10, capacity)
        for offset in range(0, len(groups), 2):
            slide, top = page("依据与研究边界", f"附录 {offset // 2 + 1:02d} / B 假设依据 · C 研究限制 · [ ] 来源")
            for column, group in enumerate(groups[offset:offset + 2]):
                x, y = .67 + column * 6.24, top
                for label, body, link, part in group:
                    short_label = label.replace("假设依据 ", "").replace("限制 ", "").replace("来源 ", "").replace("（续）", "+")
                    text(slide, x, y + .02, .49, _text_height(short_label, .49, 9), short_label, 9, "accent", True, link)
                    # A separate label leaves the original paragraph intact in
                    # the editable body; continuations are marked in the label.
                    height = _text_height(body, column_width, size)
                    shape = text(slide, x + .48, y, column_width, height, body, size, "muted", link=link)
                    shape.name = "chugao-appendix-body:" + label.replace("（续）", "")
                    y += height + .10
            footer(slide)
            slide.notes_slide.notes_text_frame.text = "CHUGAO_APPENDIX_V2\n" + _json({"bases": context["bases"], "caveats": context["caveats"], "references": context["references"], "packageVersion": context["package_version"]})
    presentation.core_properties.title = proposal.title
    presentation.core_properties.subject = "Chugao semantic proposal v2; " + (context["package_version"] or "legacy draft")
    presentation.save(path)
    if not Presentation(path).slides:
        raise ValueError("PPTX contains no slides")
    return len(presentation.slides)


def _docx(proposal, context, path):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.shared import Inches, Pt, RGBColor

    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Inches(8.27), Inches(11.69)
    section.top_margin = section.bottom_margin = Inches(.68)
    section.left_margin = section.right_margin = Inches(.78)
    for name in ("Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "List Bullet"):
        style = document.styles[name]
        style.font.name = FONT
        style.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT)
        style.font.color.rgb = RGBColor.from_string("172F33")
        for border in list(style.element.iter(qn("w:pBdr"))):
            border.getparent().remove(border)
    normal = document.styles["Normal"]
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.15
    normal.paragraph_format.widow_control = True
    document.styles["Heading 1"].font.size = Pt(16)
    document.styles["Heading 1"].paragraph_format.keep_with_next = True
    document.styles["Heading 1"].paragraph_format.space_before = Pt(17)
    document.styles["Heading 1"].paragraph_format.space_after = Pt(7)
    document.styles["Heading 2"].font.size = Pt(11)
    document.styles["Title"].font.size = Pt(25)
    document.styles["Subtitle"].font.size = Pt(9)
    document.styles["Subtitle"].font.italic = False
    document.add_heading(proposal.title, 0)
    if proposal.subtitle:
        document.add_paragraph(proposal.subtitle)
    state = "研究草稿" if context["status"] == "draft" else "待评审提案"
    document.add_paragraph(state + " · 版本 " + (context["package_version"] or "legacy-draft")[:12], style="Subtitle")

    def link(paragraph, value, url):
        if url is None:
            paragraph.add_run(value)
            return
        anchor = OxmlElement("w:hyperlink")
        anchor.set(qn("r:id"), paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True))
        run, props = OxmlElement("w:r"), OxmlElement("w:rPr")
        color = OxmlElement("w:color")
        color.set(qn("w:val"), "246A61")
        props.append(color)
        run.append(props)
        content = OxmlElement("w:t")
        content.text = value
        run.append(content)
        anchor.append(run)
        paragraph._p.append(anchor)

    def refs(ids):
        if ids:
            paragraph = document.add_paragraph("来源：")
            paragraph.paragraph_format.space_after = Pt(5)
            for identifier in _dedupe(ids):
                link(paragraph, _reference_label(identifier, context) + " ", _citation_target(context["evidence"][identifier]))

    def claim(item, keep_with_next=False):
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.keep_together = True
        paragraph.paragraph_format.keep_with_next = keep_with_next
        paragraph.add_run("【" + _item_label(item, context) + "】 ").bold = True
        paragraph.add_run(item.text)

    def table(item):
        widths = _column_widths(item, context, 6.71)
        native = document.add_table(rows=1, cols=len(widths))
        native.autofit = False
        native.style = "Light Shading Accent 1"
        values = [item.columns + ["论据 / 依据"], *_row_values(item, context)]
        for column, width in zip(native.columns, widths):
            column.width = Inches(width)
        for ri, row in enumerate(values):
            cells = native.rows[0].cells if ri == 0 else native.add_row().cells
            for cell, width, value in zip(cells, widths, row):
                cell.width = Inches(width)
                cell.text = value
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.space_after = Pt(3)
                    paragraph.paragraph_format.keep_together = True
                    paragraph.paragraph_format.keep_with_next = ri < len(values) - 1
                    for run in paragraph.runs:
                        run.font.size = Pt(9.5)
            cant = OxmlElement("w:cantSplit")
            native.rows[ri]._tr.get_or_add_trPr().append(cant)
        native.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))

    if proposal.contract_version == 1 and proposal.sections:
        for item in proposal.sections:
            document.add_heading(item.title, 1)
            for paragraph in item.body.split("\n"):
                if paragraph.strip():
                    document.add_paragraph(paragraph.strip())
            refs(item.evidence_ids)
    else:
        for item in proposal.slides:
            document.add_heading(item.title, 1)
            for entry in item.claims:
                claim(entry, keep_with_next=bool(item.table or item.steps))
            for point in item.points:
                document.add_paragraph(point, style="List Bullet")
            if item.table:
                table(item.table)
            for index, step in enumerate(item.steps):
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.keep_together = True
                paragraph.paragraph_format.keep_with_next = index < len(item.steps) - 1
                paragraph.add_run(f"{index + 1}. {step.title} ").bold = True
                paragraph.add_run("【" + _item_label(step, context) + "】\n" + step.detail)
            refs(_slide_ids(item))
    if context["bases"]:
        document.add_heading("假设依据", 1)
        for basis in context["bases"]:
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.paragraph_format.line_spacing = 1.08
            paragraph.add_run(basis["id"] + "  ").bold = True
            paragraph.add_run(basis["text"])
    if context["caveats"]:
        document.add_heading("研究边界与完整限制", 1)
        for index, caveat in enumerate(context["caveats"], 1):
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.paragraph_format.line_spacing = 1.08
            paragraph.add_run(f"C{index}  ").bold = True
            paragraph.add_run(caveat)
    if context["references"]:
        document.add_heading("来源与证据版本", 1)
        for index, identifier in enumerate(context["references"]):
            row = context["evidence"][identifier]
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.keep_with_next = len(context["references"]) <= 5 or index == len(context["references"]) - 1
            paragraph.paragraph_format.space_after = Pt(6)
            link(paragraph, _reference_label(identifier, context) + " " + _source_title(identifier, context), _citation_target(row))
            # Title is the clickable URL; attachment identities stay plain text.
            paragraph.add_run("\n" + _origin_label(row) + " · " + _source_time(row))
            if _is_user_material(row):
                paragraph.add_run("\n" + row["url"])
            for run in paragraph.runs:
                run.font.size = Pt(8.5)
    paragraph = document.add_paragraph("完整研究版本：" + (context["package_version"] or "legacy-draft"))
    paragraph.paragraph_format.space_before = Pt(8)
    for run in paragraph.runs:
        run.font.size = Pt(8)
    document.core_properties.title = proposal.title
    document.core_properties.subject = "Chugao semantic proposal v2; " + (context["package_version"] or "legacy draft")
    document.core_properties.identifier = context["package_version"] or "legacy-draft"
    document.save(path)
    if not Document(path).paragraphs:
        raise ValueError("DOCX contains no content")


def _html(proposal, context, path):
    esc = html.escape
    def references(ids):
        return " ".join(f'<a href="#evidence-{context["numbers"][identifier]}">{esc(_reference_label(identifier, context))}</a>' for identifier in _dedupe(ids))
    def label(item):
        basis = _basis_label(item, context)
        basis_link = f' · <a href="#basis-{context["basis_numbers"][item.assumption_basis]}">{esc(basis)}</a>' if basis else ""
        return esc(_status_label(item, context)) + " " + references(item.evidence_ids) + basis_link
    def claim(item):
        return f'<div class="claim"><p class="state">{label(item)}</p><p>{esc(item.text)}</p></div>'
    def table(item):
        head = "".join('<th scope="col">' + esc(value) + "</th>" for value in item.columns + ["论据 / 依据"])
        rows = "".join("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in row.cells) + '<td class="state">' + label(row) + "</td></tr>" for row in item.rows)
        return '<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的比较表"><table><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
    sections = []
    if proposal.contract_version == 1 and proposal.sections:
        for index, item in enumerate(proposal.sections):
            sections.append((item.title, f'<section id="section-{index}"><h2>{esc(item.title)}</h2><p>{esc(item.body)}</p><p>{references(item.evidence_ids)}</p></section>'))
    else:
        for index, item in enumerate(proposal.slides):
            body = "".join(claim(entry) for entry in item.claims)
            body += "".join("<p>" + esc(value) + "</p>" for value in item.points)
            body += table(item.table) if item.table else ""
            if item.steps:
                body += '<ol class="process">' + "".join(f'<li><h3>{esc(step.title)}</h3><p class="state">{label(step)}</p><p>{esc(step.detail)}</p></li>' for step in item.steps) + "</ol>"
            sections.append((item.title, f'<section id="section-{index}" class="layout-{item.layout}"><p class="section-index">{index + 1:02d}</p><h2>{esc(item.title)}</h2>{body}<p class="citations">{references(item.evidence_ids)}</p></section>'))
    bases = "".join(f'<div class="appendix-entry" id="basis-{index}"><h3>{esc(basis["id"])}</h3><p>{esc(basis["text"])}</p></div>' for index, basis in enumerate(context["bases"], 1))
    caveats = "".join(f'<li><span class="entry-id">C{index}</span>{esc(value)}</li>' for index, value in enumerate(context["caveats"], 1))
    sources = []
    for identifier in context["references"]:
        record = context["evidence"][identifier]
        target = _citation_target(record)
        title = esc(_reference_label(identifier, context) + " " + _source_title(identifier, context))
        title = f'<a href="{esc(target, quote=True)}" target="_blank" rel="noopener noreferrer">{title}</a>' if target else title
        sources.append(f'<li id="evidence-{context["numbers"][identifier]}">{title}<br><span>{esc(record["url"])}</span><br><span>证据 ID：{esc(identifier)} / {esc(_source_time(record))}</span></li>')
    state = "研究草稿" if context["status"] == "draft" else "待评审提案"
    version = esc(context["package_version"] or "legacy-draft")
    nav = "".join(f'<a href="#section-{index}">{esc(title)}</a>' for index, (title, _) in enumerate(sections))
    page = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(proposal.title)}</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f4f7f5;color:#172f33;font:16px/1.8 system-ui,sans-serif}}header,main,footer{{max-width:1080px;margin:auto;padding:34px 36px}}header{{padding-top:64px}}h1{{font-size:42px;letter-spacing:-.035em;line-height:1.35;margin:14px 0 20px}}h2{{font-size:28px;line-height:1.45;margin:0 0 25px}}h3{{font-size:17px;margin:0}}p,li,a{{overflow-wrap:anywhere}}p{{white-space:pre-wrap;margin:8px 0 16px}}a{{color:#246a61;text-underline-offset:4px}}nav{{display:flex;gap:8px 24px;flex-wrap:wrap;margin-top:30px;font-size:13px}}section{{background:#fff;padding:36px 40px;margin-bottom:28px;scroll-margin-top:20px}}.state,.section-index,.entry-id{{font-size:12px;font-weight:650;color:#84591f}}.section-index{{color:#246a61;letter-spacing:.15em;margin:0 0 12px}}.version,.citations{{font-size:12px;color:#526869}}.claim{{margin-bottom:26px}}.claim>p:last-child{{font-size:18px}}.table-scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;min-width:650px;font-size:15px}}th,td{{padding:16px 12px;border-bottom:1px solid #d7e1df;text-align:left;vertical-align:top}}th{{background:#246a61;color:#fff;font-size:13px}}tbody tr:nth-child(odd){{background:#f2f6f4}}td.state{{width:145px}}.process{{padding-left:24px}}.process li{{padding:10px 0 17px 16px}}.appendix-entry{{break-inside:avoid;margin:20px 0}}.appendix-entry:target{{outline:2px solid #246a61;outline-offset:8px}}.caveats{{list-style:none;padding:0;font-size:14px}}.caveats li{{margin:16px 0}}.entry-id{{display:inline-block;min-width:36px;color:#526869}}footer{{font-size:12px}}footer li{{margin:18px 0}}@media(max-width:600px){{header,main,footer{{padding:24px 16px}}section{{padding:24px 20px}}h1{{font-size:30px}}h2{{font-size:24px}}.claim>p:last-child{{font-size:16px}}}}@media print{{body{{background:white}}header,main,footer{{padding:12px}}section{{padding:16px 0}}nav{{display:none}}.claim,.process li,.appendix-entry{{break-inside:avoid}}.table-scroll{{overflow:visible}}table{{min-width:0}}}}
</style></head><body><header><p class="state">{state}</p><h1>{esc(proposal.title)}</h1><p>{esc(proposal.subtitle)}</p><p class="version">研究版本：{version[:12]}</p><nav aria-label="提案章节">{nav}</nav></header><main>{''.join(section for _, section in sections)}{('<section><h2>假设依据</h2>' + bases + '</section>') if bases else ''}{('<section><h2>研究边界与完整限制</h2><ul class="caveats">' + caveats + '</ul></section>') if caveats else ''}</main><footer>{('<h2>来源与证据版本</h2><ol>' + ''.join(sources) + '</ol>') if sources else ''}<p class="version">完整研究版本：{version}</p></footer></body></html>'''
    Path(path).write_text(page, encoding="utf-8")


def _sync_directory(path: Path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _verify_bundle(target: Path, manifest: dict):
    root = target.resolve()
    for entry in manifest["files"]:
        candidate = root / entry["path"]
        relative = candidate.relative_to(root)
        if any((root.joinpath(*relative.parts[:i + 1])).is_symlink() for i in range(len(relative.parts))):
            raise ValueError("Bundle contains a symlink")
        if not candidate.is_file() or candidate.resolve().parent.parent != root:
            raise ValueError("Bundle path is not an immutable direct child")
        data = candidate.read_bytes()
        if len(data) != entry["bytes"] or _digest(data) != entry["sha256"]:
            raise ValueError("An existing immutable bundle has changed")


def export_proposal(proposal: ProposalDocument) -> dict:
    proposal = ProposalDocument.model_validate(proposal)
    source_path = Path(os.environ["CHUGAO_PROPOSAL_INPUT"])
    source = json.loads(source_path.read_text(encoding="utf-8"))
    context = _validate(proposal, source)
    target = Path(os.environ["CHUGAO_PROPOSAL_OUTPUTS"])
    if target.is_symlink():
        raise ValueError("Output root must not be a symlink")
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    digest_input = {"exporter_version": EXPORTER_VERSION, "proposal": proposal.model_dump(),
                    "context": {key: value for key, value in context.items() if key != "evidence"},
                    "evidence": [context["evidence"][identifier] for identifier in context["references"]]}
    export_hash = _digest(_json(digest_input).encode("utf-8"))
    bundle_name = "proposal-" + export_hash[:20]
    bundle = target / bundle_name
    if bundle.is_symlink():
        raise ValueError("Bundle path must not be a symlink")
    manifest = {"schema_version": 2, "exporter_version": EXPORTER_VERSION, "package_version": context["package_version"],
                "export_hash": export_hash, "bundle": bundle_name, "status": context["status"], "files": [],
                "evidence_ids": context["references"], "warnings": context["warnings"]}
    # Expensive generation happens before the current bundle pointer changes.
    with tempfile.TemporaryDirectory(prefix=".proposal-stage-", dir=target) as temporary:
        staging = Path(temporary)
        for fmt in context["formats"]:
            filename = "index.html" if fmt == "html" else "proposal." + fmt
            path = staging / filename
            {"pptx": _pptx, "docx": _docx, "html": _html}[fmt](proposal, context, path)
            data = path.read_bytes()
            if not data:
                raise ValueError("A generated artifact is empty")
            manifest["files"].append({"path": bundle_name + "/" + filename, "sha256": _digest(data), "bytes": len(data), "format": fmt})
        (staging / "bundle-manifest.json").write_text(_json(manifest), encoding="utf-8")
        for artifact in staging.iterdir():
            with artifact.open("rb") as stream:
                os.fsync(stream.fileno())
        _sync_directory(staging)
        if not bundle.exists():
            # Atomic rename: readers see the whole directory or no directory.
            # Concurrent identical requests may race here. The loser verifies
            # and reuses the first complete bundle instead of republishing it.
            try:
                os.rename(staging, bundle)
                _sync_directory(target)
            except OSError as exc:
                if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                    raise
        # Office containers have timestamps; use the immutable first-success manifest.
        existing_path = bundle / "bundle-manifest.json"
        if bundle.is_symlink() or existing_path.is_symlink():
            raise ValueError("Bundle manifest must not be a symlink")
        existing = json.loads(existing_path.read_text(encoding="utf-8"))
        keys = ("schema_version", "exporter_version", "package_version", "export_hash", "bundle", "status", "evidence_ids", "warnings")
        if any(existing.get(key) != manifest[key] for key in keys):
            raise ValueError("Existing bundle metadata does not match this export")
        if {(row.get("path"), row.get("format")) for row in existing.get("files", [])} != {(row["path"], row["format"]) for row in manifest["files"]}:
            raise ValueError("Existing bundle file set does not match this export")
        _verify_bundle(target, existing)
        manifest = existing
        fd, pointer_path = tempfile.mkstemp(prefix=".proposal-manifest-", suffix=".json", dir=target)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(_json(manifest))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pointer_path, target / "proposal-manifest.json")
            _sync_directory(target)
        finally:
            Path(pointer_path).unlink(missing_ok=True)
    return {"files": [entry["path"] for entry in manifest["files"]], "manifest": "proposal-manifest.json", **{key: manifest[key] for key in ("schema_version", "package_version", "export_hash", "status", "evidence_ids", "warnings")}, "formats": context["formats"]}
