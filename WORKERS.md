# Workers & Scheduling Design
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | v1.1 — Approved (TikTok deferral decided 2026-07-10) |
| **Phase** | 6 **and** 7 of 10 — Workers **and** Schedulers |
| **Last updated** | 2026-07-10 |
| **Depends on** | `ARCHITECTURE.md` §3.4/§3.5 · `DATABASE.md` · `AI_AGENTS.md` |
| **Next document** | `API.md` (Phase 8) |

> **Governance note.** The founder's original brief lists 10 phases including a standalone Phase 7 ("Design all Schedulers") but the accompanying document list names `WORKERS.md` with no separate `SCHEDULERS.md`. Scheduling and worker dispatch are inseparable in this architecture anyway — `ARCHITECTURE.md` §3.5 already established that the scheduler's intelligence lives in a SQL query the workers call, not in a standalone service — so **this single document covers both Phase 6 and Phase 7 in full**, rather than skipping Phase 7 or splitting an artificial file boundary through one coherent design. Nothing from either phase is omitted.

---

## 1. The Common Worker Pattern

Every worker in this document — retailer, coupon/cashback, or (later) social — follows the same shape, established in `ARCHITECTURE.md` §3.4:

```
GitHub Actions workflow (own file, own cron schedule)
  1. Call GET /api/scheduler/due?source=<worker>&limit=N   → prioritized batch (§3)
  2. For each item in the batch, independently:
       scrape → normalize → validate → write to DB → run inline deterministic
       agent logic (Price Hunter / Coupon Hunter / embedding generation, per
       AI_AGENTS.md) → on failure, log and continue to the next item
  3. Write one summary row to worker_runs (status, items_processed, error_message)
  4. Exit — no persistent process, nothing to keep alive
```

