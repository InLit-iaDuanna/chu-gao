# Offline TS → Python → TS proposal contract replay

Run from the project root after installing the repository's Node dependencies and
the sidecar's Python dependencies (including Office libraries):

```bash
node --import tsx validation/cross-language-proposal.mjs
```

`CHUGAO_REPLAY_PYTHON` can select an existing Python interpreter.
`CHUGAO_REPLAY_EXTRA_PYTHONPATH` can append existing dependency folders, separated
by the platform path separator. The replay does not install dependencies, modify
an existing virtual environment, start an HTTP server, or call a model/database.

The current replay used the primary Python runtime plus read-only reuse of
the installed sidecar dependency directory supplied through
`CHUGAO_REPLAY_EXTRA_PYTHONPATH`. The
default execution sandbox initially returned `EPERM` when Node spawned Python;
the same local replay completed after execution approval. This was an environment
restriction, not a contract assertion failure.

## What actually runs

1. TypeScript `packEvidenceContext`, `assessResearchQuality`,
   `createFinalResearchPackage`, and `readFinalResearchPackage` create and validate
   a real SHA-256 content version from clearly synthetic input. The static label
   used by the earlier exporter fixture is not accepted as the version here.
2. Python calls the actual LangChain StructuredTool
   `chugao_create_proposal.invoke`, exporting real PPTX, DOCX and HTML files.
3. Production `runtime_contracts.load_proposal_bundle` validates the atomic bundle;
   production `app.get_run` lists actual copied sidecar output files.
4. TypeScript `validateRemoteProposal` validates the resulting manifest/listing.
   `validateRemoteArtifactBytes` checks the real file bytes against size and SHA-256.
5. Negative checks reject changed package contents, a mismatched package version,
   an unretained evidence ID, a missing format, and equal-length corrupted bytes.

The engine's final result envelope is assembled from its actual validated
manifest using the production wire shape. The DeerFlow graph, model planning,
`astream_events`, a network transport, and browser rendering are not exercised.
This is a contract replay, not a new market research run or a production E2E run.

## Recorded outcome

The checked-in `validation/cross-language-proposal-v3-result.json` records the
current **20 passed checks**, exporter **2.1.0**, a genuine 64-character package
version, artifact hashes, and exact
verification boundaries. Python also checks actual Office tables, source links,
attachment labels with no attachment hyperlinks, retained requirements and
hypotheses, all package caveats, and accurate fetch/missing-time labels across
all three formats.

The replay writes artifacts and raw Python output under
`output/research-v2-integration/cross-language/`. That directory contains synthetic
source rows, the TS-created `input.json`, the semantic `proposal.json`, the atomic
`exports/proposal-manifest.json`, the actual sidecar file copy and response,
`python-result.json`, and `python-replay.log`.

The current structural fixture has **6 PPT slides and 2 native tables in each
format**. This synthetic contract fixture was not separately visually rendered.
Actual supplied tool-input replays and the explicitly labelled reviewer example
have separate Office rendering and visual checks, documented in
`services/research-runtime/PROPOSAL_LAYOUT_2_1.md`. The earlier 2.0.2 / 8-slide
record describes the previous exporter and is not the outcome of this replay.

The copied result JSON is intentionally small enough to include in the source
handoff. Its `outputDirectory` is the reproducible runtime output location;
temporary generated artifacts and installed dependencies need not be included
in the source package.
