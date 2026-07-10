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
export const SEED_PRODUCT_URLS: string[] = [];
