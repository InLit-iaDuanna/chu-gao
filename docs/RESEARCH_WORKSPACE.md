# Self-Hosted Research Workspace

## Quality V2 adaptation candidate

This copy includes the `design-evidence-v2` changes described in
[`../CODEX_ADAPTATION.md`](../CODEX_ADAPTATION.md). The attached case is the
baseline; this version has not been deployed or accepted against the real model
provider. Use the new validation record for this copy, rather than treating any
historical baseline acceptance as proof that V2 has completed live research.

Local implementation, 2026-10-18. Production is unchanged. Research is restricted
to administrators at both the page and every API. Research does not reserve,
deduct, or refund credits. Existing chat and image billing are independent.

## Start

Keep the local Next server on port 3000 and PostgreSQL running. Apply additive
migrations with `pnpm db:deploy`, then `pnpm db:generate`.

```sh
pnpm research:up
pnpm research:status
```

Open `/app/research` or `/admin/research`. `research:up` builds the pinned engines
sequentially, starts their independent Compose project and detaches the research
worker. Worker logs and PID are in `.data/research/`. `pnpm research:stop` stops
only this stack and retains all volumes. Existing PostgreSQL/Redis volumes are
not mounted or replaced by the research Compose project.

## Services

Loopback ports 18080-18085 expose SearxNG, Crawl4AI, local E5 embeddings,
GPT Researcher, Vane and DeerFlow respectively. Engines use an internal Docker
network; only the narrow internal gateway reaches the local Next API. Crawling
and public search have outbound network access. Embedding weights are downloaded
at build time and used offline. Models, sources and build dependencies are local;
only model inference uses the existing Sol credential. No Jina/Tavily/Brave key
is configured. Proxy environment variables are cleared for this stack.

Vane source is pinned to `348feca3e378fb4157b217724ed508dc707f853f`, and DeerFlow
to `cd0166ae76f8a05d2ef13ce665ec89b37584217f`. The Vane integration patch binds
search/scrape calls to the current attempt and routes them through budgeted tools.
DeerFlow runs inside its own container without the host Docker socket or host
workspace mounts. V2 exposes file reading and the validated proposal exporter;
host bash and generic shell/write tools are disabled for this embedded flow. Original
framework licenses remain in their source installations.

## Durable Execution

`ResearchTask` is the PostgreSQL outbox. A transaction-scoped advisory lock allows
one running task. Stage attempts retain remote run IDs, cursor, partial text and
terminal errors. Task event sequence numbers are allocated with the task row lock.
SSE replays by sequence; browser disconnect does not cancel. A stale lease marks
the task interrupted instead of automatically submitting a new engine run.
Framework stdout is redirected to private diagnostics; only structured events
use the progress pipe. Events are read in bounded chunks rather than line-reader
limits. A collector failure terminates its child and records a terminal state,
retaining prior events instead of leaving a finished process marked running.

Retry creates an attempt for one unfinished stage, retaining completed stages,
evidence and task counters. Ordinary retries retain the original deadline. An
administrator can explicitly continue a stopped task with a new time window,
bounded by the plan's existing minutes; this is recorded on the retry event and
does not reset or increase model/search/crawl limits. The UI discloses the time
window and remaining model calls before this action. Captured pages are reused
when the research engine encounters their URLs again. Creating
a new task from a completed report references the original research version and
only runs the requested production stage. Each artifact stores its brief version,
basis task and exact evidence IDs.

Model requests may retry twice for transient failures before any nonblank text
or tool call has been published. Each actual request is reserved and counted;
rejection, cancellation and exhausted task budgets are not bypassed. Incomplete
output diagnostics and reported usage are retained, and an output-limit retry
may increase the per-call output cap up to 16000. Whitespace-only responses are
not presented as results. Verification saves its questions and finished searches
as a checkpoint; continuing it reuses this state and leaves completed research
untouched. Inline base64 file payloads are excluded from text model context,
while original evidence files remain unchanged.

Gateway tokens are scoped to a running stage attempt and signed by a generated,
encrypted local secret. Engines never receive the real Sol key. Before each model
or tool call, the gateway checks the active attempt, task budget and deadline.
Cancellation fences later calls and aborts in-flight forwarding. Usage omitted by
the provider remains unknown. Optional configured USD rates produce estimates,
not an assertion about the upstream invoice or a user charge.

V2 removes GPT Researcher's outer completion-helper retry loop and configures
DeerFlow's separate LLM error middleware for one attempt. This does not remove
the explicitly counted retry policy in Chugao's gateway. A returned SDK setting
alone is not evidence that a compatibility provider honored it.

