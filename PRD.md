# Product Requirements Document (PRD)
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | Draft v1.0 — Awaiting stakeholder review |
| **Owner** | CTO / Principal Architect (Claude) |
| **Phase** | 1 of 10 — Product Requirements |
| **Last updated** | 2026-07-10 |
| **Next document** | `ARCHITECTURE.md` (Phase 2) — not started, pending approval of this PRD |

> **Governance note.** This PRD is the source of truth for *what* we are building and *why*. It intentionally does **not** decide database schemas, queue topologies, or infrastructure sizing — those belong to Phases 2–4. Any technical constraint mentioned here (tech stack, monorepo layout) was pre-specified by the founder and is treated as a fixed input, not a Phase-1 decision.

---

## 1. Executive Summary

We are building an **AI Shopping Intelligence Platform** for Saudi Arabia, expanding later to the GCC and broader MENA region. It is not a deals aggregator, not a price tracker, and not a coupon site — those are *features*, not the product. The product is a continuously-running intelligence system that:

1. **Watches** the shopping ecosystem 24/7 (retailer catalogs, prices, coupons, cashback offers, reviews, social/community chatter) without any user action.
2. **Understands** each product and each user well enough to know what matters (price drop, restock, better alternative, coupon stacking opportunity, financing option) before the user asks.
3. **Acts** by surfacing a ranked, explained recommendation — "buy now," "wait N days," "buy the alternative instead," complete with the reasoning — through push notifications, a web app, and (later) other channels.

The platform's defensibility is not any single feature — it's the compounding data asset (price history, review sentiment, social signal, coupon/cashback graph) built by continuous collection, and the AI layer that turns that data into a decision, not a spreadsheet.

---

## 2. Vision & Mission

**Vision:** Become the trusted shopping brain of Saudi Arabia and, over time, the Middle East — the default place people check, and increasingly the default channel that reaches *them*, before they buy anything online.

**Mission:** Continuously collect and understand the entire online shopping landscape, and use AI to tell every user the smartest possible buying decision, proactively, in their language, in their currency, on their schedule (Ramadan, White Friday, National Day, back-to-school).

---

## 3. Problem Statement

Saudi/GCC online shoppers today face a fragmented, manual, and reactive experience:

- **Fragmentation.** Prices, coupons, and cashback live on different sites (Noon, Amazon.sa, Jarir, extra, Namshi, SACO, Danube, IKEA KSA, and dozens of Salla/Zid-powered independent stores) with no unified view.
- **No price memory.** Shoppers cannot tell if "50% OFF" badges reflect a real discount or an inflated reference price — a well-documented problem in mature markets (solved elsewhere by CamelCamelCamel/Keepa-style price history, which barely exists for the Saudi market).
- **Manual coupon/cashback hunting.** Users must separately search coupon sites and cashback portals and manually stack them, and BNPL vs. cash vs. credit-card-installment total-cost comparison is essentially nonexistent as a decision tool. 42% of Saudi consumers already use BNPL (Tabby/Tamara), so financing terms are now a first-class part of the "should I buy this" decision, not a footnote.
- **No proactive intelligence.** Existing regional tools (if any) require the user to search. Nobody is watching on the user's behalf and interrupting them only when it matters.
- **Trust gap.** Reviews are scattered across the retailer's own site, YouTube unboxings, Reddit/X/TikTok discussions in Arabic and English — nobody synthesizes them into a single trustworthy verdict.
- **Underserved bilingual/RTL experience.** Global tools (Honey, Slickdeals, CamelCamelCamel) are English-only, USD-centric, and do not track Saudi retailers, Mada/STC Pay/BNPL payment rails, or Saudi-specific shopping calendar events.

---

## 4. Market Context (grounding, not a decision)

Used to size ambition and validate urgency, not to lock in a launch date.

