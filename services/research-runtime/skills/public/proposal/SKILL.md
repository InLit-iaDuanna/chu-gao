---
name: proposal
description: Export a design proposal from a frozen Chugao research package with structured evidence, assumptions, and editable semantic layouts.
---

# Chugao proposal contract v2

Read `proposal-data.json` first: it is an exact same-version projection of the authoritative frozen `final-research-package.json`, not a new summary. Read original excerpts from `evidence.json` before making observations. The full package and `research.md` remain available for details, but do not reread every large file when the projection already supplies the needed fields. Do not combine superseded reports, earlier price guesses, or an old intake brief into the final proposal.

The tool uses python-pptx and python-docx locally. All PPT text, comparison tables and process shapes remain editable. The same semantic content tree produces PPTX, DOCX and self-contained HTML. Do not write a generator script, scan fonts, install dependencies, call a shell or download assets. Source screenshots are not automatically acceptable design references. This version accepts no arbitrary asset paths.

## Required fields

Use `contract_version: 2`, `package_version` equal to the exact supplied research package version, `title`, `subtitle`, `status`, `slides`, and `caveats`. Use `status: "draft"` unless `finalResearchPackage.quality.status` is `supported`. Do not turn a successfully generated file into a claim that market research is complete.

V2 accepts one `slides` content tree for all formats. Do not send legacy `points` or `sections`. Those are accepted only through the legacy v1 path, which always generates a visibly marked draft.

Each entry in `slides` chooses a semantic layout; it is a content section, not a promise to fit one physical page. The exporter measures the chosen font and creates continuation pages automatically:

- `overview` or `evidence`: one to five `claims`.
- `comparison` or `tradeoffs`: a native `table`, with optional one short lead claim. Use two to five columns, two to five rows, and keep cells concise. The exporter adds a visible evidence-status column.
- `process`: two to five structured `steps`, with optional one short lead claim. Use a genuine sequential relationship.

Do not force every page into the same list. Use a comparison for alternatives, a process for usage or test sequence, and claims for conclusions. Do not invent numeric data to get a chart or fabricate product images to make the proposal look researched.

## Make the proposal useful for a design decision

Lead with the decision the current evidence can support, the decisive missing information, and the next action. Read the package's optional `decisionGaps`, `decisionRoutes`, and `decisionCards` when present; preserve their evidence state and limits. They do not authorize a new observation or a new numerical claim.

Choose comparison columns that change the decision: candidate route, conditions under which it is suitable, specific unresolved cost or constraint, and the result that would change the choice. Distinguish a webpage's stated product specification from demonstrated user benefit. Avoid turning a list of generic features into a claim that a product direction has been validated.

Connect each important gap to a concrete research task, the record it will produce, and the decision that record informs. Use a process only where sequence matters. Keep recommendations conditional when evidence is incomplete. A validation plan must specify what will be learned; merely saying “conduct interviews”, “make a prototype”, or “continue market research” is insufficient.

Use sources and retained hypotheses to justify a material statement. Do not pad a section with repeated cautions already represented in the package. Do not silently remove a material contradiction or uncertainty. This exporter contains no trusted image asset pipeline: describe missing visual evidence honestly instead of inventing a picture, implying a screenshot was reviewed, or requesting an arbitrary download.

## Claim statuses and citations

Every claim has `text`, `status`, and `evidence_ids` when it cites a source. Every table row has `cells`, `status`, and its own `evidence_ids`. Every process step has `title`, `detail`, `status`, and its own `evidence_ids`.

- `observed`: the source states this. Bind the exact supplied captured evidence ID. A search snippet, rejected candidate, link-only item or empty image placeholder does not establish an observation, even if its outer status says captured. The evidence must contain available original text with a matching contentKind. Extracted user attachments with provided/user_provided_text provenance are usable as user material; the exporter labels them 用户材料记载 and renders their attachment identity as non-clickable text, never as an external independent source.
- `verified`: only when the frozen package contains an exact `verifiedClaims` entry with this text and these evidence IDs. The writer may not promote its own claims to verified.
- `user_requirement`: copy the corresponding `finalBrief.confirmedRequirements` wording. A scenario inference, chosen geography, target price, single-person scope, or product form is not a user requirement unless confirmed there.
- `hypothesis`: use `hypothesis_id` on a claim or `hypothesis_ids` on a table row / process step, pointing to retained non-rejected `finalResearchPackage.hypotheses`. A claim's `text` AND `assumption_basis` must exactly match the retained hypothesis's `text` AND `basis`. Copy both fields verbatim; do not summarize or paraphrase the basis. Row/step bases may be concise but their retained IDs and numeric provenance must remain valid. No hypothesis becomes observed just by repeating it in a table.
- `recommendation`: proposed design or research action. Do not conceal a factual claim inside a recommendation.
- `unknown`: evidence still missing or a question unresolved.

A numeric recommendation must cite a retained hypothesis or captured evidence. Numbers with units in hypothesis rows/steps must appear in the referenced hypothesis text. This numeric check does not prove semantic entailment. Do not use a title or a recommendation to reintroduce unsupported old prices.

All evidence IDs must exist in the supplied manifest. Do not type internal IDs into prose as a substitute for structured references. The exporter maps IDs to short numeric references and clickable original URLs in every output format. This validates provenance structure, not source entailment; preserve contradictions and limits from the final package.

## Limits and consistency

Keep section titles at most 72 characters, claim text at most 120 characters, table labels at most 20 characters, and table cells at most 52 characters. Every hypothesis row/step still requires `assumption_basis`. Supply the original basis in full within the contract bound; the exporter assigns shared B references and renders the complete basis once in an appendix. Keep original evidence IDs and retained hypothesis IDs in their structured fields.

Do not change a claim, status, evidence ID, hypothesis ID or basis to satisfy layout. In particular, do not turn a hypothesis into a recommendation, weaken it to unknown, or remove it because a renderer rejects a page. Valid sections are paginated at complete claims, rows and steps; a long lead can receive a separate page without changing its wording. If an indivisible item still triggers a renderer contract error, report that exact error and input section for implementation repair. Do not retry the production tool repeatedly with semantic downgrades.

Use global `caveats` for critical limits, including missing SKU data, unverified performance goals, absent interviews and unresolved regional scope. Package caveats are automatically appended; the writer cannot remove them by omission. Full distinct caveats remain visible in all formats; exact repeated entries share one presentation. PPT speaker notes also retain the original section semantics and the full appendix audit record.

Do not provide alternate doc/HTML wording for the same research claim. The v2 shared content tree prevents differences among output formats. Do not revive a hypothesis absent from the current final package merely because an earlier draft contained it.

## Publication and completion

`chugao_create_proposal` stages all requested formats, reopens Office files, writes an immutable bundle, then atomically selects it with `proposal-manifest.json`. Use only paths returned by the successful tool result. A previous bundle, a preflight file or an orphan staging directory does not establish this attempt's completion.

HTML contains escaped data and inline styles, with no scripts, forms, frames, network calls, remote fonts or arbitrary media. Source links are limited to http(s), opened with `noopener noreferrer`. Chugao's preview must keep its own iframe isolation as a separate layer.

The final response should describe the actual delivered files, draft/review status, unresolved material gaps and retained source version. Do not stream internal session summaries or claim files exist before the exporter confirms its manifest.
