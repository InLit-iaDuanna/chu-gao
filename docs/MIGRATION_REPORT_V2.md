# Chūgǎo Studio v2 migration report

## Outcome

The project is now available as an independent v2 formal source tree at
`chugao_v2`, with tests and non-production artifacts isolated in `../test`.
The original `/Users/isduanna/Documents/New project 2/` directory was not
modified or deleted.

## Completed work

- Copied the runnable Next.js, React, Prisma, Redis, BullMQ, worker, deployment,
  and documentation sources into the v2 directory.
- Excluded secrets, dependencies, build output, browser output, local data,
  editor metadata, duplicate project copies, and tests from the formal copy.
- Moved 52 test files into `../test/suite` and configured their `@/` imports to
  resolve against `chugao_v2`.
- Moved historical non-standard SQL into `../test/legacy-migrations`.
- Moved invalid duplicate Next route files into `../test/legacy-routes`.
- Added project version configuration and directory naming policy under
  `config/`.
- Added domain entry points for auth, conversation, generation, inspiration,
  PPT, and provider behavior.
- Added infrastructure entry points for persistence, Redis, queues, storage,
  request parsing, rate limits, and infrastructure errors.
- Unified Studio, admin, inspiration, login, and registration browser requests
  on `components/client/request.ts`.
- Migrated generation, inspiration posts, conversation, history, and PPT route
  imports to the new domain/infrastructure boundaries.
- Changed generation creation to reject unauthenticated requests before body,
  model, pricing, and provider work.
- Removed the inactive “remember me” control because the server currently owns
  one fixed session duration.

## Verification

The following commands completed successfully from `chugao_v2` on
August 14, 2026:

```bash
pnpm exec prisma generate
pnpm typecheck
pnpm lint
pnpm test:ui
pnpm build
```

Verified results:

- TypeScript: passed
- ESLint: passed
- Vitest: 52 files, 203 tests passed
- Next.js production build: passed
- Next.js page generation: 54 static-generation tasks completed
- Standalone production output: created and moved to
  `../test/output/build/chugao_v2/.next`

## Next release direction

The next accepted change should be created in `chugao_v2.1`. Its highest-value
scope is feature-level extraction of the Studio and Canvas state, followed by
moving remaining route handlers away from direct flat `lib/` imports.

Go should be evaluated after runtime measurements identify a service boundary
where the current Node worker or provider path is the actual bottleneck.

## Limitations

- Database, Redis, storage, and real-provider integration were not exercised
  because this migration copy intentionally contains no `.env` credentials.
- The old project remains present until the user performs the planned deletion.
- Existing security code was preserved, including mechanisms that predate the
  new default rule against adding hash implementations.
