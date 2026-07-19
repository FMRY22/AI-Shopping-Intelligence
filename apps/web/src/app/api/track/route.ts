import { NextResponse } from "next/server";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium-min";
import type { Browser, Locator, Page } from "playwright-core";
import { parsePrice } from "@repo/shared";

// POST /api/track (PRD.md FR-18/FR-1): the "search for anything" path.
// GET /api/search only looks inside products we've already collected --
// this route is what makes a not-yet-seen product show up: it live-searches
// every configured retailer at once, either via a real browser (amazon_sa,
// extra) or a direct JSON API call (jarir, see searchJarirViaApi). Purely a
// live lookup -- it does NOT write to the database. Nothing gets tracked
// just because it showed up in a search; the founder wants that to require
// a deliberate action, so saving is POST /api/favorite's job, triggered
// per-result from the UI. Confirmed working end-to-end for Amazon and Jarir
// (2026-07-17, live GitHub Actions test calls, real per-query results).
// extra is a known gap -- see its cardSelectors comment below -- and fails
// safely (0 results, logged, no crash) rather than surface wrong data.
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

// Founder feedback (2026-07-19): "ابي نحسن البحث فيها اكثر بعد الانتر
// بحيث يطلع كل المنتجات موب محدده" (I want the search after Enter to show
// all products, not limited) -- 5 silently truncated a broad query (e.g.
// "iphone 17" spans base/Pro/Pro Max/Air x storage x color) to whatever
// happened to be first in DOM/API order, well short of a full results page
// on either retailer. Raised to capture effectively a full first page from
// each (Jarir's Constructor.io API accepts num_results_per_page directly;
// Amazon's SERP page itself rarely renders much past this many cards
// anyway) rather than doing real pagination, which would add a second
// request per retailer for comparatively little gain on a personal-scale
// tool. Verified live (2026-07-19, GitHub Actions smoke test): a broad
// query stays well inside Vercel's 60s maxDuration at this cap -- Amazon's
// per-card DOM extraction is the only part that scales with this number
// (Jarir is one JSON call regardless of count), and it's still cheap
// relative to page load/browser launch overhead.
const MAX_RESULTS_PER_RETAILER = 30;
const CARD_WAIT_TIMEOUT_MS = 15_000;
const FIELD_TIMEOUT_MS = 3_000;

interface FoundItem {
  url: string;
  title: string;
  priceText: string | null;
  imageUrl: string | null;
}

export interface LiveSearchResult {
  retailerSlug: string;
  url: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
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
  imageSelectors: string[];
}

// extra is deliberately absent from live search (see EXTRA_CONFIG_REFERENCE
// below for why) -- founder feedback (2026-07-19): a live search took ~30s,
// and extra's guaranteed-to-fail Cloudflare wait (CARD_WAIT_TIMEOUT_MS plus
// 3 fallback selectors at 2s each = up to ~21s) for zero results every
// single time was most of that budget. Its own scheduled background worker
// (workers/extra, worker-extra.yml) still updates already-tracked extra
// prices independently -- this only affects the live "search anything" path.
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
    imageSelectors: ["img.s-image", "img"],
  },
];

// extra's config (Cloudflare-blocked, see the comment above RETAILER_CONFIGS)
// used to live here as a RetailerSearchConfig object -- see git history
// (commit around 2026-07-17's Jarir/extra selector work) if reviving it.

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

