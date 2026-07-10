import type { Page } from "playwright";
import { textFromFirstMatch, existsAny, type ScrapedProduct } from "@repo/scraper-core";
import { NOON_SELECTORS } from "./selectors";

export async function scrapeProductPage(page: Page, url: string): Promise<ScrapedProduct> {
  // "commit" (navigation started, first byte received) rather than
  // "domcontentloaded" -- noon.com is a heavy client-rendered page and the
  // full DOMContentLoaded event was timing out at 20s from a GitHub Actions
  // runner. The subsequent locator calls below have their own timeouts and
  // wait for the actual elements to appear, which is what we need anyway.
  await page.goto(url, { waitUntil: "commit", timeout: 45_000 });

  const title = await textFromFirstMatch(page, NOON_SELECTORS.title);
  if (!title) {
    throw new Error("could not read product title -- selectors.ts may be stale, see its header comment");
  }

  const priceText = await textFromFirstMatch(page, NOON_SELECTORS.price);
  const inStock = !(await existsAny(page, NOON_SELECTORS.outOfStock));

  return { title, priceText, inStock };
}
