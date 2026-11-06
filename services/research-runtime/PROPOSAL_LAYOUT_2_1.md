# Exporter 2.1.0 implementation and acceptance

The content contract remains v2. This revision repairs the local exporter and its writing instructions. It does not add a research engine, call a model, perform a new market study, or introduce a trusted image pipeline.

## What changed

| Confirmed failure or weakness | Minimal repair | Preserved invariant |
| --- | --- | --- |
| The first supplied tool input was rejected when a four-claim overview reserved too little space for its long hypothesis basis | Measure the declared font, paginate complete claims, and print shared exact bases once using B references | Original text, status, evidence IDs, retained hypothesis IDs and basis are unchanged |
| The second supplied input could not fit five process steps with the same long basis repeated below each step | Keep each step's original hypothesis state, print its B reference, and move the full common basis to the visible appendix | Five original steps still refer to the original retained hypothesis |
| A long lead could consume the space a dense table row needed | Put the lead on a separate page when needed; otherwise show it once before the first group | Do not repeat or rewrite the lead on each continuation page |
| Appendices repeated long material and could strand final sources in one column | One ordered stream for distinct full caveats, bases and sources, with column balancing across already required pages | No paraphrase or truncation of the audit text |
| Word headings and leads could become detached from their small table or short process | Chain heading/lead/table rows or steps with `keep_with_next`, keep each row or paragraph together, and repeat table headers if a table spans pages | Keep native tables and the original complete content |
| A full 64-character source version occupied the opening title block | Show its short prefix near the title and keep the full version at the end and in document metadata | Full immutable source version remains available |

The main functions are `_measurement_font`, `_wrapped_lines`, `_chunks`, `_section_pages`, `_appendix_columns`, `_pptx`, `_docx` and `_html` in `proposal_export.py`. Fontconfig's face index is retained when opening a TTC collection, so a packaged CJK font does not accidentally measure the collection's first language face. The explicit `CHUGAO_PROPOSAL_FONT_FILE` option is intended for a deployed Noto Sans CJK SC font, not model-provided asset paths.

PPTX stays editable: text, tables and numbered process objects are native Office elements. Main claim text stays at 20 pt and content table cells at 16 pt. Titles, provenance labels and appendix text have separate fixed styles. Font-backed measurement reserves wrapping space; it does not use shrink-to-fit. If an indivisible item still exceeds its physical bounds, the tool reports a renderer contract error. The updated proposal skill prohibits changing a research statement's status or provenance to get around that error.

Every content slide's notes contain `CHUGAO_CONTENT_V2` followed by the exact normalized source section. Appendix notes contain `CHUGAO_APPENDIX_V2`, full bases, caveats, references and the source version. Visible B references deduplicate presentation, while the complete original semantic model remains auditable. All distinct caveats remain visible in PPTX, DOCX and HTML.

## Replays and honest scope

The following files are test fixtures copied from the supplied case, rather than a regenerated model response:

- `tests/fixtures/office_lunch_actual_tool_inputs.json`: all three original proposal tool inputs.
- `tests/fixtures/office_lunch_actual_package.json`: their original frozen research package.
- `tests/fixtures/office_lunch_curated_proposal.json`: a separately labelled reviewer-authored reorganization using the same frozen evidence. Its design actions remain recommendations and its retained hypothesis keeps the original text and basis. No interviews, product tests, new source capture or paid model run occurred.

The curated example changes the communication task: candidate lunch routes are compared by the conditions that would change the choice, portion representations are tied to observable selection tasks, and proposed features are connected to validation decisions. Its observed product data remain bounded by the frozen page extracts. It does not claim that product prices prove willingness to pay, that page specifications prove an experience advantage, or that an isolated three-minute observation is complete meal preparation time.

The local CJK rendering results for this release are:

| Input | PPTX pages | DOCX pages | Semantic scope |
| --- | ---: | ---: | --- |
| Original tool input 1 | 10 | 4 | Original input unchanged |
| Original tool input 2 | 10 | 4 | Original input unchanged |
| Original tool input 3 | 9 | 4 | Original input unchanged |
| Reviewer-authored example | 8 | 4 | Explicitly labelled reorganization of the same evidence |

The supplied completed artifact for original input 3 had 12 PPT pages and 5 Word pages. Its new export keeps all seven original content sections. Reducing its PPT appendix to two pages is a presentation change, not removal of its qualifications. Word keeps a complete reference section together, which can still need its own page; the renderer does not reduce body type or discard source metadata to achieve a target page count.

