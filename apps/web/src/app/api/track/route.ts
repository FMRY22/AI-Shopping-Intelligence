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
// Amazon (2026-07-17, live GitHub Actions test call, real untruncated
// titles). Jarir and extra are known gaps, for two different reasons --
// see each one's cardSelectors comment below -- and both fail safely
// (0 results, logged, no crash) rather than surface wrong data.
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
    // "h2" (the whole heading) first, not "h2 a": on some Amazon SERP
    // layouts the anchor wraps only a leading brand-name fragment (e.g.
    // "Samsung") with the rest of the title as a sibling outside the
    // anchor, so "h2 a"'s own text is truncated even though it reads as
    // non-empty. Confirmed live 2026-07-17 -- a prior fix assumed the
    // opposite order for a different truncation bug ("h2 a span" grabbing
    // only the first of several inner spans); both are real, "h2" alone
    // is the one selector that reliably gets the full text either way.
    titleSelectors: ["h2", "h2 a"],
    priceSelectors: [".a-price .a-offscreen", ".a-price"],
  },
  {
    slug: "jarir",
    searchUrl: (q) => `https://www.jarir.com/sa-en/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    // Deliberately unmatchable -- see the header comment above on why. A
    // prior attempt used ".product-tile" (jarir's real class name,
    // confirmed via curl), but a follow-up probe proved those tiles are a
    // static "trending now" widget baked into the page shell: three
    // completely different queries (laptop/hp/iphone) returned the exact
    // same 12 products in the exact same order (2026-07-17). That's worse
    // than finding nothing -- it silently hands back confident, wrong
    // results. Jarir's real per-query results come from a client-side API
    // call this static markup never exposes; finding that endpoint is a
    // separate task, not a selector tweak. Until then, fail safely (0
    // results, same as extra) rather than lie.
    cardSelectors: ["__jarir_live_search_not_yet_supported__"],
    linkSelectors: ["a[href]"],
    titleSelectors: ["h2"],
    priceSelectors: ['[class*="price"]'],
  },
  {
    slug: "extra",
    searchUrl: (q) => `https://www.extra.com/en-sa/search/?q=${encodeURIComponent(q)}`,
    // Cloudflare's bot-detection serves our headless browser a challenge
    // page ("Attention Required") on this exact URL, confirmed 2026-07-17
    // by comparing a plain curl request (200, no challenge) against the
    // live Playwright run (challenge page, 0 items) -- it's fingerprinting
    // the automated browser specifically, not blocking the route/IP in
    // general. Not chasing this with stealth/fingerprint-spoofing
    // techniques; these selectors are unverified guesses that will simply
    // find nothing until/unless that changes, same safe-failure outcome
    // as jarir below.
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

async function launchBrowser(): Promise<Browser> {
  return playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });
}

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);

async function searchRetailer(config: RetailerSearchConfig, query: string): Promise<FoundItem[]> {
  // A fresh browser per retailer: reusing one browser across sequential
  // contexts still failed even with resource blocking and no concurrency
  // ("browserContext.newPage: ...has been closed" on the 2nd retailer,
  // confirmed live 2026-07-17 via a dedicated GitHub Actions test call) --
  // @sparticuz/chromium's --single-process flag appears to make the whole
  // browser unreliable past a single context's lifecycle, not just under
  // memory pressure. Relaunching is what's actually reliable; blocking
  // images/fonts/CSS/media (below) is what keeps each retailer's page load
  // light enough that 3 relaunches still fit inside Vercel's 60s
  // maxDuration (a full-weight amazon_sa page alone caused a 504 timeout
  // with this same relaunch-per-retailer approach before blocking was added).
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (BLOCKED_RESOURCE_TYPES.has(type)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  try {
    await page.goto(config.searchUrl(query), { waitUntil: "commit", timeout: 30_000 });

    // Only the first selector gets the full wait -- once the page has had a
    // real chance to render, checking further fallback selectors doesn't
    // need another full wait each. Without this, a retailer whose selectors
    // never match burns CARD_WAIT_TIMEOUT_MS per candidate (up to 45s across
    // 3 fallbacks), which combined with 3 retailers running concurrently
    // was enough to blow past maxDuration and abort the whole request
    // (seen live 2026-07-17: "browserContext.close: ...has been closed").
    let cards = page.locator(config.cardSelectors[0]!);
    for (let i = 0; i < config.cardSelectors.length; i++) {
      const candidate = page.locator(config.cardSelectors[i]!);
      const waitTimeout = i === 0 ? CARD_WAIT_TIMEOUT_MS : 2_000;
      await candidate.first().waitFor({ state: "attached", timeout: waitTimeout }).catch(() => null);
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
      const sampleHrefs = await page
        .locator("a")
        .evaluateAll((elements) => elements.slice(0, 15).map((el) => (el as unknown as { href: string }).href))
        .catch((err: unknown) => [`<evaluateAll failed: ${err instanceof Error ? err.message : String(err)}>`]);
      console.warn("[track] no items extracted", {
        retailer: config.slug,
        requestedUrl: config.searchUrl(query),
        finalUrl: page.url(),
        title: await page.title().catch((err: unknown) => `<title() failed: ${err instanceof Error ? err.message : String(err)}>`),
        cardCount: count,
        sampleHrefs,
      });
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

  // Sequential, each with its own browser (see searchRetailer's comment).
  const summary: { retailer: string; status: "fulfilled" | "rejected"; found: number; reason?: string }[] = [];
  const liveResults: LiveSearchResult[] = [];
  for (const config of RETAILER_CONFIGS) {
    try {
      const found = await searchRetailer(config, query);
      let count = 0;
      for (const item of found) {
        const parsed = item.priceText ? parsePrice(item.priceText) : null;
        if (!parsed) continue;
        liveResults.push({ retailerSlug: config.slug, url: item.url, title: item.title, price: parsed.amount, currency: parsed.currency });
        count++;
      }
      summary.push({ retailer: config.slug, status: "fulfilled", found: count });
    } catch (err) {
      summary.push({ retailer: config.slug, status: "rejected", found: 0, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const errors = summary.filter((s) => s.status === "rejected").map((s) => `${s.retailer}: ${s.reason}`);

  console.log("[track] summary", query, summary);

  return NextResponse.json({ results: liveResults, ...(errors.length > 0 ? { partialErrors: errors } : {}) });
}
