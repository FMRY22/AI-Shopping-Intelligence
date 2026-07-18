# Product Requirements Document (PRD)
## AI Shopping Intelligence — Personal Project (Saudi Arabia)

| | |
|---|---|
| **Status** | Active — descoped to personal-project scope |
| **Owner** | Fahad (founder, sole user) |
| **Last updated** | 2026-07-18 |

> **Revision note (2026-07-18).** The original draft (2026-07-10) scoped this as a public, multi-tenant SaaS platform — proactive notifications, coupon/cashback aggregation, social-signal monitoring, monetization, B2B data products, admin roles, millions of users. Founder decision: **this is a personal tool, for one user, with no monetization and no other users.** This revision cuts the document down to the actual product the founder wants. Sections that described the abandoned SaaS ambition are trimmed or removed rather than kept as unused aspiration — anything cut is listed explicitly in §14 so it's clear what was a deliberate decision vs. an oversight. `FR-N` numbering is left untouched even where a requirement is now cut, because `API.md`, `ARCHITECTURE.md`, `DATABASE.md`, `AI_AGENTS.md`, `UI.md`, `WORKERS.md`, and several source files already cite specific FR numbers — renumbering would silently break those cross-references. Each FR below is tagged **Active** or **Cut** instead.

---

## 1. What This Is

A personal shopping-intelligence tool covering the main Saudi retailers (Amazon.sa, Jarir, extra, Noon). One user: the founder. The core loop, in the founder's own words:

> "ابحث عن منتج يعطيني كل الخيارات في السوق، ويوريني وين افضل سعر وكم كان السعر، وهل اشتري او انتظر بناءً على توقعات مدروسة."
> *(Search for a product, get every option available in the market, see where the best price is and what the price has been, and get a buy-or-wait answer grounded in an informed prediction — not a guess.)*

Concretely:

1. **Search** a product by name.
2. **See every current option** across tracked retailers in one place — title, price, retailer, link, image, side by side.
3. **See the best price at a glance** — the cheapest option among the results should be obvious, not something to eyeball across cards.
4. **See price history**, not just today's number — for anything tracked, a chart of price over time.
5. **Get a buy-or-wait signal** grounded in that history (e.g., "this is within 2% of its 90-day low" or "this has never been this cheap before, no reason to wait"), with the reasoning shown — not a black-box score.

Nothing beyond this is being built right now. See §14 for the full list of what that excludes.

---

## 2. Problem Statement (why this is still worth building, even at personal scale)

- **Fragmentation.** Prices live on separate retailer sites (Amazon.sa, Jarir, extra, Noon) with no unified view — checking "who has the best price" today means opening 4 tabs.
- **No price memory.** A "50% OFF" badge is meaningless without knowing the real price history — was it ever actually sold near the "original" price, or is the discount fake? Nothing in the Saudi market surfaces this (unlike CamelCamelCamel/Keepa elsewhere).
- **No informed buy/wait answer.** Even with the price today, "is now a good time to buy, or should I wait" is a judgment call with no data behind it — this tool's job is to make that judgment from actual price history, not gut feel.

---

## 3. Product Principles — What This Is / Is Not

