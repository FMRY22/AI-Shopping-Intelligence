# AI Agents Design
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | v1.1 — Approved (§8 defaults accepted 2026-07-10) |
| **Phase** | 5 of 10 — AI Agents |
| **Last updated** | 2026-07-10 |
| **Depends on** | `PRD.md` · `ARCHITECTURE.md` · `DEPLOYMENT.md` · `DATABASE.md` |
| **Next document** | `WORKERS.md` (Phase 6) |

> **Governance note.** The founder's original brief names 11 agents (Deal Hunter, Price Hunter, Coupon Hunter, Cashback Hunter, Review Analyst, Social Intelligence Agent, Trend Detection Agent, Price Prediction Agent, Recommendation Agent, Notification Agent, Shopping Planner). All 11 are specified here, in full, at the responsibility/interface level. What's new in this document is a design principle forced by `ARCHITECTURE.md` §8b's hard constraint (**50 AI requests/day, $0, no exceptions**): not every "agent" actually needs to call an LLM. This document draws that line explicitly for each agent, because spending the scarce daily budget on a task that a few lines of deterministic code could do just as well is the single fastest way to make the free-tier AI layer feel broken.

---

## 1. Core Design Principle: Deterministic Logic vs. LLM Reasoning

Every agent below is classified as one of:

- **⚙️ Deterministic** — plain code (SQL/TypeScript). No LLM call, no daily-budget cost, no availability risk. Runs as often as needed.
- **🧠 LLM-backed** — calls `packages/ai` (OpenRouter free models, `ARCHITECTURE.md` §3.6). Consumes the shared 50-requests/day budget. Must justify *why* the task needs reasoning rather than rules.
- **🔀 Hybrid** — deterministic by default, escalates to an LLM call only on a specific, narrow condition (e.g., "only call the LLM if regex parsing of coupon terms fails").

This isn't a cost-cutting afterthought — it's what makes the $0 AI budget viable at all. Of the 11 named agents, only **three** are genuinely LLM-backed at meaningful frequency (Deal Hunter, Review Analyst, Shopping Planner); the rest are deterministic or hybrid-with-rare-escalation. This is the single most important design decision in this document.

---

## 2. Agent Roster

| Agent | Class | MVP Phase (per `PRD.md` §9) | Trigger | Reads | Writes |
|---|---|---|---|---|---|
| **Price Hunter** | ⚙️ Deterministic | MVP | Every worker scrape (inline, not scheduled separately) | `price_history` (new row just written) | `products.volatility_score`, `change_events` (price_drop/price_rise) |
| **Deal Hunter** | 🧠 LLM-backed | MVP | `change_events` (status=pending) | `products`, `price_history`, `coupons`, `cashback_offers`, prior `product_verdicts` | `product_verdicts` |
| **Coupon Hunter** | 🔀 Hybrid | MVP | Coupon worker run | scraped coupon page text | `coupons` |
| **Cashback Hunter** | 🔀 Hybrid | V1 | Cashback worker run | scraped cashback page text | `cashback_offers` |
| **Review Analyst** | 🧠 LLM-backed | V1 | Batched: N new `reviews` rows accumulated, or `rating_change` event | `reviews`, `product_verdicts` (prior) | `product_verdicts` (`reasoning` field), `reviews.sentiment` |
| **Price Prediction Agent** | ⚙️ Deterministic (statistical) | V1 | Alongside Price Hunter, on `change_events` | `price_history`, `price_history_daily` | a `prediction` field passed into Deal Hunter's prompt — not its own table (see §3.7) |
| **Shopping Planner** | 🧠 LLM-backed (low-frequency) | V1 | Calendar-driven (Ramadan, White Friday, National Day windows) — not continuous | `watchlists`, `categories`, calendar config | a seasonal-planner entry surfaced in the UI, not a new core table |
| **Notification Agent** | ⚙️ Deterministic | MVP | New `product_verdicts` row | `watchlists`, `notification_log`, `profiles` | `notification_log`, dispatches via QStash |
| **Trend Detection Agent** | ⚙️ Deterministic (statistical), 🧠 only for the human-readable blurb | V2 | Scheduled (daily) | `watchlists` (add-rate per category), `price_history` | a `trending_categories` summary, LLM only writes the 1-sentence description |
| **Social Intelligence Agent** | 🧠 LLM-backed | V2 | Social worker run (Reddit/X/YouTube/TikTok) | scraped mentions | `reviews` (`source` ≠ `retailer`) |
| **Recommendation Agent** | 🔀 Hybrid | V2 | On-demand (user views a product / periodic digest) | `product_embeddings` (pgvector similarity — deterministic), then 🧠 only to phrase *why* it's recommended | surfaced in API response, not persisted |

---

## 3. Agent Specifications

