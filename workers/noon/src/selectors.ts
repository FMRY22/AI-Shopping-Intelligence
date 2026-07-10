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
 * Each entry is a comma-separated CSS selector list (first match wins) to
 * add some resilience to markup variation -- but treat this whole file as
 * the one part of this worker that needs a quick manual check (open a real
 * product page, confirm these match) before relying on it, and periodic
 * maintenance after that as noon.com's markup evolves over time (true of
 * every retailer worker, not specific to Noon -- WORKERS.md §4).
 */
export const NOON_SELECTORS = {
  title: 'h1[data-qa="pdp-name"], h1[class*="productTitle"], h1',
  price: '[data-qa="pdp-price"], [class*="priceNow"], [class*="sellingPrice"], [class*="price"]',
  outOfStock:
    '[data-qa="pdp-out-of-stock"], [class*="outOfStock"], [class*="out-of-stock"], button[data-qa="pdp-add-to-cart"][disabled]',
} as const;
