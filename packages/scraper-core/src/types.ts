import type { Page } from "playwright";

export interface ScrapedProduct {
  title: string;
  priceText: string | null;
  inStock: boolean;
}

export type ScrapeProductPageFn = (page: Page, url: string) => Promise<ScrapedProduct>;
