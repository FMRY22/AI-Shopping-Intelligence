import { runRetailerWorker, log } from "@repo/scraper-core";
import { scrapeProductPage } from "./scrape";
import { SEED_PRODUCT_URLS } from "./seed";
import { discoverProductUrls } from "./discover";

const WORKER_NAME = "worker-amazon";

runRetailerWorker({
  retailerSlug: "amazon_sa",
  workerName: WORKER_NAME,
  seedUrls: SEED_PRODUCT_URLS,
  scrapeProductPage,
  discoverUrls: discoverProductUrls,
}).catch((err) => {
  log("error", "worker crashed", { worker: WORKER_NAME, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
