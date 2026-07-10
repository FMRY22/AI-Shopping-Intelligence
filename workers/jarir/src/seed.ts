/**
 * Manually-seeded product URLs to track -- see workers/noon/src/seed.ts's
 * header comment for why this is manual, not auto-discovered, at this
 * implementation stage.
 *
 * Add real jarir.com product page URLs below before running this worker.
 */
export const SEED_PRODUCT_URLS: string[] = [
  // Tracking/ad-click params (gclsrc, gad_*, gbraid, gclid) stripped --
  // only the canonical product path is kept.
  "https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html",
];
