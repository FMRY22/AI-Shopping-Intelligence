import type { Page } from "playwright";
import type { ScrapedProduct } from "@repo/scraper-core";
import { JARIR_SELECTORS } from "./selectors";

export async function scrapeProductPage(page: Page, url: string): Promise<ScrapedProduct> {
  await page.goto(url, { waitUntil: "commit", timeout: 45_000 });

  const title = (await page.locator(JARIR_SELECTORS.title).first().textContent().catch(() => null))?.trim();
  if (!title) {
    throw new Error("could not read product title -- selectors.ts may be stale, see its header comment");
  }

  const priceText = (await page.locator(JARIR_SELECTORS.price).first().textContent().catch(() => null))?.trim() ?? null;
  const outOfStockCount = await page.locator(JARIR_SELECTORS.outOfStock).count();

  return { title, priceText, inStock: outOfStockCount === 0 };
}
