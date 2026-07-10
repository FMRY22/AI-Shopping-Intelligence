/**
 * extra.com product-page selectors.
 *
 * IMPORTANT -- same caveat as workers/noon and workers/jarir's
 * selectors.ts: written without live access to extra.com (this dev
 * environment has no general internet egress, see WORKERS.md §4), so
 * these are broad, best-effort fallback patterns, not confirmed against
 * the real site. Expect at least one round of live debugging the first
 * time this worker actually runs (exactly what happened with Jarir --
 * see that worker's commit history for the pattern of fixes to expect:
 * wrong element matched by an overly broad fallback, and/or a
 * client-rendered page needing the content to actually paint before the
 * selectors can find it).
 *
 * Ordered arrays, most specific first -- tried via textFromFirstMatch()
 * (@repo/scraper-core), never joined into a single comma-separated CSS
 * selector (see that helper's doc comment for why).
 */
export const EXTRA_SELECTORS = {
  title: ['h1[itemprop="name"]', 'h1[data-testid="product-title"]', "h1.product-name", "h1"],
  price: [
    '[itemprop="price"]',
    '[data-testid="product-price"]',
    ".price-box .price",
    '[class*="price"]',
  ],
  outOfStock: [
    '[data-testid="out-of-stock"]',
    '[class*="out-of-stock"]',
    '[class*="unavailable"]',
    'button[disabled][class*="add-to-cart"]',
  ],
} as const;
