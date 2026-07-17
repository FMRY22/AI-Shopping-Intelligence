import { NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium-min";
import type { Browser, Locator, Page } from "playwright-core";
import { createServiceClient, type Product, type TypedSupabaseClient } from "@repo/database";
import { parsePrice } from "@repo/shared";

// POST /api/track (PRD.md FR-18/FR-1): the "search for anything" path.
// GET /api/search only looks inside products we've already collected --
// this route is what makes a not-yet-seen product show up: it opens a real
// browser at request time, live-searches every configured retailer at
// once, and saves any matches so the normal scheduled worker
// (packages/scraper-core's runRetailerWorker) picks them up for ongoing
// price tracking afterward. Confirmed working end-to-end for Amazon
// (2026-07-17); Jarir/extra search-results-page selectors below are
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

interface RetailerSearchConfig {
  slug: string;
  searchUrl: (q: string) => string;
  cardSelectors: string[];
  linkSelectors: string[];
  titleSelectors: string[];
  priceSelectors: string[];
}

const RETAILER_CONFIGS: RetailerSearchConfig[] = [
  {
    slug: "amazon_sa",
    searchUrl: (q) => `https://www.amazon.sa/s?k=${encodeURIComponent(q)}`,
    cardSelectors: ["div[data-component-type='s-search-result']"],
    linkSelectors: ["h2 a"],
    titleSelectors: ["h2 a span", "h2 span", "h2"],
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
      const url = await urlFromFirstMatchIn(card, page, config.linkSelectors);
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

function deriveProductId(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? url;
}

async function saveFoundItems(
  db: TypedSupabaseClient,
  retailerId: string,
  items: FoundItem[],
): Promise<Product[]> {
  const products: Product[] = [];
  for (const item of items) {
    const parsed = item.priceText ? parsePrice(item.priceText) : null;
    if (!parsed) continue;

    const retailerProductId = deriveProductId(item.url);
    const { data: existing } = await db
      .from("products")
      .select("*")
      .eq("retailer_id", retailerId)
      .eq("retailer_product_id", retailerProductId)
      .maybeSingle();

    if (existing) {
      products.push(existing);
      continue;
    }

    const { data: inserted, error: insertError } = await db
      .from("products")
      .insert({
        retailer_id: retailerId,
        retailer_product_id: retailerProductId,
        url: item.url,
        title_en: item.title,
        current_price: parsed.amount,
        currency: parsed.currency,
        in_stock: true,
        last_checked_at: new Date().toISOString(),
        next_due_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertError || !inserted) continue;

    await db.from("price_history").insert({
      product_id: inserted.id,
      price: parsed.amount,
      currency: parsed.currency,
      in_stock: true,
    });
    products.push(inserted);
  }
  return products;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: retailers, error: retailersError } = await db
    .from("retailers")
    .select("*")
    .in(
      "slug",
      RETAILER_CONFIGS.map((c) => c.slug),
    );
  if (retailersError || !retailers || retailers.length === 0) {
    return NextResponse.json({ error: "no configured retailers found" }, { status: 500 });
  }
  const retailerBySlug = new Map(retailers.map((r) => [r.slug, r]));

  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });

  try {
    const results = await Promise.allSettled(
      RETAILER_CONFIGS.map(async (config) => {
        const retailer = retailerBySlug.get(config.slug);
        if (!retailer) return [];
        const found = await searchRetailer(browser, config, query);
        return saveFoundItems(db, retailer.id, found);
      }),
    );

    const products = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const errors = results
      .map((r, i) => (r.status === "rejected" ? `${RETAILER_CONFIGS[i]!.slug}: ${String(r.reason)}` : null))
      .filter((e): e is string => e !== null);

    console.log(
      "[track] summary",
      query,
      results.map((r, i) => ({
        retailer: RETAILER_CONFIGS[i]!.slug,
        status: r.status,
        saved: r.status === "fulfilled" ? r.value.length : 0,
        reason: r.status === "rejected" ? String(r.reason) : undefined,
      })),
    );

    return NextResponse.json({ products, ...(errors.length > 0 ? { partialErrors: errors } : {}) });
  } catch (err) {
    return NextResponse.json(
      { error: `live search failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  } finally {
    await browser.close();
  }
}