### 3.1 Price Hunter — ⚙️ Deterministic
**Responsibility:** turn a raw scraped price point into signal. Runs as the last step of every worker's scrape (`ARCHITECTURE.md` §3.10), not as a separate scheduled job.
- Compares the new price to `products.current_price` and to the trailing window in `price_history`.
- Computes/updates `volatility_score` (rolling stddev of recent prices).
- **Fake-discount detection (PRD FR-3):** flags when a retailer's advertised "was" price is higher than the actual historical high in `price_history` — a pure data comparison, no reasoning required.
- If the new price differs materially (config threshold, e.g. >3%) from the last known price, or stock status flips, writes a `change_events` row (`event_type = price_drop | price_rise | stock_change`). This is the FR-14 gate in action — Deal Hunter never runs on a timer, only off what Price Hunter decides is material.

### 3.2 Deal Hunter — 🧠 LLM-backed
**Responsibility:** the "buy now vs. wait vs. buy the alternative" verdict (PRD FR-9, FR-10) — the platform's signature output.
- Triggered by `change_events` with `status = 'pending'`.
- Assembles a compact context: product title, current price + recent `price_history_daily` trend, active `coupons`/`cashback_offers` for that retailer, Price Prediction Agent's statistical signal (§3.6), and the prior verdict (if any) for continuity.
- Calls `packages/ai` with a structured prompt requesting `{verdict_type, reasoning_en, reasoning_ar, confidence, alternative_product_id?}` — the exact shape of `product_verdicts` (`DATABASE.md` §6).
- **This is the highest-priority consumer of the daily AI budget** — see §4's allocation policy.
- Explicitly instructed (in the system prompt) to never overstate certainty (PRD Risk table §16) and to always ground `reasoning` in the specific data it was given, not general knowledge — this is what keeps `data_snapshot` (`DATABASE.md` §6) meaningful as an audit trail.

### 3.3 Coupon Hunter — 🔀 Hybrid
**Responsibility:** keep `coupons` accurate (PRD FR-4 — "validate automatically, not just on user report").
- **Deterministic path (default):** the coupon worker scrapes a coupon listing page; a regex/rule-based parser extracts code, discount type/value, and validity dates from structured page markup (most coupon sites use fairly consistent HTML patterns for this).
- **LLM escalation (narrow, rare):** only when the deterministic parser fails to confidently extract a structured discount from the coupon's free-text description (e.g., "buy 2 get 1 free on select items" — genuinely ambiguous), it falls back to one LLM call to structure that specific string. This is the textbook case for 🔀 Hybrid: budget is spent only where rules provably can't do the job.
- Re-validation: periodically re-checks `valid_until`/redemption success against the retailer, flips `is_verified` — pure data logic, no LLM.

### 3.4 Cashback Hunter — 🔀 Hybrid
**Responsibility:** keep `cashback_offers` accurate. Same hybrid pattern as Coupon Hunter — most cashback-portal listings are structured (rate %, category, validity window) and parse deterministically; free-text terms only occasionally need LLM structuring. **V1 scope** (PRD §9) — not built at MVP.

### 3.5 Review Analyst — 🧠 LLM-backed
**Responsibility:** synthesize scattered reviews into a cited verdict (PRD FR-12), not just average the star rating.
- **Batched, not per-review:** triggered when a product accumulates N new reviews (config, e.g. 5) since the last synthesis, or on a `rating_change` event — never one LLM call per review, which would exhaust the daily budget instantly on a popular product.
- Input: the batch of new review texts + the product's prior synthesized verdict (for continuity, so re-synthesis is incremental in spirit, not a full rewrite each time).
- Output: updates the `reasoning` portion of the relevant `product_verdicts` row with cited pros/cons, and writes per-review `sentiment` classification as a side effect of the same call (one call, two outputs — budget-efficient).
- **V1 scope** — native retailer reviews only at first; social-source reviews (Reddit/YouTube/etc.) feed in once the Social Intelligence Agent (V2) exists.

### 3.6 Price Prediction Agent — ⚙️ Deterministic (statistical)
**Responsibility:** produce a "likely to drop further / likely at a low point" *signal*, not prose — this is explicitly **not** an LLM agent, because trend detection from numeric time series is exactly what statistics does well and cheaply, and there's no training-pipeline budget for a real ML model at $0 infrastructure.
- MVP/V1 method: compare current price against `price_history_daily`'s trailing 90-day min/max/median, and flag known seasonal patterns (proximity to a `Shopping Planner` event window, e.g. "White Friday is in 12 days, this category historically drops 15-20% then").
- Output is a small structured object (`{signal: 'near_historic_low' | 'likely_to_drop' | 'stable' | 'near_historic_high', basis: '...'}`) — this is **fed into Deal Hunter's prompt as a pre-computed feature**, not stored as its own reasoning. Deal Hunter (the one LLM call) is what turns this signal, plus everything else, into a coherent explanation — avoiding two separate agents both calling an LLM to say related things.
- **Graduation trigger:** a real ML model (e.g., seasonal decomposition, or a small trained regressor) becomes worthwhile once there's 1-2+ years of `price_history_daily` accumulated — not before; there isn't enough signal yet at MVP launch to justify the complexity.

