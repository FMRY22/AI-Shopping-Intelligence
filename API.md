# API Design
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | Draft v1.0 — Awaiting founder review |
| **Phase** | 8 of 10 — API |
| **Last updated** | 2026-07-10 |
| **Depends on** | `ARCHITECTURE.md` §3.1 · `DATABASE.md` (RLS policies) · `AI_AGENTS.md` · `WORKERS.md` §3.1 |
| **Next document** | UI design (Phase 9 — folded into this platform's frontend implementation notes; no separate file, per the founder's original document list) |

> **Governance note.** Continuing the "consolidate before you distribute" principle from `ARCHITECTURE.md` Principle 2: most of this platform's API surface is **not** custom Next.js code at all. Supabase's auto-generated, RLS-secured REST/client API already handles simple CRUD safely — writing a Route Handler to re-implement what RLS already enforces would be pure duplication. This document is explicit about *where* that applies and, more importantly, exactly which handful of operations genuinely need custom server-side logic and why.

---

## 1. API Design Philosophy: Three Layers, Not One

| Layer | Mechanism | Used for |
|---|---|---|
| **A. Direct Supabase client (RLS-secured)** | Browser calls `supabase-js` directly with the anon key; Postgres Row-Level Security (`DATABASE.md` §8) enforces who can read/write what | Simple, user-owned CRUD: watchlists, profile, push subscriptions, reading products/verdicts/price history |
| **B. Next.js Route Handlers** | `apps/web`'s server-side API (`ARCHITECTURE.md` §3.1), holds secrets, runs logic RLS can't express | Combined search ranking, admin actions with audit trails, notification delivery (holds VAPID/Resend keys), health check |
| **C. Postgres RPC functions** | SQL functions, callable via `supabase.rpc()` — directly from GitHub Actions worker scripts, no HTTP layer at all | The scheduler's prioritized "what's due" query (`WORKERS.md` §3.1) and other worker-only logic |

**Why this matters:** it keeps the true custom-API surface (Layer B) small — small enough that every endpoint in §3 below can be reasoned about individually, rather than accumulating a large, half-duplicated CRUD API alongside Supabase's own.

---

## 2. Auth & Security Model

- **End users:** Supabase Auth issues a JWT on login; `supabase-js` attaches it automatically to both direct client calls (Layer A) and calls to Route Handlers (Layer B), which verify it server-side via the Supabase server client.
- **Admin role:** a custom claim (`role: 'admin'`) on the JWT, checked both by RLS policies (`worker_runs`, `DATABASE.md` §9) and explicitly inside admin Route Handlers — belt-and-suspenders, since admin actions have side effects RLS alone shouldn't be trusted to gate.
- **Workers (Layer C):** GitHub Actions jobs authenticate to Postgres/RPC functions using the **service-role key** (`DEPLOYMENT.md` §4) — never the anon key, never exposed to the browser, injected only as a GitHub Actions secret at runtime.
- **QStash webhook targets** (§4): verified via QStash's request-signing mechanism (Upstash signs each delivered request; the Route Handler verifies the signature before acting) — prevents anyone else from POSTing fake notification triggers at these endpoints.

---

## 3. Route Handlers — the Actual Custom API Surface

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /api/search` | Public | Combines Postgres full-text search (`DATABASE.md` §4) with `pgvector` similarity and business ranking (deal quality, popularity) — genuinely needs server logic beyond a single-table RLS-gated query (FR-18) |
| `GET /api/health` | Public | Health check for UptimeRobot (`DEPLOYMENT.md` §6) and the `keepalive.yml` backstop — trivial, but must exist |
| `POST /api/notify/push` | QStash signature | Webhook target: performs the actual Web Push send (holds `VAPID_PRIVATE_KEY`, `DEPLOYMENT.md` §4) — this is why it can't be a direct client call, the private key must never reach the browser |
| `POST /api/notify/email` | QStash signature | Webhook target: performs the actual Resend send (holds `RESEND_API_KEY`) — same reasoning |
| `GET /api/admin/workers` | Admin JWT | Reads `worker_runs` (already RLS-readable to admins via Layer A, but bundled here alongside the mutating admin endpoints for one consistent `/admin` route data-fetching pattern) |
| `POST /api/admin/workers/:retailerId/toggle` | Admin JWT | Flips `retailers.is_active` (FR-23) — a real mutation with an obvious blast radius, not left to a raw client-side RLS update |
| `POST /api/admin/verdicts/:verdictId/override` | Admin JWT | Records a manual correction (§5 — feeds back as a signal per FR-22, not just a patch) |
| `GET /api/admin/quota` | Admin JWT | Surfaces OpenRouter/Upstash/Resend usage against free-tier caps (`DEPLOYMENT.md` §6's `quota-watchdog.yml` data) and the AI verdict backlog (`ARCHITECTURE.md` §8b) on the `/admin` route |

Everything *not* in this table — creating/deleting a watchlist entry, updating profile/locale/quiet-hours, registering a push subscription, reading a product's price history or current verdict — goes through **Layer A** (direct Supabase client, RLS-enforced) with no Route Handler at all.

---

## 4. Notification Delivery Flow (Layer B detail)

Elaborates `ARCHITECTURE.md` §3.10's fan-out step:

```
Notification Agent (AI_AGENTS.md §3.8, runs inside the AI-processor
GitHub Actions job — see §6) matches a new verdict to watchlists
  → publishes a message per (user, channel) to Upstash QStash
  → QStash delivers (with automatic retry) to:
      POST /api/notify/push   — Web Push send
      POST /api/notify/email  — Resend send
  → each Route Handler writes the outcome to notification_log
    (status: sent | failed | skipped_quota)
