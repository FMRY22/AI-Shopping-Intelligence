import type { Page } from "playwright";
import { createServiceClient } from "@repo/database";
import type { Product } from "@repo/database";
import { launchContext, log, runBatch, withSingleRetry } from "@repo/scraper-core";
import { parsePrice } from "@repo/shared";
import { scrapeProductPage } from "./scrape";
import { SEED_PRODUCT_URLS } from "./seed";
import { checkIntervalFor, computeVolatility, isMaterialPriceChange } from "./price-hunter";

const RETAILER_SLUG = "noon";
const WORKER_NAME = "worker-noon";
const BATCH_LIMIT = 25; // WORKERS.md §3.2

type WorkItem = { kind: "recheck"; product: Product } | { kind: "discover"; url: string };

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const db = createServiceClient();

  const { data: retailer, error: retailerError } = await db
    .from("retailers")
    .select("*")
    .eq("slug", RETAILER_SLUG)
    .single();
  if (retailerError || !retailer) {
    throw new Error(`could not load retailer '${RETAILER_SLUG}': ${retailerError?.message}`);
  }

  const { data: dueProducts, error: dueError } = await db.rpc("get_due_items", {
    p_retailer_slug: RETAILER_SLUG,
    p_limit: BATCH_LIMIT,
  });
  if (dueError) throw new Error(`get_due_items failed: ${dueError.message}`);

  const { data: existingByUrl } = await db
    .from("products")
    .select("url")
    .eq("retailer_id", retailer.id)
    .in("url", SEED_PRODUCT_URLS.length > 0 ? SEED_PRODUCT_URLS : ["__none__"]);
  const knownUrls = new Set((existingByUrl ?? []).map((p) => p.url));
  const newSeedUrls = SEED_PRODUCT_URLS.filter((url) => !knownUrls.has(url));

  const workItems: WorkItem[] = [
    ...(dueProducts ?? []).map((product): WorkItem => ({ kind: "recheck", product })),
    ...newSeedUrls.map((url): WorkItem => ({ kind: "discover", url })),
  ];

  log("info", "worker starting", { worker: WORKER_NAME, dueCount: dueProducts?.length ?? 0, newCount: newSeedUrls.length });

  if (workItems.length === 0) {
    await writeRunSummary(db, retailer.id, startedAt, { status: "success", itemsProcessed: 0, errorMessage: null });
    log("info", "nothing due, exiting", { worker: WORKER_NAME });
    return;
  }

  const { browser, context } = await launchContext();
  try {
    const result = await runBatch(
      workItems,
      async (item) => {
        const page = await context.newPage();
        try {
          if (item.kind === "recheck") {
            await handleRecheck(db, page, item.product);
          } else {
            await handleDiscover(db, page, retailer.id, item.url);
          }
        } finally {
          await page.close();
        }
      },
      (item) => (item.kind === "recheck" ? item.product.url : item.url),
    );

    await writeRunSummary(db, retailer.id, startedAt, result);
    log("info", "worker finished", { worker: WORKER_NAME, ...result });
    if (result.status === "failed") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function handleRecheck(
  db: ReturnType<typeof createServiceClient>,
  page: Page,
  product: Product,
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
  db: ReturnType<typeof createServiceClient>,
  page: Page,
  retailerId: string,
  url: string,
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

async function writeRunSummary(
  db: ReturnType<typeof createServiceClient>,
  retailerId: string,
  startedAt: string,
  result: { status: "success" | "partial" | "failed"; itemsProcessed: number; errorMessage: string | null },
): Promise<void> {
  const { error } = await db.from("worker_runs").insert({
    retailer_id: retailerId,
    worker_name: WORKER_NAME,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: result.status,
    items_processed: result.itemsProcessed,
    error_message: result.errorMessage,
  });
  if (error) log("error", "failed to write worker_runs summary", { error: error.message });
}

function intervalToMs(interval: string): number {
  const match = /^(\d+)\s*hours?$/.exec(interval.trim());
  const hours = match?.[1] ? Number.parseInt(match[1], 10) : 24;
  return hours * 60 * 60 * 1000;
}

main().catch((err) => {
  log("error", "worker crashed", { worker: WORKER_NAME, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