| This IS | This is NOT |
|---|---|
| A personal tool for one user (the founder) | A multi-tenant product for public users |
| A multi-retailer price comparison, one query at a time | A 24/7 background watcher with proactive notifications |
| Price history as a first-class feature (not just today's price) | A single-snapshot price checker |
| An explainable buy/wait signal — every answer shows its reasoning | A black-box "trust us" score |
| Free to run — $0 or near-$0 infra cost, no monetization | A business with a monetization strategy |

---

## 4. Scope & Roadmap

### Already built
- Live, on-demand multi-retailer search (`POST /api/track`) — Amazon.sa (browser-based) and Jarir (Constructor.io API, no browser needed) both confirmed working; extra is a known, accepted gap (Cloudflare IP-reputation block, not a selector bug — see `apps/web/src/app/api/track/route.ts`).
- Favoriting a search result tracks it permanently (`POST /api/favorite`) — a deliberate action, not automatic.
- Product images end-to-end (search results and tracked products).
- Card-grid UI with search, live results, and a tracked list.
- Scheduled per-retailer workers (`workers/*`) that keep tracked products' prices fresh and append to `price_history`.

### Active roadmap (the three things in §1, in build order)
1. **Best-price highlighting** — when live search returns results from multiple retailers, visually mark the cheapest one instead of leaving the user to compare prices by eye.
2. **Price history chart** (FR-17) — the data is already being collected (`price_history` table, written by the scheduled workers); needs a chart view per tracked product.
3. **Buy-or-wait signal** (FR-9, simplified) — starts as a simple, explainable rule against the accumulated price history (e.g., current price vs. historical min/median/percentile), not an LLM agent from day one. An LLM-backed version is a possible later upgrade, not a prerequisite for shipping v1 of this.

### Explicitly not planned (see §14 for the full cut list)
Coupons, cashback, review synthesis, social/community monitoring, proactive notifications, standing-criteria watchlists, an admin panel, alternative-product suggestions, trend detection, and any regional expansion beyond Saudi Arabia.

---

## 5. Functional Requirements

Original FR numbering preserved for cross-document traceability (`API.md`, `ARCHITECTURE.md`, `DATABASE.md`, `AI_AGENTS.md`, `UI.md`, `WORKERS.md` all cite these). Each is tagged:

### 5.1 Data Collection
- **FR-1** — 🔲 Cut. Continuous catalog discovery (crawl every product from a retailer without a search). Not needed — search is on-demand, not a standing catalog.
- **FR-2** — ✅ Active. Full price history per product (source, currency, timestamp) — required for §1.4 and the buy/wait signal.
- **FR-3** — 🔲 Cut. Automated fake-discount detection as a distinct flagged feature — folded conceptually into the buy/wait signal (FR-9) instead of being its own output.
- **FR-4** — 🔲 Cut. Coupon ingestion/validation.
- **FR-5** — 🔲 Cut. Cashback ingestion.
- **FR-6** — 🔲 Cut. Review collection/structuring.
- **FR-7** — 🔲 Cut. Social/community monitoring.
- **FR-8** — ✅ Active. Worker independence (one retailer's worker failing must not affect another) — already true by construction (`WORKERS.md`), kept because it's free and already built.

### 5.2 Intelligence
- **FR-9** — ✅ Active (simplified). Buy-now-vs-wait signal with a human-readable reason, grounded in price history. No "buy the alternative" branch (that's FR-10, cut) — just buy now or wait, and why.
- **FR-10** — 🔲 Cut. Alternative-product recommendation.
- **FR-11** — 🔲 Cut. Coupon+cashback stacking (depends on FR-4/FR-5, both cut).
- **FR-12** — 🔲 Cut. Review synthesis (depends on FR-6, cut).
- **FR-13** — 🔲 Cut. Trend/demand-spike detection.
- **FR-14** — ✅ Active, but scope changes with it. "Re-run AI analysis only on material change" still applies once FR-9 exists, so the (now much smaller) AI budget isn't wasted.

### 5.3 User-Facing
- **FR-15** — 🔲 Cut as originally written (standing criteria like "any laptop under 3000 SAR"). What's kept: favoriting a specific search result to track it — already built, effectively a simpler FR-15.
- **FR-16** — 🔲 Cut. Proactive push/email notifications.
- **FR-17** — ✅ Active. Price history chart per product — next up, §4.
- **FR-18** — ✅ Active. Search/browse with price as a first-class signal (already built at `apps/web/src/app/api/track/route.ts`, `apps/web/src/app/page.tsx`); "best price" highlighting (§4) extends this.
- **FR-19** — ✅ Active, informal. Bilingual EN/AR labels already present in the UI (`apps/web/src/components/product-browser.tsx`) as a nice-to-have; full RTL-first redesign is not a priority for a single Arabic-fluent user who's also comfortable reading English UI strings.
- **FR-20** — 🔲 Cut. Notification quiet hours (depends on FR-16, cut).

### 5.4 Admin / Ops
- **FR-21, FR-22, FR-23** — 🔲 Cut. No admin panel, no worker-health UI, no manual verdict overrides — the founder is the only operator and can read GitHub Actions run logs directly.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Cost** | $0 or as close to it as possible — free/hobby tiers throughout (already the deployed reality: Vercel, Supabase, GitHub Actions). |
| **Reliability** | One retailer's worker breaking must not affect the others (already true — independent GitHub Actions workflows per retailer). |
| **Performance** | Live search should return in well under the current ~30s ceiling where possible; not a hard SLA at personal scale. |
| **Maintainability** | Typed end-to-end (TypeScript), so the founder (with AI assistance) can keep extending it without re-learning the codebase each time. |

Scale targets (millions of users, 99.9% uptime, sub-300ms search), PDPL compliance program, and security hardening beyond "don't leak secrets, use RLS" are dropped — they were sized for a public product this no longer is.

---

## 7. Monetization

None. Single user, no ads, no affiliate links, no subscriptions, no B2B data product. This section exists only because other documents may still reference "§13" from the original draft — there is nothing to build here.

---

## 8. Explicitly Out of Scope

- Any user other than the founder; accounts, auth, or multi-tenancy.
- Proactive notifications (push/email/WhatsApp/SMS) of any kind.
- Coupons, cashback, BNPL/financing comparison.
- Review collection or synthesis.
- Social/community monitoring (Reddit/X/YouTube/TikTok).
- Trend/demand-spike detection, a "Shopping Planner" tied to Ramadan/White Friday/etc.
- Alternative-product recommendations.
- An admin panel or any ops UI beyond what GitHub Actions already provides.
- Monetization of any kind.
- Regional expansion beyond Saudi Arabia.
- Checkout/payments, holding inventory, acting as a lender — never in scope, kept from the original draft.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Retailers block scraping (already true for extra) | Accept the gap where it isn't worth chasing (documented in `apps/web/src/app/api/track/route.ts`); fail safely, never fabricate results. |
| Buy/wait signal is wrong and misleads the one user who relies on it | Keep it explainable (show the actual history/reasoning, not just a verdict) so it's easy to sanity-check, not blindly trusted. |

---

## 10. Next Steps

1. Add best-price highlighting to live search results (§4, item 1).
2. Build the price history chart view (FR-17).
3. Ship a first, simple, rule-based buy/wait signal (FR-9) against existing `price_history` data.
