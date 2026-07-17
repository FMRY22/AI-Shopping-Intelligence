import { NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium-min";
import type { Browser, Locator, Page } from "playwright-core";
import { parsePrice } from "@repo/shared";

// POST /api/track (PRD.md FR-18/FR-1): the "search for anything" path.
// GET /api/search only looks inside products we've already collected --
// this route is what makes a not-yet-seen product show up: it opens a real
// browser at request time and live-searches every configured retailer at
// once. Purely a live lookup -- it does NOT write to the database. Nothing
// gets tracked just because it showed up in a search; the founder wants
// that to require a deliberate action, so saving is POST /api/favorite's
// job, triggered per-result from the UI. Confirmed working end-to-end for
// Amazon (2026-07-17); Jarir/extra search-results-page selectors below are
// first-guess, unverified against the live sites -- same situation their
// product-page selectors started in (see workers/jarir and workers/extra's
// selectors.ts header comments), expect a live debugging round.
export const runtime = "nodejs";
export const maxDuration = 60;

// @sparticuz/chromium-min (not the full package): the full package's ~65MB
// bin/*.br files live behind a pnpm symlink, which Vercel's deployment
// packager rejects ("invalid deployment package ... files in symlinked
// directories") -- confirmed by a failed build. -min fetches the same pack
// from this GitHub release at cold start instead of bundling it, so there's
// nothing for the packager to choke on. x64 matches Vercel's function arch.
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

const MAX_RESULTS_PER_RETAILER = 5;
const CARD_WAIT_TIMEOUT_MS = 15_000;
const FIELD_TIMEOUT_MS = 3_000;

interface FoundItem {
  url: string;
  title: string;
  priceText: string | null;
}

export interface LiveSearchResult {
  retailerSlug: string;
  url: string;
  title: string;
  price: number;
  currency: string;
}

interface RetailerSearchConfig {
  slug: string;
  searchUrl: (q: string) => string;
  cardSelectors: string[];
  // Amazon's search cards carry a reliable data-asin attribute -- read that
  // directly rather than an href, since the confirmed-working single-retailer
  // version used it and a generic "h2 a" href selector turned out not to
  // match (48 cards found, 0 extracted -- see [track] runtime logs, 2026-07-17).
  idAttribute?: { name: string; toUrl: (id: string) => string };
  linkSelectors: string[];
  titleSelectors: string[];
  priceSelectors: string[];
}

const RETAILER_CONFIGS: RetailerSearchConfig[] = [
  {
    slug: "amazon_sa",
    searchUrl: (q) => `https://www.amazon.sa/s?k=${encodeURIComponent(q)}`,
    cardSelectors: ["div[data-component-type='s-search-result']"],
    idAttribute: { name: "data-asin", toUrl: (asin) => `https://www.amazon.sa/dp/${asin}` },
    linkSelectors: ["h2 a"],
    // "h2 a" (the whole anchor's text) first -- not "h2 a span", which
    // grabs only the first of several inner spans (often just a leading
    // brand-name fragment like "Samsung" instead of the full title, seen
    // live 2026-07-17). "h2" alone is the final fallback.
    titleSelectors: ["h2 a", "h2"],
    priceSelectors: [".a-price .a-offscreen", ".a-price"],
  },
  {
    slug: "jarir",
    searchUrl: (q) => `https://www.jarir.com/sa-en/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    cardSelectors: ["li.product-item", ".product-item", "[class*='product-item']"],
    linkSelectors: ["a.product-item-link", "h2 a", "a[href]"],
    titleSelectors: ["a.product-item-link", "h2", "[class*='product-name']"],
    priceSelectors: ['[itemprop="price"]', ".price-box .price", '[class*="price"]'],
  },
  {
    slug: "extra",
    searchUrl: (q) => `https://www.extra.com/en-sa/search/?q=${encodeURIComponent(q)}`,
    cardSelectors: [
      "[data-testid='product-card']",
      "[data-testid*='product']",
      "div[class*='product-card']",
      "li[class*='product']",
    ],
    linkSelectors: ["a[href*='/p/']", "a[href]"],
    titleSelectors: ["[data-testid='product-title']", "h3", "[class*='product-name']"],
    priceSelectors: ["[data-testid='product-price']", '[itemprop="price"]', '[class*="price"]'],
  },
];

async function textFromFirstMatchIn(scope: Locator, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const text = (await scope.locator(selector).first().textContent({ timeout: FIELD_TIMEOUT_MS }).catch(() => null))?.trim();
    if (text) return text;
  }
  return null;
}

