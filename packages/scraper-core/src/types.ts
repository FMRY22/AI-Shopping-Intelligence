import type { Page } from "playwright";

export interface ScrapedProduct {
  title: string;
  priceText: string | null;
  inStock: boolean;
}

export type ScrapeProductPageFn = (page: Page, url: string) => Promise<ScrapedProduct>;

/**
 * Catalog discovery (PRD.md FR-1): navigates a listing/category/bestseller
 * page and returns candidate product URLs, normalized to each retailer's
 * canonical product-page form so the same product is never discovered
 * twice under two different URLs.
 */
export type DiscoverUrlsFn = (page: Page) => Promise<string[]>;
