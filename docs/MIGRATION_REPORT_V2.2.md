# v2.2.0 migration report

## Scope

This release completes the content-development refactor in the independent
formal directory `chugao_v2.2`. It keeps the v2.1 runtime and API contracts
while moving the remaining large interactive state centers behind dedicated
React hooks.

## Changes

- Added `components/canvas/useDesignStudioState.ts` for design document
  hydration, localStorage persistence, selection, tool state, history refs,
  and transform refs.
- Added `components/studio/useStudioAppState.ts` for Studio models, generation
  history, prompt parameters, lightbox state, and stream/request refs.
- Added `components/studio/ppt/usePptStudioState.ts` for PPT shell, create-form,
  and deck-view state.
- Added `components/inspiration/usePublishComposerState.ts` for publish form,
  preload, edit, media selection, and history state.
- Kept API calls, upload/export/publish behavior, stream handling, polling,
  validation, and existing localStorage formats unchanged.
- Switched the external test resolver to `chugao_v2.2`.
- Kept dependencies, build output, generated type files, and incremental data
  under `../test`.

## Verification

Run from `chugao_v2.2`:

```text
pnpm typecheck   passed
pnpm lint        passed with zero warnings
pnpm test:ui     52 files / 203 cases passed
pnpm build       passed; 54 routes generated
```

## Limitations

- Live PostgreSQL, Redis, and provider generation were not run without the
  preserved project's environment credentials.
- Visual content changes intentionally start after this structural release.