### 3.7 Shopping Planner — 🧠 LLM-backed (low-frequency)
**Responsibility:** proactively prepare users for known shopping events (Ramadan, White Friday, Saudi National Day — `PRD.md` §12) rather than reactively answering a query.
- **Calendar-driven, not continuous:** a scheduled check (weekly) determines if any tracked event is within its "planning window" (e.g., 2–4 weeks out); only then does it do anything at all — most weeks it's a no-op, which is what makes it affordable within the shared budget.
- When active, generates a short, personalized planning note per user (based on their watchlist categories) — e.g., "White Friday starts in 3 weeks; 4 items on your watchlist are in categories that historically see the deepest discounts then." This is genuinely a reasoning/synthesis task (connecting calendar + category history + personal watchlist into a coherent, non-generic message), justifying the LLM call.
- **V1 scope.**

### 3.8 Notification Agent — ⚙️ Deterministic
**Responsibility:** match new verdicts to the right users and deliver them (PRD FR-16, FR-20) — matching logic and delivery are both rule-based; the *content* being delivered was already written by Deal Hunter (§3.2), so Notification Agent never calls an LLM itself.
- Triggered by a new `product_verdicts` row.
- Queries `watchlists` for matches: exact `product_id` match, or `standing_criteria` match (category + price/rating thresholds via a `jsonb` containment query).
- Checks `profiles.quiet_hours` and `notification_channels`, and `notification_log` for dedupe (never re-send the same verdict to the same user).
- Fans out via Upstash QStash → Web Push / Resend (`ARCHITECTURE.md` §3.8) and writes the outcome to `notification_log`.
- **This agent's independence from the AI budget is deliberate and important:** even on a day when the 50-request OpenRouter cap is exhausted (`ARCHITECTURE.md` §8b), any verdicts that *did* get generated earlier that day still notify users instantly — notification delivery is never blocked by AI quota.

### 3.9 Trend Detection Agent — ⚙️ Deterministic (statistical), with a thin 🧠 layer
**Responsibility:** spot categories/products gaining attention ahead of demand spikes (PRD FR-13).
- Core detection is statistical: a daily scheduled job computes the rate-of-change in `watchlists` additions per `category_id` (or per product) over a trailing window, flags outliers (e.g., z-score threshold) — no LLM needed for the detection itself.
- **Optional, batched LLM use:** once trending categories are identified (typically a handful, not hundreds), a single LLM call can turn the raw list into one human-readable sentence per trend for the UI (e.g., "Interest in air fryers is up sharply this week") — one call covering all trends found that day, not one call per trend.
- **V2 scope.**

### 3.10 Social Intelligence Agent — 🧠 LLM-backed
**Responsibility:** extract signal from Reddit/X/YouTube/TikTok mentions (PRD FR-7) — genuinely needs reasoning, since classifying whether a social post is relevant, and what it says, is not a structured-parsing problem the way coupon terms are.
- Consumes scraped mentions from the social workers (`WORKERS.md`, Phase 6).
- Classifies relevance (is this actually about a tracked product?) and sentiment, writes qualifying mentions into `reviews` with `source` set accordingly.
- **V2 scope** — deliberately last in the build order (`PRD.md` §9) both because it's the least structured data source and because it would be the fastest way to exhaust the AI budget if built before the deterministic/hybrid agents are in place and proven.

