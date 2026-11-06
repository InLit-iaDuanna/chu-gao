# Proposal contract v2 · exporter 2.1.0

This is a controlled exporter, not another research engine. It preserves the existing GPTR/Crawl4AI/DeerFlow integration. DeerFlow supplies semantic content to the `chugao_create_proposal` tool. The tool creates native Office files and script-free HTML locally.

## Content contract

See `proposal-schema-v2.json` and the runnable, explicitly labelled offline example in `tests/fixtures/proposal_v2.json`. The example's evidence URL is a fixture under example.com; it is not a newly researched market source.

- `contract_version: 2` and `package_version` must match the supplied frozen research package.
- All formats use the same `slides` tree. V2 rejects independent `sections` and untyped `points`, which previously allowed format divergence and unreferenced claims.
- Layouts: `overview`, `evidence`, `comparison`, `tradeoffs`, `process`. Each entry is a semantic section; the renderer can emit multiple physical slides without changing the shared input tree.
- `observed` requires owned, non-rejected original text: external evidence must match `status=captured`, `contentKind=captured_text`, `sourceAvailability=captured` and non-empty content. Extracted user attachments must match `status=provided`, `contentKind=user_provided_text`, an `attachment:<id>` identity and the same available-content checks. Search excerpts cannot become observations by changing status alone. `verified` additionally requires an exact package `verifiedClaims` entry. This exporter does not itself verify a claim.
- `user_requirement` must exactly normalize to an existing confirmed user requirement.
- A hypothesis claim uses `hypothesis_id`, and its text and basis must exactly normalize to the retained hypothesis version. Table rows and steps use `hypothesis_ids`; missing or rejected IDs fail validation. Unit-bearing numbers in those fields must be present in the referenced hypothesis text. Numeric recommendations require retained hypothesis or captured source references.
- Global caveats from both the proposal and frozen package appear in all formats. The writer cannot omit package caveats by leaving a field empty.
- `review_ready` requires research quality `supported` and structured citations. Legacy v1 proposals can still be exported explicitly, but always show a draft state. Production import must retain the package version check.

IDs and numeric matches validate provenance structure, not semantic entailment or overall research completeness. Source relevance, evidence contradictions, geographic applicability, title wording and whether a conclusion follows from its sources still require research evaluation. The schema deliberately does not pretend to solve those problems.

## Bounds

Titles are limited to 72 characters per section, claim text to 120, claim hypothesis basis to 160, and each package caveat to 500. The package may supply up to 32 caveats; proposal-level caveats have a separate limit of 16 × 600 characters. The combined list reserves space for automatic quality notices and preserves every distinct entry. Tables have 2–5 content columns, 2–5 rows, and at most 52 characters per cell. A visible evidence-state column is added by the exporter. Process sections have 2–5 steps.

The renderer measures font advances, reserves wrapping space and paginates complete claims, table rows and process steps. It repeats the table heading on continuation pages, and displays a lead once; a lead that prevents a complete row or step from fitting receives its own page. It never changes a status, hypothesis, evidence link or basis to make a page fit. An indivisible item that exceeds physical capacity is still a renderer contract error, not an instruction to the model to weaken its claim.

Shared exact `assumption_basis` strings receive B references. Every item retains its evidence-state label, source references and B reference; the full basis is printed once in an appendix. Distinct caveats remain visible in full, in one appendix flow. PPT notes include `CHUGAO_CONTENT_V2` with the original normalized section and `CHUGAO_APPENDIX_V2` with full bases, caveats, references and source version. This is traceable presentation, not a research summary that discards provenance.

Word uses its own flowing layout with paragraph/row grouping for small tables and short processes. Sources are grouped to avoid a final single-source orphan. The short version appears near the title, while the full version is retained at the end and in document metadata. PPT uses 20-point main claims and 16-point table content; separate title, provenance and appendix styles have fixed sizes. No shrink-to-fit operation is used. Font measurement uses Noto Sans CJK SC through Pillow; `CHUGAO_PROPOSAL_FONT_FILE` can select a deployed copy of that font. With no matching installed font, conservative em-based estimation is a fallback, not an actual Office rendering guarantee.

PPTX has native editable text, tables and shapes. This revision does not implement image, chart or arbitrary media input: a useful visual-research pipeline must first provide vetted, task-relevant assets. It never substitutes decorative generated images for evidence.

