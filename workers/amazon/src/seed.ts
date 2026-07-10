/**
 * Manually-seeded product URLs to track -- see workers/noon/src/seed.ts's
 * header comment for why this is manual, not auto-discovered, at this
 * implementation stage.
 *
 * Add real amazon.sa product page URLs below before running this worker.
 */
export const SEED_PRODUCT_URLS: string[] = [
  // Swapped 2026-07-10: the amzn.eu short link produced no matchable h1 at
  // all (goto succeeded, title selectors all timed out) -- likely an
  // interstitial/country-selector page from the redirect chain, or
  // Amazon's bot-detection interstitial (WORKERS.md §4's flagged risk).
  // Using the canonical /dp/ URL directly to isolate which.
  "https://www.amazon.sa/dp/B0CN5Q73LC",
];
