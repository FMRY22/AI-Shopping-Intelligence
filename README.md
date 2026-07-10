# AI Shopping Intelligence Platform

Design docs (read in order): `PRD.md` → `ARCHITECTURE.md` → `DEPLOYMENT.md` →
`DATABASE.md` → `AI_AGENTS.md` → `WORKERS.md` → `API.md` → `UI.md`.

## Implementation status

**First slice (current):** proves the collection pipeline end to end --
one worker (Noon) → price history storage → scheduler → a minimal read-only
web page. No AI verdicts, notifications, watchlists, or auth yet (see
`UI.md` §8 for the planned build order).

## Local setup

1. `pnpm install`
2. Create a free Supabase project (`eu-central-1`, per `DEPLOYMENT.md` §2).
3. Apply the schema: run `supabase/migrations/0001_init.sql` then
   `supabase/seed.sql` against your project (via the Supabase SQL editor,
   or `supabase db push` if using the Supabase CLI).
4. Copy `.env.example` → `.env` (repo root, for the worker) and
   `apps/web/.env.example` → `apps/web/.env.local` (for the web app), and
   fill in your project's URL/keys.
5. Add at least one real Noon product URL to `workers/noon/src/seed.ts`
   (ships empty -- see that file's header comment).
6. **Before the first real run**, open a real noon.com product page and
   confirm `workers/noon/src/selectors.ts` still matches its markup -- see
   that file's header comment for why this couldn't be verified while this
   repo was built (no general internet egress in that environment).
7. Run the worker once: `pnpm --filter @repo/worker-noon start`
8. Run the web app: `pnpm --filter @repo/web dev`, then open
   `http://localhost:3000` -- you should see the product(s) the worker
   just collected.

## Scripts

- `pnpm turbo run typecheck` -- typecheck every package
- `pnpm turbo run build` -- production build (currently only `apps/web`
  has a build step; other packages are consumed as TypeScript source
  directly)
