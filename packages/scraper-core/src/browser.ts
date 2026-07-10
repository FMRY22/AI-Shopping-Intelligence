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
    // Works around net::ERR_HTTP2_PROTOCOL_ERROR seen against some sites'
    // WAF/CDN layer when headless Chromium negotiates HTTP/2 -- falls back
    // to HTTP/1.1, which is otherwise functionally equivalent for scraping.
    // Confirmed necessary against noon.com during this worker's first real
    // run (GitHub Actions, 2026-07-10).
    args: ["--disable-http2"],
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
  });
  context.setDefaultTimeout(DEFAULT_NAV_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS);
  return { browser, context };
}
