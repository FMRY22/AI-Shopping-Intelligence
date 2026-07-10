import type { Page } from "playwright";

/**
 * Tries each selector in priority order and returns the text of the first
 * one that actually matches something on the page, instead of joining them
 * into one comma-separated CSS selector.
 *
 * A joined selector list (`"a, b, c"`) matches in DOM document order, not
 * list-priority order -- Playwright's `.first()` on it can return a later,
 * more general fallback pattern even when an earlier, more specific one
 * also matches elsewhere on the page. That's how a broad `[class*="price"]`
 * fallback ended up grabbing the wrong element on jarir.com (its combined
 * text concatenated the price with an unrelated number, producing a
 * `numeric field overflow` on insert -- see packages/shared/src/price.ts's
 * MAX_PLAUSIBLE_PRICE guard, added as defense-in-depth alongside this fix).
 */
export async function textFromFirstMatch(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;
    const text = (await locator.textContent().catch(() => null))?.trim();
    if (text) return text;
  }
  return null;
}

export async function existsAny(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}
