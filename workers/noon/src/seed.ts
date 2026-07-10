/**
 * Manually-seeded product URLs to track.
 *
 * Catalog auto-discovery (crawling category/search pages to find products
 * without manual submission, per PRD.md FR-1) is intentionally deferred to
 * a follow-up implementation slice -- this first slice proves the
 * collection pipeline end-to-end against a small, explicit set of real
 * product URLs before building the more complex discovery crawler.
 *
 * Add real noon.com product page URLs below before running this worker.
 * This repo ships with none, since real URLs go stale and are specific to
 * whatever you're actually tracking -- copy them directly from noon.com.
 */
export const SEED_PRODUCT_URLS: string[] = [
  // Tracking/referral query params (o=, shareId, utm_*) stripped -- only the
  // canonical /p/ product path is kept, so re-sharing the same product later
  // doesn't create a duplicate row.
  // Corrected 2026-07-10: "en-sa" (the first-copied variant) timed out with
  // zero response every time; "saudi-en" is the locale path noon.com's own
  // UI actually links to when re-copied fresh -- worth confirming this was
  // the real cause before assuming anti-bot blocking.
  "https://www.noon.com/saudi-en/N70022739V/p/",
];