- Saudi Arabia's e-commerce market is in a high-growth phase; independent market-research firms (IMARC, Statista, Grand View Research, Mordor Intelligence, ResearchAndMarkets) put it in the low-tens-of-billions-USD range in 2025–2026 with double-digit CAGR (~11–12%) through the early 2030s, driven by Vision 2030 digital infrastructure (~99% internet penetration, ~78% 5G coverage). Exact figures vary by methodology — treat any single number as directional, not authoritative. [Sources: imarcgroup.com, statista.com, grandviewresearch.com, mordorintelligence.com]
- B2C already dominates (~74% of e-commerce revenue in 2025), meaning our initial focus on consumer-facing shopping intelligence targets the largest and fastest-growing slice, not a niche. [Sources: same as above]
- BNPL is mainstream, not fringe: 42% of Saudi consumers report having used BNPL (Tabby/Tamara duopoly, both headquartered in/around Saudi Arabia as of 2024). This makes "total cost of ownership across payment methods" a genuine, differentiated product angle. [Source: entrepreneursharks.com, investriyadh.ai]
- Regulatory reality: the **Saudi PDPL** (Royal Decree M/19, fully enforced since Sept 2023, enforced by **SDAIA**) governs any collection/processing of personal data of Saudi residents, with fines up to SAR 5M. This has direct implications for how we store user data, how we handle scraped third-party data that may contain personal information (e.g., reviewer names), and where we host data (data residency is a live discussion topic in KSA). This is captured as a hard constraint in §12 and will be elaborated in `SECURITY.md`. [Source: sdaia.gov.sa, sgc.consulting, iapp.org]

**Decision needed from founder (see §17, Q1):** none yet at this phase — this section is informational. Deeper competitive/legal diligence is recommended before Phase 3 (Infrastructure/data-residency decisions) and will be flagged again then.

---

## 5. Product Principles — What This Is / Is Not

| This IS | This is NOT |
|---|---|
| An always-on intelligence system that thinks ahead of the user | A price-tracker the user must manually check |
| A proactive notifier ("we found this for you") | A passive deals feed the user scrolls |
| A multi-signal decision engine (price + coupon + cashback + reviews + social + financing) | A single-signal tool (price-only, or coupon-only) |
| Built for continuous, incremental, prioritized data collection at scale | Built for one-time or on-demand scraping |
| Bilingual (Arabic-first, RTL) and Saudi-context-aware from day one | An English-only tool with Arabic bolted on later |
| Explainable — every recommendation shows its reasoning | A black-box "trust us" score |

---

## 6. Core Value Proposition (by audience)

**For shoppers:**
> "Tell me once what you care about. I'll watch the internet for you and tell you the exact moment — and the exact reason — to buy, wait, or switch."

**For the business (monetization angle, elaborated §13):**
> A high-intent, purchase-ready audience with rich behavioral and price-sensitivity data, monetizable via affiliate commissions, cashback take-rate, sponsored placement (clearly labeled), premium subscriptions, and eventually B2B market-intelligence data products for brands/retailers.

---

## 7. Goals & Success Metrics

### 7.1 Product goals (qualitative)
- G1: Users receive at least one genuinely useful proactive alert per week without opening the app.
- G2: A recommendation ("buy now" / "wait") is trusted enough that users act on it — measured by click-through to retailer and, eventually, confirmed purchase via affiliate attribution.
- G3: Coverage of the top Saudi retailers + top international retailers shipping to KSA is broad enough that "is this a good price?" almost always has an answer.
- G4: The system requires zero manual data refresh — verified by an internal SLA (see 7.2).

### 7.2 Success metrics / KPIs (initial targets — to be revisited quarterly)

| Category | Metric | MVP Target | Y1 Target |
|---|---|---|---|
| Coverage | # tracked products | 250K | 5M+ |
| Coverage | # retailers/workers live | 4 (Amazon.sa, Noon, Jarir, extra) | 10+ retailers, 6+ social/community sources |
| Freshness | Median price staleness for "hot" (top 5% by popularity) products | < 2 hours | < 30 minutes |
| Freshness | Median price staleness for long-tail products | < 48 hours | < 24 hours |
| Engagement | Weekly proactive-alert open rate | 25% | 40%+ |
| Trust | % of users who don't disable notifications within 30 days | 70% | 85% |
| Monetization | Affiliate-attributed GMV | tracked, no target | defined post-MVP |
| Reliability | Platform uptime (user-facing) | 99.5% | 99.9% |
| Reliability | Worker failure isolation (one worker down ⇒ others unaffected) | 100% | 100% |
| Cost | Infra cost per 1,000 tracked products / month | baseline established | -30% via smart scheduling |

These are **placeholders to validate with the founder**, not final commitments — flagged in §17.

---

## 8. Target Users & Personas

1. **The Value Hunter (primary, MVP focus)** — Saudi resident, mobile-first, price-sensitive, shops electronics/fashion/home. Wants: "don't let me overpay," coupon + cashback stacking, BNPL total-cost clarity.
2. **The Big-Ticket Researcher** — buying a big-item (laptop, appliance, furniture) rarely; wants deep research (price history, review synthesis, "is now a good time") condensed into one page instead of 10 browser tabs.
3. **The Deal Enthusiast / Community Poster** — highly engaged, shares deals in WhatsApp/Telegram groups and Reddit; becomes a growth/virality channel if we make sharing effortless and give them credit/rewards.
4. **(Later) The Brand/Retailer** — B2B consumer of aggregated, anonymized market-intelligence (pricing trends, competitor positioning) — a Phase 2+ monetization line, out of MVP scope.

