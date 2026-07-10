import type { Page } from "playwright";
import type { ScrapedProduct } from "@repo/scraper-core";
import { NOON_SELECTORS } from "./selectors";

export async function scrapeProductPage(page: Page, url: string): Promise<ScrapedProduct> {
  // "commit" (navigation started, first byte received) rather than
  // "domcontentloaded" -- noon.com is a heavy client-rendered page and the
  // full DOMContentLoaded event was timing out at 20s from a GitHub Actions
  // runner. The subsequent locator calls below have their own timeouts and
  // wait for the actual elements to appear, which is what we need anyway.
  await page.goto(url, { waitUntil: "commit", timeout: 45_000 });

  const title = (await page.locator(NOON_SELECTORS.title).first().textContent().catch(() => null))?.trim();
  if (!title) {
    throw new Error("could not read product title -- selectors.ts may be stale, see its header comment");
  }

  const priceText = (await page.locator(NOON_SELECTORS.price).first().textContent().catch(() => null))?.trim() ?? null;
  const outOfStockCount = await page.locator(NOON_SELECTORS.outOfStock).count();

  return { title, priceText, inStock: outOfStockCount === 0 };
}
