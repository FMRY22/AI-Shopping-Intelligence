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
// Per-selector wait: long enough for a client-rendered page's JS to paint
// the element (goto() uses waitUntil: "commit", which doesn't wait for
// content -- see scrape.ts in each worker), short enough that trying
// several candidates in sequence doesn't blow the job's overall timeout.
const PER_SELECTOR_TIMEOUT_MS = 10_000;

export async function textFromFirstMatch(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    // .textContent() with an explicit timeout auto-waits for the element to
    // attach (unlike .count(), which reads the DOM instantly and returns 0
    // if a client-rendered page hasn't painted the element yet -- that
    // false-negative is what made every selector look like "no match" and
    // made the title lookup fail outright during this worker's second real
    // run against jarir.com, 2026-07-10).
    const text = (
      await page
        .locator(selector)
        .first()
        .textContent({ timeout: PER_SELECTOR_TIMEOUT_MS })
        .catch(() => null)
    )?.trim();
    if (text) return text;
  }
  return null;
}

export async function existsAny(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    // A short, explicit wait (not .count()'s instant read) so a
    // client-rendered "out of stock" badge that hasn't painted yet isn't
    // mistaken for "in stock" -- but short, since absence is the common,
    // expected case (most products are in stock) and we don't want every
    // successful scrape paying this wait for something that legitimately
    // isn't there.
    const found = await page
      .locator(selector)
      .first()
      .waitFor({ state: "attached", timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (found) return true;
  }
  return false;
}
