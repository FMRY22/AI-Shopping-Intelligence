import { NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium-min";
import type { Page } from "playwright-core";
import { createServiceClient, type Product } from "@repo/database";
import { parsePrice } from "@repo/shared";

// POST /api/track (PRD.md FR-18/FR-1): the "search for anything" path.
// GET /api/search only looks inside products we've already collected --
// this route is what makes a not-yet-seen product show up: it opens a real
// browser at request time, searches the retailer directly, and saves any
// matches so the normal scheduled worker (packages/scraper-core's
// runRetailerWorker) picks them up for ongoing price tracking afterward.
// Amazon only for this first slice; same pattern extends to Jarir/extra.
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

const SEARCH_URL = (q: string) => `https://www.amazon.sa/s?k=${encodeURIComponent(q)}`;
const MAX_RESULTS = 5;

const TITLE_SELECTORS = ["h2 a span", "h2 span", "h2"];
const PRICE_SELECTORS = [".a-price .a-offscreen", ".a-price"];

interface FoundItem {
  asin: string;
  title: string;
  priceText: string | null;
}

async function launchAmazonPage(): Promise<{ browser: Awaited<ReturnType<typeof playwright.launch>>; page: Page }> {
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  const page = await context.newPage();
  return { browser, page };
}

async function searchAmazon(query: string): Promise<FoundItem[]> {
  const { browser, page } = await launchAmazonPage();
  try {
    await page.goto(SEARCH_URL(query), { waitUntil: "commit", timeout: 30_000 });

    const cards = page.locator("div[data-component-type='s-search-result']");
    await cards.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => null);

    const count = await cards.count();
    const items: FoundItem[] = [];
    for (let i = 0; i < Math.min(count, MAX_RESULTS); i++) {
      const card = cards.nth(i);
      const asin = await card.getAttribute("data-asin").catch(() => null);
      if (!asin) continue;

      let title: string | null = null;
      for (const selector of TITLE_SELECTORS) {
        title = (await card.locator(selector).first().textContent({ timeout: 3_000 }).catch(() => null))?.trim() ?? null;
        if (title) break;
      }
      if (!title) continue;

      let priceText: string | null = null;
      for (const selector of PRICE_SELECTORS) {
        priceText = (await card.locator(selector).first().textContent({ timeout: 3_000 }).catch(() => null))?.trim() ?? null;
        if (priceText) break;
      }

      items.push({ asin, title, priceText });
    }
    return items;
  } finally {
    await browser.close();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: retailer, error: retailerError } = await db
    .from("retailers")
    .select("*")
    .eq("slug", "amazon_sa")
    .single();
  if (retailerError || !retailer) {
    return NextResponse.json({ error: "amazon_sa retailer not configured" }, { status: 500 });
  }

  let found: FoundItem[];
  try {
    found = await searchAmazon(query);
  } catch (err) {
    return NextResponse.json(
      { error: `live search failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const products: Product[] = [];
  for (const item of found) {
    const parsed = item.priceText ? parsePrice(item.priceText) : null;
    if (!parsed) continue;

    const url = `https://www.amazon.sa/dp/${item.asin}`;
    const { data: existing } = await db
      .from("products")
      .select("*")
      .eq("retailer_id", retailer.id)
      .eq("retailer_product_id", item.asin)
      .maybeSingle();

    if (existing) {
      products.push(existing);
      continue;
    }

    const { data: inserted, error: insertError } = await db
      .from("products")
      .insert({
        retailer_id: retailer.id,
        retailer_product_id: item.asin,
        url,
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

  return NextResponse.json({ products });
}
