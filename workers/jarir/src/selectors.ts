/**
 * Jarir.com product-page selectors.
 *
 * IMPORTANT -- same caveat as workers/noon/src/selectors.ts: written
 * without live access to jarir.com (this dev environment has no general
 * internet egress, see WORKERS.md §4), so these are broad, best-effort
 * fallback patterns, not confirmed against the real site. Verify against
 * a real product page before relying on this worker, and expect to
 * maintain this file as jarir.com's markup changes over time (true of
 * every retailer worker, not specific to Jarir).
 *
 * Each field is an ordered array of candidate selectors, tried in order via
 * textFromFirstMatch() (@repo/scraper-core) -- most specific first, broad
 * fallback last. Never joined into a single comma-separated CSS selector:
 * that matches in DOM order, not list-priority order, which is exactly
 * what caused a bad price match (see that helper's doc comment) during
 * this worker's first real run against jarir.com, 2026-07-10.
 */
export const JARIR_SELECTORS = {
  title: ['h1[itemprop="name"]', "h1.product-title", "h1.page-title", "h1"],
  price: ['[itemprop="price"]', ".price-box .price", '[class*="special-price"] [class*="price"]', '[class*="price"]'],
  outOfStock: ['[class*="out-of-stock"]', '[class*="unavailable"]', 'button[disabled][class*="add-to-cart"]'],
} as const;