---

## 9. Scope & Phased Roadmap

This PRD scopes the **product**; the following roadmap sequences *what ships when*. Full technical phasing is `ROADMAP.md` (later deliverable); this is the product-level view.

### MVP (Phase A — KSA, single-country)
- Track products from **4 launch retailers**: Amazon.sa, Noon, Jarir, extra.
- Price history + "is this a good deal" signal per product.
- Coupon aggregation (manual + scraped) for those 4 retailers.
- Basic proactive notification: price-drop alert on watchlisted products.
- Web app (Arabic/English, RTL), account creation, watchlist.
- 3 AI agents live: Price Hunter, Deal Hunter, Notification Agent.
- Admin panel for data QA and manual overrides.

### V1 (Phase B)
- Expand to 10+ retailers incl. Namshi, SACO, Danube, IKEA KSA, extra Salla/Zid long tail.
- Cashback provider integration.
- Review Analyst agent (synthesized review verdicts).
- Price Prediction Agent (basic — "wait or buy" using historical patterns).
- Shopping Planner (event-based: Ramadan, White Friday, back-to-school).
- Mobile-optimized PWA / native app evaluation.

### V2 (Phase C)
- Social Intelligence Agent (X, Reddit, TikTok, YouTube signal).
- Trend Detection Agent, Recommendation Agent (personalized, not just watchlist-based).
- BNPL/financing comparison engine (Tabby/Tamara/credit-card installment total-cost calculator).
- B2B intelligence product (early access).

### Regional Expansion (Phase D)
- UAE, then wider GCC — new retailers, new currencies, VAT differences, Arabic dialect tuning.
- Multi-country price-comparison ("cheaper to import from UAE?" style insight), where legal.

**Explicitly out of scope for the foreseeable roadmap** (see §14) — flagging now to prevent scope creep.

---

## 10. Functional Requirements

Numbered `FR-x` for future traceability into `API.md`/`AI_AGENTS.md`/`WORKERS.md`.

### 10.1 Data Collection
- **FR-1** The system must continuously discover and ingest products from each configured retailer without manual URL submission (catalog crawl + sitemap/API where available).
- **FR-2** The system must record full price history per product (not just current price), with source, currency, and timestamp.
- **FR-3** The system must detect and flag "fake discount" patterns (inflated reference price vs. real historical price).
- **FR-4** The system must ingest coupon codes and validate them (mark expired/invalid codes automatically, not just on user report).
- **FR-5** The system must ingest cashback offers per retailer/category.
- **FR-6** The system must collect and structure reviews (retailer-native + external) per product.
- **FR-7** The system must monitor community/social sources (Reddit, X, YouTube, TikTok) for product/deal mentions relevant to tracked categories.
- **FR-8** Each worker (per source) must run independently; failure of one must not degrade or halt others (see §11 NFR-Reliability).

### 10.2 Intelligence / AI
- **FR-9** The system must produce a "should I buy now or wait" signal per tracked product, with a human-readable explanation.
- **FR-10** The system must recommend alternative products when a better option exists (better price, better rating, faster delivery).
- **FR-11** The system must surface the best available coupon+cashback combination for a given product/retailer at decision time.
- **FR-12** The system must synthesize reviews (native + social) into a short verdict with cited pros/cons, not just an average star rating.
- **FR-13** The system must detect trending products/categories ahead of demand spikes (e.g., pre-Ramadan appliance searches).
- **FR-14** The system must re-run AI analysis only when underlying data materially changes (incremental, cost-aware — not on a fixed timer regardless of change).

### 10.3 User-Facing
- **FR-15** Users can create a watchlist (specific products, or standing criteria e.g. "any laptop under 3000 SAR with 16GB RAM").
- **FR-16** Users receive proactive notifications (push/email at MVP; WhatsApp/SMS considered later) without needing to open the app.
- **FR-17** Users can view full price history as a chart per product.
- **FR-18** Users can search/browse products with price, rating, and "deal quality" as first-class filters/sort.
- **FR-19** The UI must fully support Arabic (RTL) as a first-class, not translated-afterthought, experience — including number formatting (Arabic-Indic vs. Western numerals — configurable), currency (SAR), and date handling (Gregorian primary; Hijri-aware for shopping-event context).
- **FR-20** Users can configure notification frequency/quiet hours to avoid alert fatigue.

