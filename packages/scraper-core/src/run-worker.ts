import type { Page } from "playwright";
import { createServiceClient, type Product, type TypedSupabaseClient } from "@repo/database";
import { parsePrice } from "@repo/shared";
import { launchContext } from "./browser";
import { log } from "./logger";
import { runBatch, withSingleRetry } from "./batch";
import { isMaterialPriceChange, computeVolatility, checkIntervalFor, intervalToMs } from "./price-hunter";
import type { DiscoverUrlsFn, ScrapeProductPageFn } from "./types";

/**
 * The full per-retailer worker orchestration (WORKERS.md §1's "common
 * worker pattern"), shared across every retailer worker -- only the
 * retailer-specific adapter (selectors + scrapeProductPage) differs between
 * `workers/noon`, `workers/jarir`, etc. Each worker's own `src/index.ts`
 * is just a thin call into this function with its own config.
 */
export interface RetailerWorkerConfig {
  retailerSlug: string;
  workerName: string;
  seedUrls: string[];
  scrapeProductPage: ScrapeProductPageFn;
  /** Optional catalog crawl (FR-1) -- see DiscoverUrlsFn. Omit to keep a worker on manually-seeded URLs only. */
  discoverUrls?: DiscoverUrlsFn;
  /** Caps how many newly-discovered products get inserted in a single run, bounding runtime against the 10-minute workflow timeout. */
  maxNewDiscoveries?: number;
  /** Caps how many catalog_crawl-sourced products exist at once for this retailer -- older ones are deleted as new ones arrive. Never touches 'seed' or 'user_search' rows. */
  maxCatalogCrawlProducts?: number;
  batchLimit?: number;
}

type WorkItem =
  | { kind: "recheck"; product: Product }
  | { kind: "discover"; url: string; source: "seed" | "catalog_crawl" };

const DEFAULT_MAX_NEW_DISCOVERIES = 8;
const DEFAULT_MAX_CATALOG_CRAWL_PRODUCTS = 10;