**Why this shape, restated from `ARCHITECTURE.md` Principle 4:** running each worker as its own GitHub Actions workflow file means a crash, timeout, or block in one worker's VM is physically incapable of affecting another's — this satisfies PRD FR-8 ("failure of one worker must never stop the platform") by construction, not by exception-handling discipline alone. Exception-handling discipline still matters *within* a worker (step 2's per-item try/catch, below), but the platform-wide isolation guarantee comes from the infrastructure shape, not the code.

---

## 2. Worker Resilience Rules (apply to every worker)

1. **Per-item isolation.** One product failing to scrape (layout change, timeout, temporary block) must not abort the batch — catch, log to `worker_runs.error_message` (append, not overwrite), continue to the next item.
2. **No aggressive retries within a run.** A failed item is left for the *next* scheduled run (15–30 min later, per §3), not retried in a tight loop within the same job — this is both a politeness practice (§6) and what keeps a struggling worker from burning its GitHub Actions minutes on a site that's temporarily blocking it.
3. **Partial success is a real, first-class status.** `worker_runs.status = 'partial'` (not just `'success'`/`'failed'`) when some items succeed and others don't — visible on the `/admin` route (FR-21) so degradation is observable, not silent.
4. **Timeouts are explicit, not left to the platform default.** Each page navigation/action in Playwright has an explicit timeout (e.g., 15–20s) well under GitHub Actions' job-level limits, so one hung page can't consume the whole run.
5. **Idempotent writes.** Re-scraping a product that hasn't changed writes no new `price_history` row (Price Hunter, `AI_AGENTS.md` §3.1, only writes on material change) — a worker re-run after a partial failure never double-counts.

---

## 3. Scheduling & Dispatch (Phase 7)

Elaborates `ARCHITECTURE.md` §3.5 into concrete, per-worker parameters.

### 3.1 The `/api/scheduler/due` contract
```
GET /api/scheduler/due?source=<worker_slug>&limit=N
→ returns products (or coupons/cashback rows) ordered by:
   priority = (now() - next_due_at)  DESC   -- most overdue first
   -- next_due_at = last_checked_at + check_interval
   -- check_interval shrinks with popularity_score/volatility_score (DATABASE.md §4)
```
This single query is the entire "smart scheduler" — no separate scheduler service or daemon exists; the GitHub Actions cron trigger is a coarse dispatcher, and this query is where the actual prioritization decision is made, fresh, on every call.

### 3.2 Cadence per worker type

| Worker | GitHub Actions cron | Batch size (`limit`) | Rationale |
|---|---|---|---|
| Amazon.sa, Noon, Jarir, extra (retailer price/stock) | Every 20 minutes | 25–50 per run | Matches PRD §7.2's MVP freshness target (<6h for hot products) — at 20-min cadence, a hot product with a short `check_interval` is reachable well within that window; GitHub Actions' 5-min cron floor and possible scheduling delay (`ARCHITECTURE.md` §6) are absorbed by this margin |
| Coupon Worker | Every 2 hours | 50 per run | Coupons change far less often than prices; validity-window checks don't need 20-minute freshness |
| Cashback Worker | Every 6 hours | 50 per run | Cashback rates change even less frequently (V1 scope) |
| Reddit / YouTube Worker (V2) | Every 6 hours | 20 per run | Official APIs (§5) have generous-enough free quotas for this cadence without hitting caps |
| X Worker (V2) | Daily | 20 per run | X's API is the most rate/cost-constrained of the social sources (§5) — lowest cadence of the group |
| TikTok Worker (V2) | Daily, best-effort | 10 per run | No robust free official API (§5) — lowest priority, most conservative cadence to minimize ToS exposure |

### 3.3 Embedding & AI-agent inline steps
Per `AI_AGENTS.md` §3.1/§6, retailer workers also run Price Hunter logic and (only when title/description materially changed) the local embedding model inline, in the same job — no separate scheduled job for either, keeping the "one worker, one responsibility, one blast radius" property intact.

---

## 4. Retailer Workers — Amazon, Noon, Jarir, extra

All four share one implementation pattern (a shared `packages/scraper-core` Playwright utility library — navigation helpers, retry/backoff wrapper, structured logging) with a **per-retailer adapter module** (`workers/amazon`, `workers/noon`, etc.) that implements only the retailer-specific parts: the page selectors for price/stock/title, and the normalization function mapping scraped fields to the common `products`/`price_history` schema (`DATABASE.md` §4).

| Worker | Notes specific to this source |
|---|---|
| **Amazon Worker** | **Known elevated risk, flagged honestly:** Amazon's bot-detection is historically the most aggressive of the four, and shared GitHub Actions IP ranges are a known target for such systems — expect a higher block/CAPTCHA rate here than the other three. Design response: treat blocks as an expected `worker_runs.status = 'partial'` outcome, not a bug to "fix" by evading detection — this worker is built to degrade gracefully, not to circumvent technical access controls (consistent with PRD NFR "Legal/ToS risk"). **Recommended graduation path:** apply for Amazon's Product Advertising API once an active Associates/affiliate account exists (blocked today per `PRD.md` §17 Q2 — no affiliate access yet) — revisit this worker's approach at that point rather than investing further in scraping resilience now. |
| **Noon Worker** | Standard e-commerce catalog/product-page structure; no known elevated blocking risk at MVP scraping volume, but selectors will need periodic maintenance as the site's markup changes (true of all four — flagged once here, applies everywhere). |
| **Jarir Worker** | Same pattern as Noon. |
| **extra Worker** | Same pattern as Noon. |

**Politeness policy (applies to all four, §6 elaborates):** realistic browser headers (a standard, honest User-Agent — not spoofing a different tool's identity), one page at a time per worker run (no concurrent request flooding), and respecting `robots.txt` disallow rules for any path the worker would otherwise touch.

---

## 5. Coupon & Cashback Workers

| Worker | Sources | Notes |
|---|---|---|
| **Coupon Worker** | Retailer's own promotions pages + a small set of known Saudi coupon-aggregator sites | Writes to `coupons`; feeds Coupon Hunter's hybrid parse (`AI_AGENTS.md` §3.3). MVP scope. |
| **Cashback Worker** | Cashback portal listings | Writes to `cashback_offers`; feeds Cashback Hunter (`AI_AGENTS.md` §3.4). **V1 scope**, per `PRD.md` §9 — not built at MVP. |

Both are lower-cadence, lower-volume workers (§3.2) — their value is *coverage and accuracy*, not speed, unlike the retailer price workers.

---

## 6. Social Workers (V2) — official APIs preferred over scraping

Per PRD §9, these are explicitly **V2 scope**, built last and deliberately — not because they're unimportant, but because they're the least structured data source and the most exposed to ToS/legal risk (`PRD.md` NFR "Legal/ToS risk"). Design stance, decided now so it doesn't get relitigated under launch pressure later:

| Worker | Approach | Rationale |
|---|---|---|
| **Reddit Worker** | Official Reddit API (OAuth) | Has a workable free tier for low-volume, non-commercial-scale read access — matches this platform's usage pattern; scraping Reddit directly is unnecessary and riskier than using the API that exists for exactly this purpose |
| **YouTube Worker** | Official YouTube Data API | Free daily quota (10,000 units) comfortably covers the daily cadence in §3.2 for searching/reading video metadata and comments relevant to tracked products |
| **X Worker** | Official X API, **free/basic tier only** | X's API access has become the most rate- and cost-constrained of the four social sources — this worker is scoped to whatever the free/basic tier actually allows, not sized against an aspirational volume; if the free tier proves too thin to be useful, this worker stays paused rather than falling back to scraping X directly |
| **TikTok Worker** | **Deferred indefinitely — decided 2026-07-10** | No robust official free API exists for this use case, and it's V2 scope with the lowest value-to-risk ratio of the four social sources. **Not built** — no scraping fallback either — until an official API path exists that makes this consistent with the same "prefer official APIs" stance already applied to Reddit/YouTube/X. Revisit only as a deliberate future decision if TikTok becomes clearly important to the product (e.g., a primary venue for Saudi shopping discussion), not as a default addition. |

All four write into the same `reviews` table (`source` column, `DATABASE.md` §5) and feed the Social Intelligence Agent (`AI_AGENTS.md` §3.10) — no schema difference between them, only ingestion-method difference.

---

## 7. Shared Code Structure

```
packages/
  scraper-core/     Playwright launch/retry/timeout helpers, structured logging,
                     shared by all retailer workers — not retailer-specific
  database/          typed Supabase client + generated types (DATABASE.md schema)
  shared/            common normalization utilities (currency parsing, Arabic/
                     English text handling)

workers/
  amazon/            adapter: selectors + normalize() only
  noon/              adapter: selectors + normalize() only
  jarir/              "
  extra/               "
  coupon/            adapter: coupon-source-specific scraping + Coupon Hunter's
                     hybrid parse call
  cashback/          same pattern, V1
  reddit/ x/ youtube/ tiktok/   API-client adapters, V2
```

Each `workers/<name>` package is intentionally thin — the shared logic lives in `packages/scraper-core`/`packages/database`, so a new retailer worker is mostly "write the selectors and the normalize function," not "rebuild the retry/logging/DB-write machinery."

---

## 8. Legal/Politeness Policy Summary

Ties together `PRD.md`'s NFR "Legal/ToS risk" into concrete worker behavior:

- Respect `robots.txt` disallow rules.
- Honest User-Agent identifying the request as automated, not spoofed as a different browser/tool's fingerprint.
- No concurrent request flooding — one page at a time per worker run, batch sizes bounded (§3.2).
- Treat blocking/CAPTCHA responses as an expected, gracefully-handled outcome (§2, §4's Amazon note) — never build active evasion of a site's technical access controls.
- Prefer official APIs over scraping wherever one exists and is workable at this scale (§6) — scraping is the fallback, not the default, for any source that offers a legitimate API.
- **TikTok explicitly flagged for a founder decision, not defaulted (§6, §9)** — the only source in this document where scraping vs. abstaining is left open rather than resolved.

---

## 9. Traceability to Prior Documents

| Requirement | Where addressed |
|---|---|
| FR-1–FR-8 (data collection, worker independence) | §1, §2 |
| `ARCHITECTURE.md` §3.5 (smart scheduler) | §3 |
| `AI_AGENTS.md` §3.1/§3.3/§3.4/§6 (inline deterministic/hybrid agents, embeddings) | §3.3, §4, §5 |
| `PRD.md` NFR Legal/ToS risk | §8 |
| `PRD.md` §9 roadmap (MVP vs. V1 vs. V2 worker scope) | §4/§5 (MVP+V1), §6 (V2) |

---

## 10. Resolved (2026-07-10)

1. **TikTok Worker: deferred indefinitely** — see §6.
2. Coupon-aggregator site list (§5) remains an implementation-time detail, decided when the Coupon Worker is actually built, not speculated on now.

---

## 11. Next Steps

Phase 6+7 is complete and approved. Next: **Phase 8: `API.md`** — the API surface (`/api/scheduler/due` formalized here, plus the user-facing and admin endpoints) that workers, agents, and the web app all call.
