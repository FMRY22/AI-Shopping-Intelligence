import { chromium, type Browser, type BrowserContext } from "playwright";

// A standard, honest desktop-browser identity -- not spoofing a different
// tool's fingerprint, per WORKERS.md §8's politeness policy.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_NAV_TIMEOUT_MS = 20_000;

export async function launchContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    headless: true,
    proxy: proxyServer ? { server: proxyServer } : undefined,
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
  });
  context.setDefaultTimeout(DEFAULT_NAV_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS);
  return { browser, context };
}
