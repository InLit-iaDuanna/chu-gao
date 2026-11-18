# v2.1.0 migration report

## Scope

This minor release keeps the v2.0.0 modular-monolith runtime and introduces a
single Canvas state boundary in the independent formal directory
`chugao_v2.1`.

## Changes

- Added `components/canvas/useInfiniteCanvasState.ts`.
- Moved InfiniteCanvas state initialization, session/draft loading, debounced
  localStorage writes, and lifecycle flushes into the hook.
- Kept node and edge rendering, coordinate conversion, pointer interaction,
  workflow execution, and selection behavior in `InfiniteCanvas.tsx`.
- Preserved the existing 400ms trailing write and pagehide/visibilitychange
  flush behavior.
- Pointed the external Vitest configuration at `chugao_v2.1`.
- Kept generated dependencies, build output, and incremental typecheck data in
  `../test`.

## Verification

Run from `chugao_v2.1`:

```text
pnpm typecheck   passed
pnpm lint        passed
pnpm test:ui     52 files / 203 cases passed
pnpm build       passed; 54 routes generated
```

## Limitations

- This release does not change the database schema, provider protocol, or
  runtime language selection.
- Live PostgreSQL, Redis, and provider generation were not run without the
  preserved project's environment credentials.
