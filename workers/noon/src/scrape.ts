import type { Page } from "playwright";
import { NOON_SELECTORS } from "./selectors";

export interface ScrapedProduct {
  title: string;
  priceText: string | null;
  inStock: boolean;
}

export async function scrapeProductPage(page: Page, url: string): Promise<ScrapedProduct> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const title = (await page.locator(NOON_SELECTORS.title).first().textContent().catch(() => null))?.trim();
  if (!title) {
    throw new Error("could not read product title -- selectors.ts may be stale, see its header comment");
  }

  const priceText = (await page.locator(NOON_SELECTORS.price).first().textContent().catch(() => null))?.trim() ?? null;
  const outOfStockCount = await page.locator(NOON_SELECTORS.outOfStock).count();

  return { title, priceText, inStock: outOfStockCount === 0 };
}
