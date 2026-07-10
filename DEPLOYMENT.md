# Infrastructure & Deployment Design
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | Draft v1.0 — Awaiting founder review |
| **Phase** | 3 of 10 — Infrastructure |
| **Last updated** | 2026-07-10 |
| **Depends on** | `PRD.md` (Phase 1) · `ARCHITECTURE.md` (Phase 2, approved, $0/month recurring) |
| **Next document** | `DATABASE.md` (Phase 4) |

> **Governance note.** This document turns `ARCHITECTURE.md`'s component choices into an actual, provisionable deployment: which accounts to create, which region, how secrets flow, what CI/CD looks like, and — critically — how we cover the gaps that come with an all-free-tier stack (no built-in database backups, no SLA anywhere). It does not design database schemas (Phase 4) or worker scraping logic (Phase 6).

---

## 1. Environments

At MVP (personal scale), **one environment: production.** No separate staging project — running a second Supabase project would violate the "2 projects max on free tier" limit for no real benefit at this scale, and Vercel already gives us equivalent safety nets for free:

- **Every pull request** automatically gets its own **Vercel Preview Deployment** (free on Hobby, zero config) — this *is* the staging environment, scoped per-change, torn down automatically.
- **Every merge to `main`** deploys to production automatically via Vercel's GitHub integration.
- The database is shared between preview and production at MVP scale (acceptable — personal use, low risk); revisit with a second Supabase project only if the free-tier project ceiling stops being the binding constraint (i.e., once on Pro anyway).

---

## 2. Region & Data Residency

**Decision: Supabase project region = `eu-central-1` (Frankfurt, AWS).**