// Blocking the "image" resource type (BLOCKED_RESOURCE_TYPES below) stops
// our own browser from downloading the bytes, but the <img> tag and its
// src/data-src attributes are still present in the DOM -- reading the URL
// string is all this needs; the browser rendering the result for an actual
// person is the one that fetches it. "src" first, "data-src" as a
// lazy-load fallback (a blank/placeholder src is common until an
// IntersectionObserver swaps the real URL in, though search-result images
// are usually eager since they're above the fold).
async function imageFromFirstMatchIn(scope: Locator, page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const el = scope.locator(selector).first();
    for (const attr of ["src", "data-src"]) {
      const value = await el.getAttribute(attr, { timeout: FIELD_TIMEOUT_MS }).catch(() => null);
      if (value && !value.startsWith("data:")) {
        try {
          return new URL(value, page.url()).toString();
        } catch {
          continue;
        }
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
      const imageUrl = await imageFromFirstMatchIn(card, page, config.imageSelectors);
      items.push({ url, title, priceText, imageUrl });
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

const JARIR_CONSTRUCTOR_KEY = "key_KcSYfmQTEwRpBnd9";

interface ConstructorSearchResult {
  value?: string;
  data?: { url?: string; price?: number; image_url?: string };
}

// Jarir's own search box is powered by Constructor.io (a third-party
// search/discovery SaaS), not their Magento/Elasticsearch product API --
// confirmed by capturing real network traffic during a live search
// (2026-07-17). The obvious-looking `/api/catalogv2/product/.../q/{term}/...`
// REST endpoint is shaped exactly like a search API but doesn't actually
// filter by query at all: "laptop" and "hp" returned byte-identical
// results (a static "trending now" set). This Constructor.io endpoint is
// the real thing -- verified "laptop" vs "hp" return different, correctly
// on-topic products. It's a plain public JSON API, so Jarir needs no
// browser at all: faster and more reliable than the Playwright path used
// for amazon_sa/extra.
async function searchJarirViaApi(query: string): Promise<LiveSearchResult[]> {
  const url = `https://ac.cnstrc.com/search/${encodeURIComponent(query)}?key=${JARIR_CONSTRUCTOR_KEY}&c=cio-fe-web-jarir&s=1&num_results_per_page=${MAX_RESULTS_PER_RETAILER}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`jarir search API returned ${res.status}`);
  const data = (await res.json()) as { response?: { results?: ConstructorSearchResult[] } };
  const results = data.response?.results ?? [];

  const items: LiveSearchResult[] = [];
  for (const r of results.slice(0, MAX_RESULTS_PER_RETAILER)) {
    const title = r.value?.trim();
    const relativeUrl = r.data?.url;
    const price = r.data?.price;
    if (!title || !relativeUrl || typeof price !== "number") continue;
    items.push({
      retailerSlug: "jarir",
      url: `https://www.jarir.com/sa-en/${relativeUrl}`,
      title,
      price,
      currency: "SAR",
      imageUrl: r.data?.image_url ?? null,
    });
  }
  return items;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  // Narrowed into a new const: `query`'s string-vs-undefined narrowing above
  // doesn't persist into the closures below (runJarir/runBrowserRetailers),
  // since TS can't prove a nested function runs before any later reassignment.
  const searchQuery: string = query;

  const summary: { retailer: string; status: "fulfilled" | "rejected"; found: number; reason?: string }[] = [];
  const liveResults: LiveSearchResult[] = [];

  interface RetailerOutcome {
    retailer: string;
    status: "fulfilled" | "rejected";
    found: number;
    reason?: string;
    results: LiveSearchResult[];
  }

  // A plain HTTP call -- no browser, so it's safe to run at the same time
  // as the Playwright loop below rather than waiting for it to finish
  // first (founder feedback, 2026-07-19: a live search took ~30s; this and
  // dropping extra above together bring a typical search down to roughly
  // however long amazon_sa's own browser search takes, since that's now
  // the only thing left in the critical path).
  async function runJarir(): Promise<RetailerOutcome> {
    try {
      const results = await searchJarirViaApi(searchQuery);
      return { retailer: "jarir", status: "fulfilled", found: results.length, results };
    } catch (err) {
      return { retailer: "jarir", status: "rejected", found: 0, reason: err instanceof Error ? err.message : String(err), results: [] };
    }
  }

  // Retailers in this loop stay sequential AMONG THEMSELVES, each with its
  // own browser (see searchRetailer's comment on why reusing one browser
  // across retailers isn't reliable) -- but the whole loop runs concurrently
  // with runJarir() above via Promise.all below, since Jarir never touches
  // Playwright and so shares no browser state with it.
  async function runBrowserRetailers(): Promise<RetailerOutcome[]> {
    const outcomes: RetailerOutcome[] = [];
    for (const config of RETAILER_CONFIGS) {
      try {
        const found = await searchRetailer(config, searchQuery);
        const results: LiveSearchResult[] = [];
        for (const item of found) {
          const parsed = item.priceText ? parsePrice(item.priceText) : null;
          if (!parsed) continue;
          results.push({
            retailerSlug: config.slug,
            url: item.url,
            title: item.title,
            price: parsed.amount,
            currency: parsed.currency,
            imageUrl: item.imageUrl,
          });
        }
        outcomes.push({ retailer: config.slug, status: "fulfilled", found: results.length, results });
      } catch (err) {
        outcomes.push({ retailer: config.slug, status: "rejected", found: 0, reason: err instanceof Error ? err.message : String(err), results: [] });
      }
    }
    return outcomes;
  }

  const [jarirOutcome, browserOutcomes] = await Promise.all([runJarir(), runBrowserRetailers()]);
  for (const outcome of [jarirOutcome, ...browserOutcomes]) {
    liveResults.push(...outcome.results);
    summary.push({ retailer: outcome.retailer, status: outcome.status, found: outcome.found, ...(outcome.reason ? { reason: outcome.reason } : {}) });
  }

  const errors = summary.filter((s) => s.status === "rejected").map((s) => `${s.retailer}: ${s.reason}`);

  console.log("[track] summary", query, summary);

  return NextResponse.json({ results: liveResults, ...(errors.length > 0 ? { partialErrors: errors } : {}) });
}