```

This is the one place secrets (VAPID private key, Resend key) are used at request-time rather than worker-time — kept in Route Handlers specifically because QStash's HTTP delivery model requires an HTTP endpoint to call, unlike the DB/RPC access pattern workers use directly.

---

## 5. Admin Verdict Override — the FR-22 Feedback Loop

PRD FR-22 requires corrections to "feed back as a signal, not just a one-off patch." Design:

- **New table** (addendum to `DATABASE.md` §6 — added here since it's an API-driven concept, not a worker-written one): `verdict_corrections (id, verdict_id, admin_id, original_verdict_type, corrected_verdict_type, note, corrected_at)`.
- `POST /api/admin/verdicts/:id/override` writes a `verdict_corrections` row **and** updates the live `product_verdicts` row (so users see the corrected verdict immediately) — the correction is never lossy; both the original AI output and the admin's correction are preserved.
- **The "signal, not patch" part:** `verdict_corrections` is designed to be queryable later (Phase 5 already-built Review Analyst/Deal Hunter prompts can be refined by looking at patterns in corrections — e.g., "the model keeps recommending 'wait' when the admin overrides to 'buy_now' for a specific category") — this is a future prompt-tuning input, not built into an automated feedback loop at MVP (that would need real volume to be meaningful), but the data is captured from day one so it's available when it *is* worth analyzing.

---

## 6. Where the AI Pipeline Actually Runs (clarifying `ARCHITECTURE.md` §3.10)

Not a new decision, but worth stating explicitly now that the API surface is concrete: **there is no Route Handler that triggers Deal Hunter or Review Analyst.** The AI pipeline (`change_events` polling → `packages/ai` call → `product_verdicts` write → Notification Agent match → QStash publish) runs entirely inside a dedicated **AI-processor GitHub Actions workflow** (`.github/workflows/ai-processor.yml`, running every 15–30 min alongside the retailer workers, per `DEPLOYMENT.md` §5's `worker-*.yml` pattern) — a Node/TS script using the Supabase service-role client and the OpenRouter API directly, no HTTP API layer in between. This keeps AI calls fully off the user-request path (`ARCHITECTURE.md` §6's Vercel-timeout risk mitigation) by construction, not by discipline.

---

## 7. Error Handling & Response Conventions

- Route Handlers return a consistent error shape: `{ error: { code: string, message_en: string, message_ar: string } }` with an appropriate HTTP status — bilingual error messages are not an afterthought given FR-19.
- Layer A (direct Supabase) errors are Supabase's own client error shape — the frontend's data-fetching layer normalizes both into one internal error type so UI components don't need to know which layer answered.
- No API versioning prefix (`/v1/...`) at MVP — this platform has exactly one consumer (`apps/web`, same monorepo, always deployed together), so version skew isn't a real risk yet. Path is reserved conceptually for when/if a public API product (a plausible V2+ monetization angle, `PRD.md` §13.5) requires it.

---

## 8. Rate Limiting

`GET /api/search` is the only public, potentially-abusable endpoint (everything else is auth-gated or webhook-signature-gated). Rate-limited via the Upstash Redis cache already in the stack (`ARCHITECTURE.md` §3.3) — a simple fixed-window counter per IP, generous enough not to affect real usage at personal scale, present mainly as a cheap insurance policy against accidental abuse rather than a defense against sophisticated attack (not warranted at this scale/threat model).

---

## 9. Traceability to Prior Documents

| Requirement | API surface |
|---|---|
| FR-15 (watchlists) | Layer A, direct client, RLS |
| FR-16 (notifications) | §4 |
| FR-17 (price history charts) | Layer A, direct client (reads `price_history_daily`/`price_history`) |
| FR-18 (search/browse) | `GET /api/search` |
| FR-19 (bilingual) | §7 error shape; all data already bilingual at the schema level (`DATABASE.md`) |
| FR-20 (quiet hours/frequency) | Layer A, direct client (`profiles` table) |
| FR-21 (worker health) | `GET /api/admin/workers` |
| FR-22 (admin override feedback) | §5 |
| FR-23 (pause/resume workers) | `POST /api/admin/workers/:id/toggle` |
| `WORKERS.md` §3.1 (`/api/scheduler/due`) | **Superseded** — implemented as a Postgres RPC function (Layer C), not a Route Handler, per §1's layering; conceptually unchanged, calling convention corrected here |

---

## 10. Open Questions for Phase 9

None blocking — this document's decisions all follow from prior phases. One low-stakes item: exact rate-limit numbers for `/api/search` (§8) are an implementation-time tuning detail, not a design decision.

---

## 11. Next Steps

Phase 8 is complete. Next: **Phase 9 — UI design.** Per the founder's original document list (no standalone UI file named), this will be delivered as frontend design notes covering the bilingual/RTL web app, admin route, and core screens (product detail, watchlist, search) — the last design phase before **Phase 10: implementation** begins.
