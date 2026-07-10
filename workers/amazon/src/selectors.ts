/**
 * amazon.sa product-page selectors.
 *
 * IMPORTANT -- same caveat as the other workers' selectors.ts: written
 * without live access to amazon.sa (WORKERS.md §4). Amazon's product-page
 * markup (id="productTitle", id="priceblock_ourprice"/a-price patterns)
 * is fairly well-documented/stable across Amazon locales, so these are a
 * bit more targeted than Noon/Jarir/extra's guesses -- but still
 * unverified against the live site.
 *
 * WORKERS.md §4 already flags Amazon as the highest bot-detection risk of
 * the four MVP retailers -- if this worker gets blocked the same way
 * Noon's GitHub Actions traffic was, that's an expected outcome to
 * confirm and report honestly, not a selector bug to keep chasing.
 */
export const AMAZON_SELECTORS = {
  title: ["#productTitle", 'h1[data-testid="product-title"]', "h1"],
  price: [
    ".a-price .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    '[data-testid="price"]',
    ".a-price",
  ],
  outOfStock: ["#outOfStock", '[data-testid="out-of-stock"]', "#availability .a-color-price"],
} as const;