### 10.4 Admin / Ops
- **FR-21** Admins can view worker health, last-successful-run, and error rates per source.
- **FR-22** Admins can manually override/correct AI-generated verdicts (with the correction feeding back as a signal, not just a one-off patch).
- **FR-23** Admins can pause/resume individual workers without affecting others.

---

## 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Scalability** | Architecture (Phase 2+) must support millions of tracked products and millions of users without redesign — horizontal scaling of workers/queues is mandatory, not aspirational. |
| **Performance** | User-facing pages must be interactive in <2s on median KSA mobile network conditions. Search must return in <300ms p95. |
| **Availability** | 99.9% uptime target for user-facing services post-V1; background collection degradation must never take down the web/API tier. |
| **Security** | No plaintext secrets; least-privilege access between services; all user PII encrypted at rest; see `SECURITY.md` (Phase to follow). |
| **Compliance** | Must comply with Saudi PDPL (SDAIA-enforced) for any personal data (users, and any personal data incidentally present in scraped reviews/social content — e.g., reviewer names/handles). Data residency approach for KSA personal data is an **open decision**, flagged §17. |
| **Cost Efficiency** | Collection frequency must scale with product popularity/volatility, not run uniformly — this is a core cost lever, detailed functionally in `WORKERS.md`/scheduler design (Phase 6/7). |
| **Maintainability** | Monorepo, typed codebase end-to-end (TypeScript), documented interfaces between agents/workers/services so any one piece can be rebuilt without touching the rest. |
| **Auditability** | Every AI-generated recommendation must be traceable to the data it used (for debugging, for user trust, and for regulatory defensibility). |
| **Legal/ToS risk** | Data collection from third-party sites carries ToS and legal risk (rate-limiting, robots.txt respect, no circumvention of technical access controls) — approach must be documented per-source in `WORKERS.md` and reviewed, not assumed. |

---

## 12. Localization & Cultural Requirements

- **Arabic-first, bilingual (AR/EN) from MVP** — not a post-launch translation pass. RTL layout is a core UI requirement, not a CSS afterthought.
- **Currency:** SAR primary; multi-currency support architected from the start given regional expansion roadmap.
- **Shopping calendar awareness:** Ramadan, Eid al-Fitr, Eid al-Adha, White Friday, Saudi National Day (Sep 23), back-to-school, 11.11/12.12 (regional carry-over from global e-commerce culture) — the Shopping Planner agent (§ AI Agents, future doc) is explicitly built around these events, not generic "holiday sale" detection.
- **Payment-method awareness:** Mada, Apple Pay, STC Pay, and BNPL (Tabby, Tamara) must be first-class concepts in product/price data — not generic "credit card" assumptions — because total cost of ownership differs meaningfully by payment method.

---

## 13. Monetization Strategy (directional — full model deferred to a future BUSINESS.md if requested)

1. **Affiliate commissions** from retailer partner programs on outbound purchase clicks.
2. **Cashback take-rate** — margin on cashback offers surfaced/brokered through the platform.
3. **Sponsored placement** — clearly and permanently labeled as sponsored; must never be visually or algorithmically conflated with organic "best deal" ranking (trust is the core asset — this is a hard product principle, not a growth-team negotiation point).
4. **Premium subscription** (future) — advanced alerts, unlimited watchlist criteria, deeper price-prediction.
5. **B2B market intelligence** (future, V2+) — anonymized/aggregated pricing & demand trend data licensed to brands/retailers.

---

## 14. Explicitly Out of Scope (for now)

- Building our own checkout/payment processing (we route to retailers; we are not a marketplace).
- Holding inventory or fulfilling orders.
- Acting as a BNPL/lender ourselves.
- Full non-KSA GCC support before V1 KSA metrics are healthy (§7.2).
- Native mobile apps before PWA/web validates engagement patterns (revisit at V1).

---

## 15. Assumptions & Constraints

- Tech stack, deployment targets (Railway, Supabase, Vercel), and monorepo structure are **founder-specified constraints**, treated as fixed inputs to Phase 2 architecture, not re-litigated here.
- We assume affiliate program access is obtainable for the 4 MVP retailers; **not yet verified** — flagged as a Phase-1 risk (§16) and a pre-Phase-2 action item.
- We assume scraping of public retailer/coupon/social pages is technically and legally viable within ToS-respecting rate limits; per-source legal review is required before each worker ships (see NFR "Legal/ToS risk" and will be tracked per-worker in `WORKERS.md`).

---

