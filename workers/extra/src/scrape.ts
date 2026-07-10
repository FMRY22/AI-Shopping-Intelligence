import type { Page } from "playwright";
import { textFromFirstMatch, existsAny, type ScrapedProduct } from "@repo/scraper-core";
import { EXTRA_SELECTORS } from "./selectors";

export async function scrapeProductPage(page: Page, url: string): Promise<ScrapedProduct> {
  await page.goto(url, { waitUntil: "commit", timeout: 45_000 });

  const title = await textFromFirstMatch(page, EXTRA_SELECTORS.title);
  if (!title) {
    throw new Error("could not read product title -- selectors.ts may be stale, see its header comment");
  }

  const priceText = await textFromFirstMatch(page, EXTRA_SELECTORS.price);
  const inStock = !(await existsAny(page, EXTRA_SELECTORS.outOfStock));

  return { title, priceText, inStock };
}