- Supabase has **no Middle East region today** — the closest options are `eu-central-1` (Frankfurt) or `ap-south-1` (Mumbai); both are comparable in latency from Saudi Arabia. [Supabase region docs; GitHub discussion #34551 "Add Middle East Servers," 2026]
- Frankfurt is chosen over Mumbai for one additional reason beyond latency: it sits under EU data-protection law (GDPR), which is a stricter superset of the PDPL safeguards already required by PRD §11/§17 Q1 (encryption at rest, access control, documented lawful basis, breach process) — hosting there makes those safeguards easier to demonstrate, not harder.
- **This is a revisit-later item, not a permanent decision:** if/when Supabase (or an alternative) ships a Bahrain/UAE region, or if regional-expansion (PRD §9 Phase D) or enterprise customers demand in-country hosting, migrate then — the architecture doesn't assume any particular region.

---

## 3. Service Inventory & Provisioning Checklist

Accounts the founder needs to create (all free, no payment method required except where noted):

| # | Service | Purpose | Plan | Payment method needed? |
|---|---|---|---|---|
| 1 | GitHub | Source control, CI/CD (Actions), worker runtime | Free, **public repo** | No |
| 2 | Vercel | Hosts `apps/web` (incl. `/admin`) | Hobby | No |
| 3 | Supabase | Postgres (+ pgvector, FTS), Auth | Free, region `eu-central-1` | No |
| 4 | Upstash | Redis (cache) + QStash (notification queue) | Free | No |
| 5 | OpenRouter | AI layer (free `:free` models) | Free, **no top-up** (§8b of `ARCHITECTURE.md`) | No |
| 6 | Resend | Transactional email (price-drop alerts) | Free (100/day cap) | No |
| 7 | (none — Web Push) | Push notifications | VAPID keypair, self-generated | No |

**Provisioning order** (each step needs the previous one's output):
1. Create the GitHub repo (public), set up Turborepo scaffold.
2. Create Supabase project in `eu-central-1`; note the project URL, anon key, service-role key.
3. Create Upstash Redis database + QStash instance; note REST URLs and tokens.
4. Create an OpenRouter account and API key (no billing info entered — stays on the $0 tier per §8b).
5. Create a Resend account, verify a sending domain (or use Resend's shared testing domain until a custom domain is ready).
6. Generate a VAPID keypair locally (`web-push generate-vapid-keys` or equivalent) for push notifications.
7. Connect the GitHub repo to Vercel (auto-deploy on push).
8. Populate all secrets per §4 below — **in Vercel/GitHub, never in the repo.**

---

## 4. Secrets & Environment Variables

**Hard rule, non-negotiable given the repo is public (per `ARCHITECTURE.md` §8.2): no secret, key, or credential is ever committed to the repository — not in code, not in `.env` files, not in commit history, not even temporarily.** `.env.example` (with placeholder values only) is the only environment file allowed in the repo.

| Variable | Purpose | Stored in |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Client-side DB/Auth access (safe to expose to browser — RLS enforces access control) | Vercel env vars (all environments) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side/worker privileged DB access — **never** exposed to the browser | Vercel env vars (server-only) + GitHub Actions repo secrets (for worker jobs) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Cache access | Vercel env vars (server-only) |
| `UPSTASH_QSTASH_TOKEN`, signing keys | Notification queue | Vercel env vars (server-only) |
| `OPENROUTER_API_KEY` | AI layer | Vercel env vars (server-only) + GitHub Actions secrets (if AI calls ever run from a worker context) |
| `RESEND_API_KEY` | Transactional email | Vercel env vars (server-only) |
| `VAPID_PUBLIC_KEY` | Push subscription (safe to expose to browser) | Vercel env vars (all environments) |
| `VAPID_PRIVATE_KEY` | Push sending | Vercel env vars (server-only) |
| `BACKUP_ENCRYPTION_KEY` | Encrypts nightly DB backups (§7) before they leave Supabase | GitHub Actions repo secret only |
| `BACKUP_REPO_DEPLOY_KEY` | Push access to the private backup repo (§7) | GitHub Actions repo secret only |

Vercel's "server-only" env vars (not prefixed `NEXT_PUBLIC_`) are never sent to the browser bundle — this is the enforcement mechanism, not just a naming convention.

---

## 5. CI/CD Pipeline

No custom deploy workflow is needed for the web app — **Vercel's GitHub integration handles it natively** (push to `main` → production deploy; push to a PR branch → preview deploy). Everything else is GitHub Actions:

| Workflow file | Trigger | Purpose |
|---|---|---|
| `.github/workflows/ci.yml` | On every PR | Lint, typecheck, unit tests (Turborepo pipeline) — blocks merge on failure |
| `.github/workflows/worker-amazon.yml` (and one per retailer/source, per `ARCHITECTURE.md` §3.4) | `schedule: cron` every 15–30 min | Calls scheduler API for due batch, runs Playwright, writes to Postgres |
| `.github/workflows/backup.yml` | `schedule: cron`, nightly | Dumps Supabase DB, encrypts it, pushes to the private backup repo (§7) |
| `.github/workflows/quota-watchdog.yml` | `schedule: cron`, every few hours | Checks Upstash/OpenRouter/Resend usage against free-tier caps (§8 risk table in `ARCHITECTURE.md`); opens a GitHub issue or sends a push notification to the founder if any cap is being approached |
| `.github/workflows/keepalive.yml` | `schedule: cron`, weekly | Lightweight DB ping, purely as a backstop against Supabase's 7-day inactivity pause — redundant with the worker workflows already touching the DB every 15–30 min, but cheap insurance against a period where all other workflows happen to be paused/disabled |

All scheduled workflows are also the mechanism that keeps GitHub itself from auto-disabling them for inactivity (a repo with regular workflow runs stays active).

---

## 6. Monitoring & Alerting (free-tier only)

No paid observability stack — assembled from what's already free:

- **Uptime (web app):** UptimeRobot free tier (50 monitors, 5-minute check interval) pinging the production URL and a lightweight `/api/health` route. Alerts via email/push, free.
- **Worker failures:** GitHub Actions sends a **free, automatic email** to the repo owner on any workflow run failure — no extra setup needed, just don't disable it.
- **Database health/usage:** Supabase's own dashboard (project size, egress, MAU) — checked manually on a light cadence (e.g., weekly) at MVP scale; no need for automation given personal-scale volume.
- **Free-tier quota approach-warnings** (Upstash commands, OpenRouter daily requests, Resend daily emails): the `quota-watchdog.yml` workflow (§5) — since none of these providers offer free built-in alerting at this tier, a small script calling each provider's usage/stats endpoint is the cheapest reliable option.
- **AI verdict backlog** (from the 50 req/day OpenRouter cap, per `ARCHITECTURE.md` §8b): surfaced on the `/admin` route (FR-21) as a simple "N verdicts pending, resumes at quota reset" indicator — visibility, not just logging.

---

## 7. Backups & Disaster Recovery

**Critical gap to close: Supabase's free tier has no automatic backups and no point-in-time recovery — both are Pro-only features.** [Supabase backup docs, 2026] Without a deliberate backup design, the platform's core data asset (price history, review synthesis, verdicts — the entire product moat per PRD §1) has **zero recovery option** if the Supabase project is ever corrupted, accidentally deleted, or lost.

**Design: nightly encrypted logical backups, stored in a separate private repository.**

1. `.github/workflows/backup.yml` runs nightly, uses the Supabase CLI (`supabase db dump`) to export the full database to a SQL file.
2. The dump is encrypted (e.g., via `age` or GPG) using `BACKUP_ENCRYPTION_KEY` (§4) **before it ever leaves the workflow runner** — this matters specifically because the app repo is public; backups must never touch it.
3. The encrypted file is pushed to a **separate, private** GitHub repository created solely for backups (e.g., `ai-shopping-intelligence-backups`) — still $0 (private repos are free; this repo holds no application code, only encrypted data, so public/private choice for it is independent of the Actions-minutes tradeoff in §8.2 of `ARCHITECTURE.md`).
4. Retention: keep the last 30 nightly dumps (older ones pruned automatically by the same workflow) — small enough in size at MVP data volume to live comfortably in a git repo without needing object storage.
5. **Restore procedure** (documented here so it's not tribal knowledge): decrypt the desired dump locally, `supabase db reset` against a fresh project (or the existing one, with caution), then restore via `psql` against the dump. This should be tested at least once before it's ever needed for real — added as a Phase 3 action item, not assumed to work.
6. **Graduation trigger:** once data volume makes git-based storage awkward (dumps consistently > ~50–100MB), move to Cloudflare R2 (10GB free, zero egress fees) instead of a private git repo — same encryption approach, different destination.

---

## 8. Domains & DNS

**Decision (2026-07-10): no custom domain.** The platform runs permanently on the Vercel-provided `*.vercel.app` subdomain — fully functional, $0, matches the "as close to $0 as possible" MVP directive (domain registration is itself a small recurring cost, avoided entirely).

**Consequence worth stating plainly (not hidden in a footnote): without a verified custom domain, Resend cannot send email to arbitrary third-party addresses** — its default/shared sending domain only delivers to the account owner's own registered email address. In practice this means the email notification channel (FR-16) works for exactly one recipient: the founder. **This is a non-issue at today's scope** (PRD §7.2: MVP is personal/single-user), but it is a hard ceiling, not a degraded experience — the moment a second real user needs email alerts, a verified domain becomes mandatory, not optional. Two things stay unaffected by this: (1) **Web Push notifications work for any number of users regardless of domain** — they're tied to the web app's origin, not to email deliverability; (2) the `/admin` route and the app itself are equally usable by anyone at the `*.vercel.app` URL.

**Graduation trigger:** add a custom domain (and verify it with Resend) at the same time real multi-user usage is planned — this is the same trigger point already implied by PRD §9 (V1) and §17 Q2 (affiliate/monetization), so it's not a new decision point, just a consequence of ones already made.

---

## 9. Rollback Strategy

- **Web app:** Vercel keeps every deployment; rolling back is an instant dashboard action (or CLI command) — no rebuild needed. This is effectively free disaster recovery for application code, distinct from the data backup problem solved in §7.
- **Database schema changes:** all migrations (Phase 4 `DATABASE.md`) must be written as reversible, versioned migration files from day one — this is a design rule for that phase, flagged here because it's an infrastructure-level guarantee (the ability to roll back a bad migration) that must be designed in, not retrofitted.
- **Workers:** since each worker is a stateless GitHub Actions job (§3.4 of `ARCHITECTURE.md`), "rollback" is just reverting the workflow file / worker code commit — no running process to manage.

---

## 10. Cost Monitoring Practice

Every component is $0 by design (`ARCHITECTURE.md` §4), so "cost monitoring" here really means **quota monitoring** — catching a free-tier cap before it silently breaks something, not catching a surprise bill. Covered by §6's `quota-watchdog.yml`. No billing alerts are needed because no payment method is on file anywhere in the stack (§3) — this is itself a safety property worth keeping: as long as that stays true, an unexpected charge is structurally impossible, not just unlikely.

---

## 11. Open Questions for Phase 4

1. Backup repo naming/ownership — same GitHub account as the main repo, or a dedicated "ops" account? (Low-stakes, defaulting to same account unless you'd rather separate them.)

*(Domain timing — resolved §8: no custom domain for MVP.)*

---

## 12. Next Steps

1. Founder review — approve or annotate, especially §7 (backup design is the one genuinely new risk this phase surfaces, since it wasn't covered in `ARCHITECTURE.md`).
2. Answer §11 if relevant (low-stakes, has a sensible default if skipped).
3. Upon approval → **Phase 4: `DATABASE.md`** — full schema design (products, price_history, change_events, product_verdicts, watchlists, users, and the popularity/volatility scheduling fields referenced throughout `ARCHITECTURE.md`).
