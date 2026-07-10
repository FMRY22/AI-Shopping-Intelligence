# UI / UX Design
## AI Shopping Intelligence Platform — Saudi Arabia → MENA

| | |
|---|---|
| **Status** | Draft v1.0 — Awaiting founder review |
| **Phase** | 9 of 10 — UI |
| **Last updated** | 2026-07-10 |
| **Depends on** | `PRD.md` (personas, FR-15–20, §12 localization) · `ARCHITECTURE.md` (Next.js/Tailwind/Shadcn UI) · `DATABASE.md` · `API.md` |
| **Next document** | None — **Phase 10 is implementation**, not another design document |

> **Governance note.** No standalone UI file was named in the founder's original document list, but "Design UI" is an explicit phase (9 of 10) and this product's differentiation is largely experiential (proactive, explainable, bilingual) — worth documenting with the same rigor as every prior phase rather than skipping straight to component code. This is a design specification (screens, components, interaction rules), not visual mockups — if a visual mockup would help before Phase 10 starts, that's a quick follow-up (§10).

---

## 1. Design Principles (translating `PRD.md` §5/§6 into UI rules)

1. **Proactive, not a dashboard to check.** The home screen shows what changed and why *today*, not a static product catalog waiting to be searched. If nothing meaningful changed, it says so plainly rather than padding the screen with filler content.
2. **Every verdict shows its reasoning, always, no exceptions.** "Buy now" or "wait" is never shown as a bare label — the explanation (`reasoning_en`/`reasoning_ar`, `AI_AGENTS.md` §3.2) is always visible or one tap away, never buried in a tooltip nobody finds. This is the direct UI expression of the PRD's "explainable, not a black box" principle (§5).
3. **Never fake precision.** Confidence is shown as a qualitative band (Low/Medium/High), not a spurious "87.3%" — matching the PRD Risk table's "never overstate certainty" mitigation and `product_verdicts.confidence`'s honest, model-self-reported nature.
4. **Sponsored is never visually adjacent to "best deal."** Per `PRD.md` §13.3 (a hard product principle, not negotiable), any sponsored placement gets a distinct, permanent visual treatment (label + different card styling) and is never interleaved into the organic ranked list in a way that could be mistaken for it.
5. **Arabic is not a translated afterthought.** RTL is the default reading direction when `locale = 'ar'` (`profiles.locale`, `DATABASE.md` §8) — layouts, icons, chart direction, and number formatting all mirror correctly, not just text strings.
6. **Free-tier realities are shown honestly, not hidden.** When a verdict is pending because the daily AI quota (`ARCHITECTURE.md` §8b) is exhausted, the UI says so plainly ("Analysis resumes tomorrow — your price/coupon data is still being tracked") rather than showing a spinner forever or silently omitting the product. Honesty about system state is itself a trust signal, consistent with the platform's core value proposition.

---

## 2. Design System Foundations

