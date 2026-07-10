import { runRetailerWorker, log } from "@repo/scraper-core";
import { scrapeProductPage } from "./scrape";
import { SEED_PRODUCT_URLS } from "./seed";

const WORKER_NAME = "worker-extra";

runRetailerWorker({
  retailerSlug: "extra",
  workerName: WORKER_NAME,
  seedUrls: SEED_PRODUCT_URLS,
  scrapeProductPage,
}).catch((err) => {
  log("error", "worker crashed", { worker: WORKER_NAME, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
