import type { Page } from "playwright";
import { log, type DiscoverUrlsFn } from "@repo/scraper-core";

/**
 * Catalog discovery (PRD.md FR-1) for amazon.sa: picks one bestseller/
 * category listing page per run (rotating so repeated runs gradually cover
 * different categories instead of hammering the same page) and extracts
 * product links from it. Amazon's bestseller pages are public, stable,
 * and list dozens of products per page -- no search query needed.
 *
 * ASINs (not full URLs) are the dedupe key: the same product can appear
 * under several URL variants (tracking params, /gp/product/ vs /dp/, etc.),
 * so every discovered link is normalized to the canonical
 * `https://www.amazon.sa/dp/<ASIN>` form before being returned.
 */
const CATALOG_PAGES = [
  "https://www.amazon.sa/gp/bestsellers/electronics",
  "https://www.amazon.sa/gp/bestsellers/computers",
  "https://www.amazon.sa/gp/bestsellers/kitchen",
  "https://www.amazon.sa/gp/bestsellers/appliances",
  "https://www.amazon.sa/gp/bestsellers/mobile",
];

const ASIN_PATTERN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;

export const discoverProductUrls: DiscoverUrlsFn = async (page: Page): Promise<string[]> => {
  // Index is always < CATALOG_PAGES.length, so the lookup can't miss.
  const catalogUrl = CATALOG_PAGES[Math.floor(Math.random() * CATALOG_PAGES.length)]!;
  await page.goto(catalogUrl, { waitUntil: "commit", timeout: 45_000 });

  const productLinks = page.locator("a[href*='/dp/'], a[href*='/gp/product/']");
  // evaluateAll reads whatever is in the DOM *right now* -- it does not
  // auto-wait like an action method (the same ".count() doesn't wait"
  // pitfall hit earlier in select-first.ts). "commit" resolves before the
  // client-rendered listing paints, so wait for at least one match first.
  await productLinks.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => null);

  // Cast as a minimal structural type rather than HTMLAnchorElement -- this
  // package's tsconfig has no DOM lib (it's a Node package), even though
  // this callback body itself runs in the browser via Playwright.
  const hrefs = await productLinks.evaluateAll((elements) =>
    elements.map((el) => (el as unknown as { href: string }).href),
  );

  if (hrefs.length === 0) {
    // Diagnostics for why the listing page yielded nothing -- final URL
    // (did it redirect to a locale/captcha interstitial?), page title, and
    // a sample of *any* anchor hrefs present, so we can see the real link
    // pattern this page uses instead of guessing again blindly.
    const finalUrl = page.url();
    const title = await page.title().catch(() => "<unreadable>");
    const sampleHrefs = await page
      .locator("a")
      .evaluateAll((elements) => elements.slice(0, 15).map((el) => (el as unknown as { href: string }).href))
      .catch(() => [] as string[]);
    log("warn", "amazon discovery found no product links", {
      requestedUrl: catalogUrl,
      finalUrl,
      title,
      sampleHrefs,
    });
  }

  const asins = new Set<string>();
  for (const href of hrefs) {
    const asin = href.match(ASIN_PATTERN)?.[1];
    if (asin) asins.add(asin);
  }

  return [...asins].map((asin) => `https://www.amazon.sa/dp/${asin}`);
};
