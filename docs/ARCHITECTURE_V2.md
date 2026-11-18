# Chūgǎo Studio v2 architecture

## Decision

Chūgǎo Studio v2 remains a React application on Next.js App Router with
TypeScript. The backend stays in the same deployable project for this release,
with PostgreSQL/Prisma for persistence and Redis/BullMQ for generation jobs.

This is the highest-efficiency architecture for the current codebase because
the product already has mature React screens, server-rendered routes, route
handlers, Prisma models, queue workers, storage adapters, and deployment files.
The v2 refactor improves boundaries inside that system instead of rewriting
working behavior in another language.

## Runtime shape

```text
Browser
  -> Next.js pages and React components
  -> Next.js route handlers
  -> domain entry points
  -> persistence, queue, Redis, storage, provider adapters
  -> PostgreSQL / Redis / external model providers

BullMQ worker
  -> generation and provider domains
  -> settlement and storage
```

## Source boundaries

### Transport

`app/` owns routing, request parsing, HTTP status codes, response envelopes,
server rendering, and page composition. Route handlers should orchestrate a
request and delegate business behavior through domain entry points.

### Domains

`lib/domains/` exposes the supported entry points for:

- `auth`
- `conversation`
- `generation`
- `inspiration`
- `ppt`
- `provider`

New cross-feature imports should use these entry points. Existing
implementation modules remain available while callers move incrementally.

### Infrastructure

`lib/infrastructure/` is the entry point for database, Redis, queues, request
body parsing, rate limits, storage, and infrastructure error classification.
Domain and transport code should not invent local substitutes for these
capabilities.

### Browser clients

`components/client/request.ts` owns the browser response-envelope parser and
shared request behavior. Studio, admin, inspiration, login, and registration
clients build feature-specific types and errors on top of it.

### Tests and generated output

All test sources live in `../test/suite`. Vitest resolves production imports
from this formal project while keeping test code and cache output outside the
source tree. Screenshots, browser output, historical SQL, duplicate route
snapshots, and build output also live under `../test`.

## React and Go direction

React remains the UI language. Next.js remains the page, SSR, and BFF layer.
TypeScript remains the application-service language for v2.

Go becomes useful only for a separately measurable runtime boundary. The most
credible future candidates are a high-throughput provider gateway or a worker
service whose CPU, connection, or queue profile is proven to be the limiting
factor. That service should reuse the existing database semantics and HTTP/job
types rather than trigger a full product rewrite.

## Version directories

`chugao_v2.2` is the v2.2.0 formal source directory. Feature releases use a new
sibling directory:

- minor release: `chugao_v2.3`
- patch release: `chugao_v2.2.1`

The active directory and version history are recorded in `config/`.

### Canvas state boundary

`components/canvas/useInfiniteCanvasState.ts` owns the InfiniteCanvas state
that spans rendering and interaction: nodes, edges, hidden generated images,
viewport, selection, connection preview, and workflow status. It also owns the
existing localStorage load and persistence lifecycle. `InfiniteCanvas.tsx`
keeps coordinate conversion, pointer interaction, node operations, rendering,
and workflow orchestration at the component boundary.

The remaining large interactive surfaces use the same boundary rule in v2.2:
`DesignStudio`, `StudioApp`, `PptStudio`, and `PublishComposer` keep visual
composition in the component while state and feature actions are exposed from
dedicated hooks.

## Limitations

- Domain entry points are established, but several underlying implementations
  still live in the legacy flat `lib/` layout.
- The v2.2 state extraction covers the content-development surfaces; later
  changes can focus on product behavior rather than moving state ownership.
- The production build, type checks, lint, and unit/component tests pass, but a
  live PostgreSQL/Redis/provider end-to-end generation was not run in this
  migration workspace.
- The inherited repository has formatting differences outside the files
  changed in v2.2; the changed files are formatted, while a repository-wide
  formatting rewrite is intentionally deferred.
