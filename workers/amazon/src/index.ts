import { runRetailerWorker, log } from "@repo/scraper-core";
import { scrapeProductPage } from "./scrape";
import { SEED_PRODUCT_URLS } from "./seed";
// Bestseller catalog-crawl discovery (./discover.ts) is intentionally not
// wired in: the founder wants the catalog to hold only what was deliberately
// seeded or found via a live search (apps/web's POST /api/track), not
// unrelated products a bestseller crawl happened to surface. The capability
// still exists in ./discover.ts and packages/scraper-core's discoverUrls
// support if this is revisited later.

const WORKER_NAME = "worker-amazon";

runRetailerWorker({
  retailerSlug: "amazon_sa",
  workerName: WORKER_NAME,
  seedUrls: SEED_PRODUCT_URLS,
  scrapeProductPage,
}).catch((err) => {
  log("error", "worker crashed", { worker: WORKER_NAME, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