### 3.11 Recommendation Agent — 🔀 Hybrid
**Responsibility:** personalized "you might also like" surfacing (distinct from Deal Hunter's per-product verdict).
- **Deterministic core:** `pgvector` cosine similarity over `product_embeddings` (`DATABASE.md` §4) finds candidate similar/alternative products — this is a SQL query, not an LLM call.
- **Thin LLM layer:** only when surfacing a recommendation to a user does it optionally ask the LLM to phrase *why* (one short call, only on actual surfacing — e.g., digest generation — not for every similarity computation, which would run constantly and silently burn the budget).
- **V2 scope.**

---

## 4. AI Budget Allocation Policy (the 50-requests/day constraint)

Per `ARCHITECTURE.md` §8b and `DATABASE.md` §6 (`change_events.status = 'skipped_quota'`), when the daily OpenRouter cap is reached, **not all pending AI work is equal.** Priority order for the shared budget, enforced by the poller that processes `change_events`:

1. **Deal Hunter on `price_drop` events for products with an active watchlist match** — this is the platform's core promise (a user is actively waiting to hear about this product) and must never silently starve.
2. **Deal Hunter on other `price_drop`/`stock_change` events** (no current watchlist match, but still core functionality).
3. **Review Analyst batches.**
4. **Shopping Planner / Trend Detection blurbs** (already low-frequency by design, §3.7/§3.9).
5. **Recommendation Agent phrasing** (already only invoked on-demand, lowest urgency).

Anything that doesn't fit in a day's 50 requests is marked `status = 'skipped_quota'` and retried automatically at the next quota window (`DATABASE.md` §6) — nothing is lost, only delayed, and it's always the lowest-priority pending work that waits, never the highest.

---

## 5. The `packages/ai` Interface Contract

Every LLM-backed agent calls the same function, per `ARCHITECTURE.md` §3.6:

```
generateVerdict(input: {
  task: 'deal_verdict' | 'review_synthesis' | 'shopping_plan' | 'coupon_parse' | 'trend_blurb' | 'recommendation_blurb',
  context: Record<string, unknown>,   // task-specific structured data, never raw HTML
  locale: 'ar' | 'en' | 'both'
}): Promise<{
  result: Record<string, unknown>,    // task-specific structured output
  model_used: string,
  confidence?: number
}>
```

- **One interface, one fallback chain** (2–3 free OpenRouter models, `ARCHITECTURE.md` §3.6) shared across every agent — a single place to swap providers/models later, per Principle 1 of `ARCHITECTURE.md`.
- **`task` drives prompt template selection** inside `packages/ai`, not the caller — agents never construct raw prompts themselves, keeping prompt engineering centralized and reviewable in one place.
- Every call is logged (task, tokens if available, model used, success/failure) — this is what `worker_runs`-style observability (`DATABASE.md` §9) extends to cover the AI layer, and what the `quota-watchdog.yml` workflow (`DEPLOYMENT.md` §5) reads from.

---

## 6. Embeddings — Resolved (2026-07-10)

`DATABASE.md` §12 flagged the embedding model as an open question. **Resolved: embeddings are generated locally, not via an external API.**

- Model: **`Xenova/paraphrase-multilingual-MiniLM-L12-v2`** (ONNX, via `transformers.js`) — 384 dimensions, supports Arabic among 50+ languages (required for FR-19's bilingual search/recommendation quality), small enough to run on a GitHub Actions CPU runner in seconds per batch.
- Runs **inside the relevant worker's GitHub Actions job** (whenever a product's title/description materially changes — same incremental principle as FR-14) — genuinely $0, no external API, no rate limit, and doesn't touch the 50-requests/day OpenRouter budget at all, since it's a local model, not a hosted inference call.
- **Operational detail worth noting for Phase 6:** since GitHub Actions runners are stateless, the model weights (~470MB range for this model family) would otherwise re-download every run — mitigate with `actions/cache` keyed on the model version, so the download happens once and is reused across runs.
- `DATABASE.md`'s `product_embeddings.embedding` column is `vector(384)` accordingly.

---

## 7. Traceability to PRD & Prior Documents

| PRD requirement | Agent(s) |
|---|---|
| FR-3 (fake-discount detection) | Price Hunter |
| FR-4 (coupon validation) | Coupon Hunter |
| FR-5 (cashback) | Cashback Hunter |
| FR-7 (social monitoring) | Social Intelligence Agent |
| FR-9 (buy-now-vs-wait) | Deal Hunter (+ Price Prediction Agent's signal) |
| FR-10 (alternative products) | Deal Hunter, Recommendation Agent |
| FR-12 (review synthesis) | Review Analyst |
| FR-13 (trend detection) | Trend Detection Agent |
| FR-14 (incremental-only re-analysis) | `change_events` gate (§1, all LLM agents) |
| FR-16, FR-20 (notifications, quiet hours) | Notification Agent |
| §12 (shopping calendar awareness) | Shopping Planner |
| §16 Risk ("never overstate certainty") | Deal Hunter's prompt constraint (§3.2), `confidence` field |
| `ARCHITECTURE.md` §8b (50 req/day cap) | §4 Budget Allocation Policy |

---

## 8. Resolved (2026-07-10, founder deferred to design judgment)

1. **Review-batching threshold: `N = 5` new reviews**, accepted as the MVP/V1 default.
2. **Trend Detection z-score threshold:** left as an empirical tuning parameter, set to a conservative placeholder and revisited post-launch once real watchlist data exists — not decided speculatively now.

---

## 9. Next Steps

Phase 5 is complete and approved. Next: **Phase 6: `WORKERS.md`** — the independent data-collection workers (Amazon, Noon, Jarir, extra, Coupon, Cashback, and later social workers) that feed Price Hunter, Coupon Hunter, Cashback Hunter, and the embedding pipeline.