export async function runRetailerWorker(config: RetailerWorkerConfig): Promise<void> {
  const {
    retailerSlug,
    workerName,
    seedUrls,
    scrapeProductPage,
    discoverUrls,
    maxNewDiscoveries = DEFAULT_MAX_NEW_DISCOVERIES,
    maxCatalogCrawlProducts = DEFAULT_MAX_CATALOG_CRAWL_PRODUCTS,
    batchLimit = 25,
  } = config;
  const startedAt = new Date().toISOString();
  const db = createServiceClient();

  const { data: retailer, error: retailerError } = await db
    .from("retailers")
    .select("*")
    .eq("slug", retailerSlug)
    .single();
  if (retailerError || !retailer) {
    throw new Error(`could not load retailer '${retailerSlug}': ${retailerError?.message}`);
  }

  const { data: dueProducts, error: dueError } = await db.rpc("get_due_items", {
    p_retailer_slug: retailerSlug,
    p_limit: batchLimit,
  });
  if (dueError) throw new Error(`get_due_items failed: ${dueError.message}`);

  const { data: existingByUrl } = await db
    .from("products")
    .select("url")
    .eq("retailer_id", retailer.id)
    .in("url", seedUrls.length > 0 ? seedUrls : ["__none__"]);
  const knownUrls = new Set((existingByUrl ?? []).map((p) => p.url));
  const newSeedUrls = seedUrls.filter((url) => !knownUrls.has(url));

  const needsBrowser = (dueProducts?.length ?? 0) > 0 || newSeedUrls.length > 0 || Boolean(discoverUrls);
  if (!needsBrowser) {
    await writeRunSummary(db, workerName, retailer.id, startedAt, { status: "success", itemsProcessed: 0, errorMessage: null });
    log("info", "nothing due, exiting", { worker: workerName });
    return;
  }

  const { browser, context } = await launchContext();
  try {
    let newDiscoveredUrls: string[] = [];
    if (discoverUrls) {
      const discoveryPage = await context.newPage();
      try {
        const candidates = await withSingleRetry(() => discoverUrls(discoveryPage));
        const unknownCandidates = [...new Set(candidates)].filter(
          (url) => !knownUrls.has(url) && !newSeedUrls.includes(url),
        );
        const { data: alreadyDiscovered } = await db
          .from("products")
          .select("url")
          .eq("retailer_id", retailer.id)
          .in("url", unknownCandidates.length > 0 ? unknownCandidates : ["__none__"]);
        const alreadyDiscoveredUrls = new Set((alreadyDiscovered ?? []).map((p) => p.url));
        newDiscoveredUrls = unknownCandidates
          .filter((url) => !alreadyDiscoveredUrls.has(url))
          .slice(0, maxNewDiscoveries);
        log("info", "catalog discovery ran", {
          worker: workerName,
          rawCandidates: candidates.length,
          newAfterFilter: newDiscoveredUrls.length,
        });
      } catch (err) {
        log("warn", "catalog discovery failed, continuing without it", {
          worker: workerName,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await discoveryPage.close();
      }
    }

    const workItems: WorkItem[] = [
      ...(dueProducts ?? []).map((product): WorkItem => ({ kind: "recheck", product })),
      ...newSeedUrls.map((url): WorkItem => ({ kind: "discover", url, source: "seed" })),
      ...newDiscoveredUrls.map((url): WorkItem => ({ kind: "discover", url, source: "catalog_crawl" })),
    ];

    log("info", "worker starting", {
      worker: workerName,
      dueCount: dueProducts?.length ?? 0,
      newSeedCount: newSeedUrls.length,
      newDiscoveredCount: newDiscoveredUrls.length,
    });

    if (workItems.length === 0) {
      await writeRunSummary(db, workerName, retailer.id, startedAt, { status: "success", itemsProcessed: 0, errorMessage: null });
      log("info", "nothing due, exiting", { worker: workerName });
      return;
    }

    const result = await runBatch(
      workItems,
      async (item) => {
        const page = await context.newPage();
        try {
          if (item.kind === "recheck") {
            await handleRecheck(db, page, item.product, scrapeProductPage);
          } else {
            await handleDiscover(db, page, retailer.id, item.url, item.source, scrapeProductPage);
          }
        } finally {
          await page.close();
        }
      },
      (item) => (item.kind === "recheck" ? item.product.url : item.url),
    );

    if (discoverUrls) {
      await pruneCatalogCrawlProducts(db, retailer.id, maxCatalogCrawlProducts, workerName);
    }

    await writeRunSummary(db, workerName, retailer.id, startedAt, result);
    log("info", "worker finished", { worker: workerName, ...result });
    if (result.status === "failed") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function handleRecheck(
  db: TypedSupabaseClient,
  page: Page,
  product: Product,
  scrapeProductPage: ScrapeProductPageFn,
): Promise<void> {
  const scraped = await withSingleRetry(() => scrapeProductPage(page, product.url));
  const parsed = scraped.priceText ? parsePrice(scraped.priceText) : null;
  if (!parsed) throw new Error(`could not parse price from "${scraped.priceText}"`);

  const materialChange = isMaterialPriceChange(product.current_price, parsed.amount) || scraped.inStock !== product.in_stock;

  if (materialChange) {
    const { error: insertError } = await db.from("price_history").insert({
      product_id: product.id,
      price: parsed.amount,
      currency: parsed.currency,
      in_stock: scraped.inStock,
    });
    if (insertError) throw new Error(`price_history insert failed: ${insertError.message}`);
  }

  const { data: recent } = await db
    .from("price_history")
    .select("price")
    .eq("product_id", product.id)
    .order("scraped_at", { ascending: false })
    .limit(10);
  const volatility = computeVolatility((recent ?? []).map((r) => r.price));
  const interval = checkIntervalFor(volatility);

  const { error: updateError } = await db
    .from("products")
    .update({
      current_price: parsed.amount,
      in_stock: scraped.inStock,
      volatility_score: volatility,
      check_interval: interval,
      last_checked_at: new Date().toISOString(),
      next_due_at: new Date(Date.now() + intervalToMs(interval)).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", product.id);
  if (updateError) throw new Error(`product update failed: ${updateError.message}`);
}

async function handleDiscover(
  db: TypedSupabaseClient,
  page: Page,
  retailerId: string,
  url: string,
  source: "seed" | "catalog_crawl",
  scrapeProductPage: ScrapeProductPageFn,
): Promise<void> {
  const scraped = await withSingleRetry(() => scrapeProductPage(page, url));
  const parsed = scraped.priceText ? parsePrice(scraped.priceText) : null;
  if (!parsed) throw new Error(`could not parse price from "${scraped.priceText}"`);

  const retailerProductId = url.split("/").filter(Boolean).pop() ?? url;

  const { data: inserted, error: insertError } = await db
    .from("products")
    .insert({
      retailer_id: retailerId,
      retailer_product_id: retailerProductId,
      url,
      title_en: scraped.title,
      current_price: parsed.amount,
      currency: parsed.currency,
      in_stock: scraped.inStock,
      last_checked_at: new Date().toISOString(),
      next_due_at: new Date(Date.now() + intervalToMs("24 hours")).toISOString(),
      source,
    })
    .select()
    .single();
  if (insertError || !inserted) throw new Error(`product insert failed: ${insertError?.message}`);

  const { error: priceError } = await db.from("price_history").insert({
    product_id: inserted.id,
    price: parsed.amount,
    currency: parsed.currency,
    in_stock: scraped.inStock,
  });
  if (priceError) throw new Error(`initial price_history insert failed: ${priceError.message}`);
}

/**
 * Keeps only the newest `maxCount` catalog_crawl-sourced products for a
 * retailer -- 'seed' and 'user_search' rows are never touched, no matter
 * how old, since those are things someone deliberately asked to track
 * (WORKERS.md's per-item isolation rule applies here too: a pruning
 * failure is logged and swallowed, never allowed to fail the whole run).
 */
async function pruneCatalogCrawlProducts(
  db: TypedSupabaseClient,
  retailerId: string,
  maxCount: number,
  workerName: string,
): Promise<void> {
  const { data: crawlProducts, error } = await db
    .from("products")
    .select("id")
    .eq("retailer_id", retailerId)
    .eq("source", "catalog_crawl")
    .order("created_at", { ascending: false });
  if (error) {
    log("warn", "catalog_crawl prune: could not list products", { worker: workerName, error: error.message });
    return;
  }

  const toDelete = (crawlProducts ?? []).slice(maxCount).map((p) => p.id);
  if (toDelete.length === 0) return;

  const { error: deleteError } = await db.from("products").delete().in("id", toDelete);
  if (deleteError) {
    log("warn", "catalog_crawl prune: delete failed", { worker: workerName, error: deleteError.message });
    return;
  }
  log("info", "catalog_crawl prune: removed rotated-out products", { worker: workerName, deleted: toDelete.length });
}

async function writeRunSummary(
  db: TypedSupabaseClient,
  workerName: string,
  retailerId: string,
  startedAt: string,
  result: { status: "success" | "partial" | "failed"; itemsProcessed: number; errorMessage: string | null },
): Promise<void> {
  const { error } = await db.from("worker_runs").insert({
    retailer_id: retailerId,
    worker_name: workerName,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: result.status,
    items_processed: result.itemsProcessed,
    error_message: result.errorMessage,
  });
  if (error) log("error", "failed to write worker_runs summary", { error: error.message });
}