async function urlFromFirstMatchIn(scope: Locator, page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const href = await scope.locator(selector).first().getAttribute("href", { timeout: FIELD_TIMEOUT_MS }).catch(() => null);
    if (href) {
      try {
        return new URL(href, page.url()).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function searchRetailer(browser: Browser, config: RetailerSearchConfig, query: string): Promise<FoundItem[]> {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  const page = await context.newPage();
  try {
    await page.goto(config.searchUrl(query), { waitUntil: "commit", timeout: 30_000 });

    let cards = page.locator(config.cardSelectors[0]!);
    for (const selector of config.cardSelectors) {
      const candidate = page.locator(selector);
      await candidate.first().waitFor({ state: "attached", timeout: CARD_WAIT_TIMEOUT_MS }).catch(() => null);
      if ((await candidate.count().catch(() => 0)) > 0) {
        cards = candidate;
        break;
      }
    }

    const count = await cards.count().catch(() => 0);
    const items: FoundItem[] = [];
    for (let i = 0; i < Math.min(count, MAX_RESULTS_PER_RETAILER); i++) {
      const card = cards.nth(i);

      let url: string | null = null;
      if (config.idAttribute) {
        const id = await card.getAttribute(config.idAttribute.name, { timeout: FIELD_TIMEOUT_MS }).catch(() => null);
        if (id) url = config.idAttribute.toUrl(id);
      }
      if (!url) url = await urlFromFirstMatchIn(card, page, config.linkSelectors);
      if (!url) continue;

      const title = await textFromFirstMatchIn(card, config.titleSelectors);
      if (!title) continue;

      const priceText = await textFromFirstMatchIn(card, config.priceSelectors);
      items.push({ url, title, priceText });
    }

    // Diagnostics: config.cardSelectors are unverified first guesses for
    // Jarir/extra (amazon_sa's are confirmed working). When a retailer
    // yields nothing, log enough to fix the selectors without needing
    // another round of screenshots -- final URL (redirect/interstitial?),
    // page title, matched card count, and how many of those cards actually
    // had a usable link+title+price vs got dropped along the way.
    if (items.length === 0) {
      console.warn("[track] no items extracted", {
        retailer: config.slug,
        requestedUrl: config.searchUrl(query),
        finalUrl: page.url(),
        title: await page.title().catch(() => "<unreadable>"),
        cardCount: count,
      });
    }

    return items;
  } finally {
    await context.close();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });

  try {
    const results = await Promise.allSettled(
      RETAILER_CONFIGS.map(async (config) => {
        const found = await searchRetailer(browser, config, query);
        const withPrice: LiveSearchResult[] = [];
        for (const item of found) {
          const parsed = item.priceText ? parsePrice(item.priceText) : null;
          if (!parsed) continue;
          withPrice.push({ retailerSlug: config.slug, url: item.url, title: item.title, price: parsed.amount, currency: parsed.currency });
        }
        return withPrice;
      }),
    );

    const liveResults = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const errors = results
      .map((r, i) => (r.status === "rejected" ? `${RETAILER_CONFIGS[i]!.slug}: ${String(r.reason)}` : null))
      .filter((e): e is string => e !== null);

    console.log(
      "[track] summary",
      query,
      results.map((r, i) => ({
        retailer: RETAILER_CONFIGS[i]!.slug,
        status: r.status,
        found: r.status === "fulfilled" ? r.value.length : 0,
        reason: r.status === "rejected" ? String(r.reason) : undefined,
      })),
    );

    return NextResponse.json({ results: liveResults, ...(errors.length > 0 ? { partialErrors: errors } : {}) });
  } catch (err) {
    return NextResponse.json(
      { error: `live search failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  } finally {
    await browser.close();
  }
}
