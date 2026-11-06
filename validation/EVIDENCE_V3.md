# Evidence selection and packing: offline validation

This change keeps the candidate archive and existing V2 reader contract. It adds an explicit decision role to formal source selection and preserves complete source passages before synthesis. It does not certify source facts or replace a semantic review.

## Recorded results

- `evidence-v3-tests.log`: the actual TypeScript quality test file completed with **30 / 30 tests passing**. This includes the existing tests, the recorded 105-candidate / 10-body case, alternative product categories, Unicode, hard serialized budgets, changed-content routing invalidation, and incidental mentions in a review of a differently titled device.
- `evidence-v3-replay.json`: **8 / 8 offline assertions passed** using the exact retained public case texts. The unreviewed candidate context used 25,603 serialized JavaScript characters against the existing 32,000-character application limit.
- `evidence-v3-replay.log`: execution summary from `node --import tsx validation/replay-evidence-v3.mjs`.
- `evidence-v3-candidates.json`: all recorded candidates with actual heuristic assessments, supplied to the separate Python selector replay. This file has no manually substituted semantic routes.

The formal routes in this replay are an explicitly authored, manually reviewed fixture. They test the contract and are not evidence that a fresh model successfully classified these sources. No model, search, crawl, production database, or paid request was used for this validation.

## Integration contract

`SearchCandidate.content` is the retained body, when available. A search excerpt must remain `excerpt`; it must not be relabeled as a retained body.

`quality.routing`, packed source `routing`, and manifest `assessment.routing` contain:

```ts
{
  method: "heuristic" | "model_review";
  role: "product_identity" | "task_observation" | "constraint" |
        "alternative" | "background" | "design_reference" |
        "irrelevant" | "pending";
  decisionIds: string[];
  reason: string;
}
```

`EvidenceDecisionRoute` uses `evidenceId`, optional `contentHash`, one of the seven non-pending roles, `decisionIds`, and a reason. `validateEvidenceDecisionRoutes` can restrict both source and question identifiers to the current review. Direct roles require a question identifier. `packEvidenceContext` and `assessResearchQuality` accept `decisionRoutes` and `requireDecisionRoutes`.

With `requireDecisionRoutes: true`, an external source that lacks a current reviewed route is omitted with `pending_decision_route`. A changed hash returns the source to pending review. User-supplied material remains visible as unreviewed material rather than silently disappearing. Background and visual-reference roles do not count toward the direct material gate. Neither roles nor the legacy word-match score assert authority, source independence, or factual support.

## Text and citation coordinates

- `contentHash` is passed through from the retained source. Packing does not redefine the source identity.
- `contentRanges[].start` / `.end` are JavaScript UTF-16 offsets into `researchSourceText(retainedBody)`, with an exclusive end.
- Packed `content` consists of original source slices separated by explicit omission markers. Its offsets are not the original body's offsets.
- Search-normalized text is used only to select passages. It is never emitted as an exact quotation.
- Operational steps, nearby qualifications, numerical conclusions, and short sample / sponsorship disclosures travel together when the budget permits.
- Tables are retained as whole blocks so that a number is not separated from its heading or unit. A table larger than the per-source budget is omitted; the source manifest still reports truncation. Further table-aware subdivision is not claimed in this change.

The recorded Joyoung review now retains the three timed steps and the author's approximate nine-minute total, together with the platform-supplied-product disclosure. That is one invited sample review. It is not a measured office-user study or evidence of general user demand. The official and retail MR9086 pages remain two channels for one SKU, not two independent competitor products.

## Boundaries

The deterministic filter proposes inspectable candidate roles using object and task matches. It deliberately cannot decide all cross-category relevance; a reviewed route may retain an unconventional alternative. The next semantic review must explain each source's decision role and must independently assess whether its actual passage answers the design question. A successful read is not a resolved question.
