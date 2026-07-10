/**
 * Manually-seeded product URLs to track -- see workers/noon/src/seed.ts's
 * header comment for why this is manual, not auto-discovered, at this
 * implementation stage.
 *
 * Add real amazon.sa product page URLs below before running this worker.
 */
export const SEED_PRODUCT_URLS: string[] = [
  // Short-link (amzn.eu) -- Playwright's page.goto() follows the redirect
  // transparently, so this works the same as a canonical amazon.sa URL for
  // scraping purposes.
  "https://amzn.eu/d/0eLSSe55",
];