## Publication protocol

The runtime sets `CHUGAO_PROPOSAL_INPUT` and `CHUGAO_PROPOSAL_OUTPUTS`. After generating and reopening all requested formats, the exporter publishes:

```json
{
  "schema_version": 2,
  "exporter_version": "2.1.0",
  "package_version": "<frozen research version>",
  "export_hash": "<sha256>",
  "bundle": "proposal-<20-character hash prefix>",
  "status": "draft",
  "files": [{
    "path": "proposal-<hash>/proposal.pptx",
    "sha256": "<sha256>",
    "bytes": 12345,
    "format": "pptx"
  }],
  "evidence_ids": ["source-id"],
  "warnings": []
}
```

The pointer is `proposal-manifest.json`. Each complete bundle has its own `bundle-manifest.json`. Bundle creation is an atomic directory rename; the pointer is an atomic file replacement after file and directory sync. Repeated identical calls validate and reuse the immutable first complete bundle. Concurrent same-content calls converge on it. A failure before pointer replacement leaves the previous selection intact. An unselected directory is an orphan, not a published result.

Only the paths named by the active pointer may be imported by the research runtime. Validate the frozen package version, format set, bytes and hashes; forbid symlinks and paths outside the bundle. Do not scan every old bundle with `rglob`. Use a fresh output root for each attempt and keep an attempt's importer single-owner. Raw file-write/bash tools would undermine this boundary and should not be available to the producing agent.

User attachment citations are visibly labelled as user material, not external independent evidence. Their `attachment:<id>` identity is rendered as text in every format and is never emitted as a hyperlink or local file path. Image placeholders with no extracted text cannot support observed visual claims.

Source timestamps use a shared helper in all formats: `fetchedAt` is labelled 抓取时间, legacy `capturedAt` 留档时间, and `createdAt` 记录创建时间. Missing values show 来源时间未提供. None is labelled a publication date, and the package generation time is never substituted.

The protocol covers process crashes and filesystem atomic publication on a local filesystem with supported rename/fsync semantics. It does not provide a database/file distributed transaction or prove behavior on every network filesystem. Retention must preserve the selected bundle and clean orphan bundles separately.

## Local checks

From the project root, using the research runtime's existing Python dependencies:

```bash
python -m unittest discover -s services/research-runtime/tests -p 'test_proposal_export.py' -v
python services/research-runtime/tests/export_fixture.py --output artifacts/offline-proposal-fixture
python services/research-runtime/tests/export_office_lunch_case.py --output artifacts/office-lunch-review
```

The tests create real PPTX, DOCX and HTML files. They check structured references, native tables, critical caveat retention, version locks, state promotion, an actual legacy case payload, old-price resurrection, invalid input, escaping, atomic error handling, concurrent idempotency and modified bundle detection. They also replay all three actual office-lunch tool inputs unchanged, check shared process bases and exact semantic notes, verify Word grouping, and cover a dense table with a long lead. They make no upstream calls.

The office-lunch generator provides three unchanged supplied tool inputs plus one explicitly labelled reviewer-authored reorganization of the same frozen evidence. It does not call a model, fetch new sources, interview users, or turn the original limited study into a completed market investigation. Use a new output directory while changing the renderer; immutable bundles from the same released exporter version are intentionally reused.

Optional real Chromium checks, when Playwright and its matching browser binary are installed:

```bash
node services/research-runtime/tests/check_export_html.cjs artifacts/offline-proposal-fixture artifacts/qa/proposal-html
```

The browser harness checks desktop/mobile overflow, table scrolling, source anchors, selection, CSP script blocking and page HTTP requests. A separate `validation/check-office-case-html.cjs` runs these checks against all three supplied office-lunch inputs and the labelled reviewer example. Pass an installed browser with `CHUGAO_QA_CHROMIUM` when using that harness. Browser installation or a successful `--version` command does not establish that page-level checks passed; consult the release-specific results.

For release-specific test commands, rendered page counts and limitations, see `PROPOSAL_LAYOUT_2_1.md`. Earlier 2.0.3 fixture counts and browser-install failures describe the prior revision only; they are not current release acceptance results. A structural test cannot replace rendering every page with the deployment fonts. None of these local export checks establish a full live DeerFlow run or production deployment.