Per-task stage ceilings reserve budget for verification, synthesis and proposal
creation. Cross-task LLM/crawl admission uses a transaction advisory capacity
lock before the task row lock, with ReadCommitted recounts. This limits recorded
running calls; a cancelled external request can still take time to stop.

## Conversational Intake

The research entry is an agent-led conversation, not a questionnaire. Start with
an idea; the agent asks at most one high-value question per reply, carries forward
facts already supplied and can propose explicitly unconfirmed assumptions. The
assembled brief is read-only in the expandable summary. Scope, products, model
and effort remain independent settings in a collapsed panel. New local drafts
default to medium effort.

`GET/POST /api/research/intake` uses the same administrator checks, ownership,
idempotency, durable queue and cancellation fencing as research. Each answer is
one internal `intake` task with a one-model-call/four-minute cap, with no search or
web crawling. Up to 40 turns may be retained in one project. Failed turns keep
the submitted answer. Refresh restores the transcript, latest structured brief
and settings without sending another model request. Intake usage is recorded,
not billed, and internal turns are omitted from the research-version picker.

The agent's ready state only reveals a proposed plan. Research is submitted
separately after the user explicitly confirms it; finishing an intake reply does
not trigger research. The normal 12/30/60 model-call limits apply to that research
task, separately from already recorded clarification turns.

## Proposal Export

V2 production requires the completed synthesis stage's immutable
`finalResearchPackage` with its version hash. Earlier drafts are not concatenated
back into this input. Old records without a V2 package remain readable; new
production is blocked with `FINAL_PACKAGE_REQUIRED`. The existing retry endpoint
only handles unfinished stages; it cannot re-run completed legacy synthesis.
Reusing an old report requires a separately implemented, explicit new synthesis
task or migration tool that preserves the original. That upgrade endpoint is not
part of this candidate. The package retains literal user requirements, final hypotheses, caveats, the actual
source excerpts, and the complete source inclusion manifest.

DeerFlow can use `chugao_create_proposal` to turn its evidence-based outline into
editable native PPTX/DOCX and self-contained HTML. The local exporter uses
python-pptx/python-docx; model-generated scripts remain unnecessary for normal
exports. Output paths and formats are server-controlled. Source IDs are checked
against the supplied research version, and the exporter stages files before
publishing them. Successful results are opened again with their native libraries.

The shared V2 slide schema creates editable comparisons and process shapes in
PPTX, tables in DOCX, and scriptless HTML. All formats preserve source identifiers,
claim status and caveats. File hashes, formats, package version and actual cited
IDs are validated again by the application; all requested proposal files are
published in one database transaction. A lost COMMIT acknowledgement causes a
locked reference check, never unconditional deletion of potentially published
bytes. Unknown results retain files for later reconciliation.

A production-only task consumes the chosen report and evidence version directly.
It does not recapture the original links or recreate their evidence IDs. Failed
remote runs retain diagnostics for the configured retention period; successful
payloads are released only after their files and results are imported.

## Data And Files

Research data uses additive `Research*` tables and private `research/` storage.
Uploaded references are copied into research-owned snapshots. Original images
are not automatically analyzed. Evidence retains source URL, time, original text,
content hash, screenshot state and stable citation ID. Partial retrieval failures
are visible. Same-content copies do not establish independent corroboration.

Office outputs are checked for their native editable document structure. Research
HTML preview removes scripts and event attributes, uses an iframe sandbox with
no additional permissions, and injects a restrictive CSP (`script-src 'none'`,
`connect-src 'none'`). DOM sanitization and these policy attributes have component
tests; actual browser network, navigation and interaction enforcement remains
unverified in this environment. The ordinary chat HTML preview is unchanged. Downloaded files
remain private. New research files default to 30-day retention; active tasks and
research versions used by active tasks protect referenced material.

Candidate relevance and context selection are deterministic heuristics. The
quality label is an automatic material gate, not fact verification. A captured
body, a search excerpt, a missing file, an omitted context excerpt and an empty
page have different states. User-provided extracted text stays identified as
user material; an image-only attachment is not converted into purported visual
evidence. Fetch time is labelled as fetch time, never as publication time.

## Acceptance Boundary

Service readiness, framework import/assembly, protocol conversion, task recovery,
export structure and actual upstream capability are separate checks. A healthy
service is not evidence of completed LLM research. Real provider probes must use
synthetic examples and stay within the remaining user-authorized request budget.
An unavailable engine is reported as unavailable; no fixture output is returned
as a completed research task.

The baseline documentation recorded earlier Vane and combined research runs.
Those historical results are not V2 acceptance. This candidate's local checks,
the complete command outcomes, the offline case replay, the editable export
fixtures and the remaining live/Docker/browser gaps are recorded in
`CODEX_ADAPTATION.md` and `validation/VALIDATION.md`. No new paid model research
run is claimed for this version.
