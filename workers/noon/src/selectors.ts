/**
 * Noon.com product-page selectors.
 *
 * IMPORTANT -- must be verified against the live site before the first
 * real run. These were written from typical noon.com markup patterns
 * during this project's design phase, not confirmed live: the environment
 * this repo was built in has no general internet egress (WORKERS.md §4
 * documents this constraint explicitly), so noon.com could not be opened
 * to inspect its current DOM.
 *
 * Each field is an ordered array of candidate selectors, tried in order via
 * textFromFirstMatch() (@repo/scraper-core) -- most specific first, broad
 * fallback last. Never joined into a single comma-separated CSS selector:
 * that matches in DOM order, not list-priority order, which caused a bad
 * price match on jarir.com's worker during its first real run (see that
 * helper's doc comment) -- fixed here proactively for the same reason.
 */
export const NOON_SELECTORS = {
  title: ['h1[data-qa="pdp-name"]', 'h1[class*="productTitle"]', "h1"],
  price: ['[data-qa="pdp-price"]', '[class*="priceNow"]', '[class*="sellingPrice"]', '[class*="price"]'],
  outOfStock: [
    '[data-qa="pdp-out-of-stock"]',
    '[class*="outOfStock"]',
    '[class*="out-of-stock"]',
    'button[data-qa="pdp-add-to-cart"][disabled]',
  ],
} as const;