## 16. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Retailers block/rate-limit scraping | Data gaps, broken core value prop | Respect robots.txt/ToS; prefer official APIs/affiliate feeds where available; graceful degradation per worker; diversify sources so no single retailer is a single point of failure |
| PDPL non-compliance | Fines up to SAR 5M, reputational damage | Legal review before storing any personal data; data-minimization by default; explicit consent flows; data residency decision made deliberately (§17) |
| AI recommendations erode trust if wrong | User churn | Explainability by design (FR-9, FR-12); confidence scoring; human override path (FR-22); never overstate certainty |
| Sponsored content perceived as biased | Trust collapse (core asset) | Hard separation of organic ranking vs. sponsored, enforced architecturally, not just by policy |
| Cost blow-up from naive "crawl everything equally" | Unsustainable unit economics | Smart, popularity/volatility-weighted scheduler (Phase 6/7) — foundational, not an optimization to defer |
| Single point of failure in workers/agents | Platform-wide outage from one bad source | Independent worker processes, circuit breakers, isolated failure domains (NFR-Reliability, FR-8) |

---

## 17. Open Questions — Decisions Needed Before Phase 2

These require founder input; Phase 2 (System Architecture) will make technical decisions that depend on some of these answers.

1. **Data residency:** Should personal data of Saudi users be hosted in-Kingdom (implications for Supabase/Railway region choice), or is hosting outside KSA with PDPL-compliant safeguards acceptable at MVP stage? *(Affects Phase 2/3 infra region choice.)*
2. **Affiliate program access:** Do we already have (or can we realistically obtain pre-launch) affiliate/partner relationships with Amazon.sa, Noon, Jarir, and extra? This affects whether MVP monetization (§13.1) is real at launch or a later milestone.
3. **MVP notification channel:** Push notifications require a web/native app install; email has lower friction but lower engagement. Confirm push+email for MVP, defer WhatsApp/SMS (higher engagement in KSA but added cost/compliance complexity) to V1?
4. **Success metric ownership:** The KPI targets in §7.2 are my proposed placeholders — please confirm or revise before they become the baseline Phase 2+ designs are optimized against.
5. **Monorepo/tech-stack constraints (§15):** Confirming these are locked decisions from you, not open for re-evaluation in Phase 2 — correct?

**I will not proceed to Phase 2 architecture until at least Q1, Q2, and Q5 are answered**, since they materially affect infrastructure region selection and the monetization-related data model.

---

## 18. Glossary

- **Deal Hunter / Price Hunter / Coupon Hunter / Cashback Hunter** — specialized AI agents (fully designed in Phase 5 `AI_AGENTS.md`).
- **Worker** — an independent process responsible for collecting data from exactly one external source (Phase 6 `WORKERS.md`).
- **Watchlist** — user-defined product or criteria the platform actively monitors on the user's behalf.
- **Deal quality** — a computed signal (not raw discount %) reflecting genuine price-history-based savings.
- **White Friday** — the MENA-region equivalent/adaptation of Black Friday, a top-priority Shopping Planner event.

---

## 19. Next Steps

1. Founder review of this PRD — approve, or annotate changes.
2. Answer Open Questions (§17), at minimum Q1, Q2, Q5.
3. Upon approval → **Phase 2: `ARCHITECTURE.md`** (system architecture: services, event flow, agent/worker/scheduler interaction at a component level — no infra sizing yet, that's Phase 3).

---

### Sources referenced in §4
- [Saudi Arabia E-commerce Market Size & Forecast — IMARC Group](https://www.imarcgroup.com/saudi-arabia-e-commerce-market)
- [eCommerce Saudi Arabia — Statista Market Forecast](https://www.statista.com/outlook/emo/ecommerce/saudi-arabia/)
- [Saudi Arabia E-commerce Market Size & Outlook — Grand View Research](https://www.grandviewresearch.com/horizon/outlook/e-commerce-market/saudi-arabia)
- [Saudi Arabia E-commerce Market — Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/saudi-arabia-ecommerce-market)
- [SDAIA and Saudi PDPL Compliance Guide 2026](https://www.sgc.consulting/sdaia-saudi-personal-data-protection-law-pdpl-compliance-guide/)
- [Saudi PDPL first anniversary — IAPP](https://iapp.org/news/a/saudi-pdpl-s-first-anniversary-amendments-enforcement-and-ongoing-developments)
- [Tamara & Tabby: The BNPL Battle Reshaping Saudi Shopping](https://www.entrepreneursharks.com/tamara-tabby-the-bnpl-battle-reshaping-saudi-shopping/)
- [Tabby — Saudi Arabia's Digital Payments Future](https://investriyadh.ai/entities/tabby/)