PPTX was rendered through local LibreOffice, and DOCX through the document skill's `render_docx.py`, using task-specific Noto Sans CJK SC Regular/Bold. These are actual PDF/PNG renders, not XML-only predictions. The public source and integrity information for the fonts is given below. Microsoft PowerPoint/Word themselves were not opened; other renderers and font versions can reflow content differently.

## Reproduce from the project root

Use the runtime's existing pydantic, python-pptx, python-docx, Pillow and lxml dependencies. The rendering helper also needs local LibreOffice and PyMuPDF; the document skill renderer additionally uses Poppler. No model key is needed for any command below.

```bash
python -m unittest discover -s services/research-runtime/tests -p test_proposal_export.py -v
python services/research-runtime/tests/export_office_lunch_case.py --output artifacts/office-lunch-replay
python validation/render-office-case.py --case-root artifacts/office-lunch-replay --output artifacts/office-lunch-qa
```

Use a fresh export directory when comparing unreleased renderer edits. Publication intentionally reuses a complete immutable bundle for a released exporter version and identical semantic input. Do not alter an existing selected bundle to make a screenshot or a regression test pass.

`render-office-case.py` validates selected source hashes before rendering and never changes Office files. It uses the installed document skill renderer for DOCX when available; `--docx-renderer` can point to another installed copy. In environments without that skill, it uses local LibreOffice directly. The current packaged runtime needed its Poppler library directory on the rendering process's `LD_LIBRARY_PATH`; this was an environment correction and did not change global fonts, OS configuration or document content.

For a deployed task font, set `CHUGAO_PROPOSAL_FONT_FILE` to the Regular font and `FONTCONFIG_FILE` to a task-specific fontconfig that exposes both Regular and Bold. A system installation of Noto CJK can instead be resolved by Fontconfig. Font fallback is conservative estimation, not a claim that a missing font renders identically.

The cross-language gate uses the actual TS package builder, LangChain proposal tool entry point, Python sidecar reader and TS artifact validation:

```bash
node --import tsx validation/cross-language-proposal.mjs
```

It passed 20 checks with exporter **2.1.0**. It contains no hardcoded downgrade to 2.0.3. The exporter suite passed **44 tests**, including original semantic replay, dense table pagination, long leads, shared process basis, Word grouping, TTC face selection, source boundaries and atomic/idempotent publication. The corresponding logs and JSON records are in the delivered validation package. These are local and offline checks, not end-to-end production or model-quality acceptance.

For real exported HTML checks with an installed Chromium browser:

```bash
CHUGAO_QA_CHROMIUM=/path/to/chrome node validation/check-office-case-html.cjs artifacts/office-lunch-replay artifacts/office-html-qa
```

The harness checks every replay against its semantic title and table count, desktop/mobile overflow, local scrolling, anchors, selection, CSP script blocking and page HTTP requests. Its `checks.json` is written only when all cases pass. The current actual run passed all four cases in Chromium 155.0.8059.84 at 1440 px and 390 px viewport widths, with zero outbound page HTTP requests. The browser needed a repaired local installation after its initial executable failed before page load; no HTML assertion was represented as passing from that failed launch. Screenshots are local QA, not evidence that the signed-in application UI or its iframe integration passed.

The portable small records `validation/office-export-v3-result.json`,
`validation/office-html-v3-result.json` and
`validation/cross-language-proposal-v3-result.json` accompany the source handoff.
All 37 final PPT pages and 16 final Word pages were inspected from actual rendered
PNGs. No clipping, overlapping body text, detached small-table header or isolated
single last citation was observed in these cases. Dense and sparse pages still
reflect the supplied content; the generic renderer does not invent product
photos, user findings or quantitative charts to decorate missing evidence.

## Official implementation references

- [python-pptx text API](https://python-pptx.readthedocs.io/en/latest/api/text.html) and [implementation of text objects](https://python-pptx.readthedocs.io/en/latest/_modules/pptx/text/text.html): native text frames, explicit sizing, and the behavior of `fit_text`. This exporter chooses pagination rather than uniform automatic font reduction.
- [python-docx text and pagination documentation](https://python-docx.readthedocs.io/en/latest/user/text.html): `keep_together`, `keep_with_next`, widow control and paragraph spacing.
- [Pillow ImageFont](https://pillow.readthedocs.io/en/stable/reference/ImageFont.html): measured advance widths using `getlength` and collection selection using the `index` argument to `truetype`.
- [Noto CJK official SC font assets](https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/SimplifiedChinese) and [SIL Open Font License](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE).

The exact downloaded Regular OTF had SHA-256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`; Bold had `b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a`. The fonts were downloaded for this authorized local QA and exposed through a task-specific fontconfig. They are not new visual market evidence.