- **Component library:** Shadcn UI on Tailwind CSS (per `ARCHITECTURE.md`'s named stack) — unstyled-by-default primitives, fully themeable, no vendor lock-in on visual identity.
- **Typography:** a paired Arabic/Latin font family so both scripts feel like one coherent system, not two fonts awkwardly sharing a page — e.g., **IBM Plex Sans Arabic** paired with **IBM Plex Sans** (same type family, designed to sit together), loaded via `next/font` for zero layout shift.
- **RTL/LTR handling:** Tailwind's logical-property utilities (`ps-`/`pe-` instead of `pl-`/`pr-`, etc.) throughout — direction is driven by `dir="rtl"|"ltr"` set at the document root based on `profiles.locale`, not per-component overrides.
- **Color/theme:** light and dark mode both supported — genuinely $0 to add with Tailwind's `dark:` variant, and expected by users regardless of platform scale, so there's no reason to cut it. Semantic color tokens (not raw hex in components): `--verdict-buy`, `--verdict-wait`, `--sponsored-badge`, etc., so the sponsored/organic visual distinction (Principle 4) is enforced at the token level, not left to per-page discipline.
- **Responsive baseline:** mobile-first (`PRD.md` personas are mobile-first Saudi shoppers, §8) — every screen below is designed for a phone viewport first, then expanded for desktop, not the reverse.
- **Component tokens/primitives live in `packages/ui`** (per the monorepo layout, `ARCHITECTURE.md` §3.9) — shared between `apps/web`'s public pages and its `/admin` route, so the two never visually drift apart.

---

## 3. Information Architecture & Core Screens

```
/                    Home — proactive digest (§4.1)
/search              Search & browse (§4.2)
/products/:id        Product detail — the signature screen (§4.3)
/watchlist           Watchlist management (§4.4)
/notifications        Alert history (§4.5)
/settings            Locale, notification channels, quiet hours (FR-19/FR-20)
/login, /signup      Supabase Auth-backed (Layer A, API.md §1)
/onboarding          First-run: locale pick, notification permission (§4.6)
/admin               Role-gated ops dashboard (§4.7) — folded into apps/web per ARCHITECTURE.md §8.3
```

### 4.1 Home — Proactive Digest
The screen that embodies Principle 1. Sections, in priority order:
1. **"Changed for you today"** — verdicts generated since the user's last visit for watchlisted products, each as a Verdict Card (§5.1). Empty state: "No changes today — we're still watching" (not hidden, not padded with unrelated content).
2. **Shopping Planner note** (`AI_AGENTS.md` §3.7), shown only during an active planning window (Ramadan, White Friday, National Day) — otherwise this section doesn't render at all, consistent with its low-frequency-by-design nature.
3. **Quick access to Search and Watchlist** — secondary, not the primary focus of the screen.

### 4.2 Search & Browse (FR-18)
- Search bar (calls `GET /api/search`, `API.md` §3) + filters: price range, rating, category, "deal quality" (a first-class sort option, not buried under generic sort-by-price, per FR-18's explicit requirement).
- Results as a grid/list of Product Cards (§5.2), each showing current price, deal-quality indicator, and a one-line verdict summary (not the full reasoning — that's the detail page's job).
- Sponsored results (once monetization exists, `PRD.md` §13) appear in a visually distinct card style with a permanent "Sponsored" label — never unlabeled, never blended into the organic-ranked results (Principle 4).

### 4.3 Product Detail — the Signature Screen
This is where the platform's core value proposition is most concentrated:
1. **Verdict Card** (§5.1), full detail: verdict type, full reasoning (bilingual, per locale), confidence band, "based on data as of [timestamp]" — direct expression of `data_snapshot` (`DATABASE.md` §6) and Principle 3.
2. **Price History Chart** (§5.3) — full range, with the ability to zoom into the raw-resolution 180-day window vs. the longer daily-rollup history (`DATABASE.md` §7) — the chart itself quietly reflects that retention design without the user needing to know the mechanics.
3. **Coupons & Cashback panel** — active, verified coupons (`is_verified` flag, `DATABASE.md` §5) shown first; expired/unverified ones deprioritized or hidden, not mixed in undifferentiated.
4. **Alternative product suggestion**, when `product_verdicts.alternative_product_id` is set (FR-10) — shown as a distinct, clearly-explained card ("here's why this might be better"), not silently substituted for the original product.
5. **Reviews summary** — the Review Analyst's synthesized verdict (cited pros/cons, FR-12) shown prominently; raw individual reviews available but secondary (collapsed/paginated), since the synthesis *is* the value-add over just reading reviews yourself.
6. **Add to Watchlist** button — the primary conversion action on this screen.
7. **Quota-pending state** (Principle 6): if this product has a `change_event` with `status = 'skipped_quota'` and no fresher verdict yet, the Verdict Card shows the *previous* verdict (if any) with a small honest note ("newer data available, analysis resumes with tomorrow's quota") rather than blocking on a spinner or showing nothing.

### 4.4 Watchlist (FR-15)
- Two entry types, visually distinguished: **specific products** (a list, mirrors Product Cards) and **standing criteria** (e.g., "Laptops under 3,000 SAR, rating ≥ 4.0" — shown as a readable sentence built from the `criteria` jsonb, `DATABASE.md` §8, not raw JSON).
- Each standing-criteria entry shows a live count of currently-matching products — makes an abstract rule feel concrete.
- Remove/edit actions inline, no separate edit screen for something this simple.

### 4.5 Notification / Alert History (`notification_log`)
A simple reverse-chronological list — mainly useful for trust ("did I actually get notified about that drop?") and debugging during MVP's personal-use phase. Low design investment relative to other screens; a plain list suffices.

### 4.6 Onboarding (first run)
1. Locale selection (Arabic/English) — sets the RTL/LTR direction for everything that follows, asked first for exactly that reason.
2. Push notification permission request, with a one-line honest explanation of *why* before the browser's native permission prompt fires (asking cold, with no context, has a much lower opt-in rate) — ties directly to FR-16 actually working.
3. Optional: pick 1–2 categories of interest, to pre-seed the empty-state Home screen with something more useful than a blank "no changes yet."

### 4.7 Admin (`/admin`, role-gated — FR-21/22/23)
- **Worker Health table** — one row per `worker_runs` entry (or latest-per-worker summary), status color-coded (success/partial/failed), last-run timestamp — direct read from `GET /api/admin/workers` (`API.md` §3).
- **AI Quota panel** — today's OpenRouter request count vs. the 50/day cap, pending `change_events` backlog count (`ARCHITECTURE.md` §8b) — the same honesty principle as §4.3's quota-pending state, but aggregated for ops visibility.
- **Verdict override tool** — search a product, view its current verdict, submit a correction (`POST /api/admin/verdicts/:id/override`, `API.md` §5) with a required short note (so `verdict_corrections` entries are actually useful later, not just a blank override).
- **Retailer pause toggle** (FR-23) — a simple switch per retailer, with a confirmation step (this is a real operational action, not a cosmetic setting).

This route reuses `packages/ui` components — no separate design system for admin vs. public.

---

## 4. Key Components (`packages/ui`)

### 5.1 Verdict Card
The single most important component in the product. Props: `verdict_type`, `reasoning` (locale-aware), `confidence` (Low/Medium/High badge), `generated_at`, optional `alternative_product`. Visual treatment varies subtly by `verdict_type` (buy_now = affirmative color, wait = neutral/cautionary, buy_alternative = highlights the alternative) — but reasoning text is always present regardless of type, per Principle 2.

### 5.2 Product Card
Compact form of the above for list/grid contexts: image, bilingual title, current price, deal-quality indicator (a small icon/badge derived from the verdict, not a full card), rating. Used in Search results, Watchlist, and "alternative product" suggestions — one component, three contexts.

### 5.3 Price History Chart
Renders `price_history` (recent, raw) seamlessly joined with `price_history_daily` (older, rolled-up per `DATABASE.md` §7) as one continuous line — the resolution change at the 180-day boundary should be invisible to the user, a pure data-layer concern, not a UI artifact they need to interpret.

### 5.4 Coupon/Cashback Badge
Small, consistent badge style used both on Product Cards (compact) and the Product Detail's dedicated panel (expanded) — verified vs. unverified visually distinct (e.g., a checkmark vs. a muted/greyed treatment), never presented with equal confidence.

### 5.5 Quota/Honesty Banner
A small, reusable, non-alarming banner component for every place Principle 6 applies (product detail pending state, admin quota panel) — consistent tone across the app: informative, not apologetic, not alarming.

---

## 5. Performance & Accessibility

- Meets `PRD.md` NFR (`<2s` interactive on median mobile) via `next/image` for all product images, route-level code splitting (default in Next.js App Router), and keeping the Home screen's initial data fetch to exactly what §4.1 needs — no over-fetching "just in case."
- Semantic HTML and sufficient color contrast on all verdict/status color-coding (Principle 3's confidence bands and §4.7's status colors must not rely on color alone — pair with an icon/label for colorblind users).
- RTL correctness is treated as a testable requirement, not a visual nice-to-have — every core screen (§3) should be manually checked in both directions before Phase 10 implementation is considered done for that screen.

---

## 6. Traceability to PRD

| PRD requirement | Screen/component |
|---|---|
| FR-9, FR-12 ("explainable" verdicts) | Verdict Card (§5.1), Product Detail (§4.3) |
| FR-10 (alternative products) | Product Detail §4.3.4 |
| FR-15 (watchlists, standing criteria) | §4.4 |
| FR-16 (notifications) | §4.6.2 onboarding, §4.5 history |
| FR-17 (price history) | §5.3 |
| FR-18 (search/filter/sort incl. deal quality) | §4.2 |
| FR-19 (bilingual/RTL) | §2, throughout |
| FR-20 (quiet hours/frequency) | `/settings` |
| FR-21–23 (admin) | §4.7 |
| §13.3 (sponsored/organic separation) | Principle 4, §4.2 |
| §16 Risk (AI trust, never overstate certainty) | Principle 3 |
| `ARCHITECTURE.md` §8b (quota honesty) | Principle 6, §4.3.7, §5.5 |

---

## 7. Open Questions

None blocking implementation — this document's screens and components follow directly from prior phases' data model and product principles.

---

## 8. Next Steps

**All 9 design phases are complete and approved.** Per the founder's original instructions ("only after everything is reviewed begin implementation" / "never build the entire project in one step, always build feature by feature"), **Phase 10 is implementation** — and should proceed feature by feature, not as one large build, with an architecture/scalability/security/performance check after each feature per the founder's stated quality bar.

**Suggested first feature slice** (smallest end-to-end vertical that proves the whole pipeline works): scaffold the monorepo → one retailer worker (e.g., Noon, likely the least bot-defensive per `WORKERS.md` §4) → price history storage → the scheduler RPC → a minimal Home/Product Detail page reading real data. Deal Hunter and notifications can follow once real price data is flowing — verifying the collection pipeline first is lower-risk than building the AI/notification layer against no real data.

If a visual mockup (not just this written spec) would help before committing to that build order, one can be produced quickly as a standalone artifact — say the word.
