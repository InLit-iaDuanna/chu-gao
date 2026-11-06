# Research workspace: minimal reading-priority change

The workspace still uses its existing Markdown/GFM renderer, stream event handling, evidence archive, and scriptless HTML preview. This change reads persisted design decisions from the completed frozen research package; it does not generate new decisions in the browser or manufacture cards from older report text.

## Behavior

- A completed package may provide `decisionCards` and `decisionGaps`. Cards separate the material observation, design implication, suggested action, tradeoff, next test, and condition that would change the choice.
- Cards and unresolved design questions appear before the full report. `insufficient` and `conflicting` questions remain visible even when their acquisition status is `read`.
- Source controls open the existing evidence view, then focus the exact source after React commits the target. Both the card and the report citation use this path. Archived text and original URLs remain available from that source entry.
- Missing source records produce a visible unavailable-source note. A card with no remaining source record is labeled “依据待核对”; it does not get a broken navigation control.
- Older packages without optional cards keep their original report. A completed older package is authoritative; the browser does not mix in a previous review's stale cards or questions.
- Runtime counters, known/unknown cost, and the frozen version identifier are in a closed disclosure. Material-quality limits remain available in a separate disclosure; the quality verdict and actual stage activity stay visible.

## Executed checks

`research-v3-ui-tests.log` records **23 / 23 passing tests** across `presentation.test.ts` (19) and `ResearchWorkspace.test.tsx` (4), exit 0. The retained tests include real event delta/final replacement behavior, elapsed-time updates without replacing unchanged Markdown nodes or text selection, and script/network isolation in the HTML preview. New cases cover old/new packets, read-but-unanswered questions, exact source navigation, malformed cards, and missing sources.

`presentation-browser-bundle.json` records a browser-platform bundle of the actual presentation helper. The decision validator, server quality module, and `node:crypto` are absent from its runtime module graph. `DecisionCard` and `DecisionGap` are imported with `import type` only.

Focused ESLint initially stopped before inspecting source because the local pnpm layout did not expose `eslint-plugin-react-hooks` at the project root. The same installed dependencies first passed when `NODE_PATH` pointed to the existing `eslint-config-next` dependency directory (`research-v3-owned-lint-with-installed-plugins.log`, exit 0, no findings). After the project fixed its flat-config plugin resolution, ordinary ESLint passed on the nine changed evidence/UI source and test files without that workaround (`research-v3-owned-lint.log`, exit 0, no findings).

## Real browser validation

`research-ui-browser-result.json` and `research-ui-browser.log` record an actual **Chrome 155.0.8059.84** run at **1440, 768, and 390 pixels** wide, each 1000 pixels high. All three viewports passed: current cards and unresolved questions render, runtime details start closed, decision/source regions do not overflow horizontally, card links and report citations focus the exact evidence entry, original and retained-source URLs remain correct, and old packages fall back to their original report without invented cards. There were no browser page errors or unexpected network requests. Desktop, tablet, phone, and phone-source screenshots were inspected locally; the Chinese text, card boundaries, wrapping, and source focus were readable and contained.

The harness mounts the **actual `ResearchWorkspace` React component** and compiles the **original application Tailwind CSS**. HTTP API responses use the same explicit fixture as the component tests; EventSource is stubbed because this check measures reading layout and navigation, not SSE delivery. The old component snapshot in `baseline-ResearchWorkspace.tsx.txt` comes unchanged from git baseline `82afe417`; it is bundled against the same fixture and unchanged shared primitives/CSS for the recorded comparison. Both component and fixture hashes are recorded. The baseline text is never imported by production code, and the QA does not require a delivered `.git` directory.

This environment has no Chinese system font. The QA shell supplies the installed Geist font and an existing local **Noto Sans CJK SC** fallback so Chinese text can be assessed, with no web font request. It does not change product CSS or choose a new production font. Local screenshots and generated bundles are outside the deliverable source tree; their exact directory is in the result JSON.

The initial browser attempt failed before any page opened because its local installation had truncated `chrome` and `resources.pak` files. That unsuccessful launch remains in `research-ui-browser-initial-launch-failed.json` and its log. Package-entry comparison checked 255 files; two incomplete files were rewritten to their declared full lengths before the successful browser run (`research-ui-browser-install-repair.json`). A successful `--version` check alone was not treated as browser validation.

To repeat with the project dependencies and a locally available Playwright installation:

```sh
RESEARCH_QA_CHROME=/absolute/path/to/chrome \
RESEARCH_QA_CJK_FONT=/absolute/path/to/NotoSansCJKsc-Regular.otf \
node --import tsx validation/run-research-ui-browser.mjs
```

`RESEARCH_QA_OUTPUT` may select the scratch screenshot/bundle directory. `--prepare-only` builds assets and explicitly reports that browser assertions were not executed.

These are offline helper, component, browser-layout, and bundling checks. They do **not** certify the full authenticated Next.js shell or SSR, deployment, a live model-generated report, or upstream end-to-end operation. The nine-minute fixture is explicitly one invited sample, not general market evidence; the browser cards are test data rather than a newly executed research result.
