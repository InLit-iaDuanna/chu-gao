# PPT Generation

Chugao Studio includes a manual PPT image builder. A user creates a deck by
setting one fixed style prompt for the whole deck, then adding a variable prompt
per slide. Each slide is rendered through the same generation queue as normal
image generation, so credits, provider routing, refunds, and worker recovery all
share one code path.

## Product Flow

1. Open the workbench PPT builder.
2. Choose the image model.
3. Enter a deck title and an optional fixed prompt for global style, tone,
   color, layout, and brand constraints.
4. Add 1 to 30 slides. Each slide has its own variable prompt and optional
   title.
5. Generate slides individually. The server composes the fixed prompt and slide
   prompt, optionally optimizes the final image prompt through the configured AI
   integration, and enqueues a standard image generation task.
6. Export completed slides as a ZIP of ordered image files.

## API Surface

- `POST /api/ppt/generate`
  Creates a PPT generation record and slide records. This does not render all
  slides immediately.
- `GET /api/ppt/generate`
  Lists the current user's PPT records, or returns one record when `id` is
  supplied.
- `POST /api/ppt/generate-slide`
  Builds and enqueues one slide image generation job.
- `POST /api/ppt/enhance-prompt`
  Enhances prompt text through the configured prompt model.
- `GET /api/ppt/export?id=...`
  Streams a ZIP of completed slide images from private storage.

## Data Model

The current Prisma schema uses:

- `PPTGeneration`
  Stores the deck owner, optional conversation link, title, model id, fixed
  prompt, status, progress, and timestamps.
- `PPTSlide`
  Stores slide order, title, variable prompt, final enhanced prompt, associated
  generation id, status, error, seed, and timestamps.

Legacy fields such as `theme`, `style`, `slideCount`, and `seed` remain nullable
in the schema only for compatibility with older records.

## Runtime Dependencies

- Postgres for PPT and generation records.
- Redis/BullMQ for queued image generation.
- The generation worker must be running for slides to render.
- AI integration settings are managed in the admin area; environment variables
  can still provide fallback keys and endpoints.

## Operational Notes

- Export uses private storage directly and enforces `PPT_EXPORT_MAX_SLIDES` and
  `PPT_EXPORT_MAX_MB`.
- Slide generation uses `createAndEnqueueGeneration`, so user concurrency and
  daily generation limits apply.
- Failed slide jobs are marked on the slide record and follow the normal
  generation refund path when provider work fails.
