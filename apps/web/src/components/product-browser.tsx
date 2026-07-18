"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Product, Retailer } from "@repo/database";
import { findMatchingGroupKey, groupProducts } from "@/lib/product-groups";

interface LiveResult {
  retailerSlug: string;
  url: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
}

const RETAILER_LABELS: Record<string, string> = {
  amazon_sa: "Amazon.sa",
  jarir: "Jarir",
  extra: "extra",
  noon: "noon",
};

function retailerLabel(slug: string): string {
  return RETAILER_LABELS[slug] ?? slug;
}

// Biggest gap between the cheapest and priciest tracked retailer for one
// product -- the "sort by savings" option (founder-requested, 2026-07-18):
// products with the widest spread are where picking the right store
// matters most. Single-retailer groups have nothing to compare, hence 0.
function groupSavings(items: Product[]): number {
  const prices = items.map((p) => p.current_price).filter((p): p is number => p != null);
  if (prices.length < 2) return 0;
  return Math.max(...prices) - Math.min(...prices);
}

// Not a plain <img>: a broken or still-pending <img src> renders its alt
// text at natural size in a way that escapes normal box clipping in
// Chromium -- confirmed via a local screenshot where a network-blocked
// image's full title text overflowed well outside the placeholder box no
// matter what container CSS (overflow-hidden, absolute positioning) was
// applied. A CSS background-image has no alt-text fallback to escape with,
// so the fix is to probe-load the URL off-DOM first (a detached Image()
// object) and only switch to a background-image once it's confirmed to
// have loaded successfully; until then (or on failure) the SVG placeholder
// is all that's ever in the visible tree. Also why not next/image: product
// images come from whatever CDN each retailer happens to use (Amazon's
// media CDN, Jarir's Akeneo asset host, extra's...), which next/image
// would need enumerated up front in next.config's remotePatterns and
// breaks silently if a retailer changes hosts.
function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    setLoadedSrc(null);
    if (!src) return;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => setLoadedSrc(src);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  const showPlaceholder = loadedSrc !== src;

  return (
    <div
      role="img"
      aria-label={alt}
      className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-50 dark:bg-white/5"
    >
      {showPlaceholder ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          className="absolute inset-0 m-auto h-10 w-10 text-gray-300 dark:text-white/15"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="M21 15l-5-5-9 9" />
        </svg>
      ) : (
        <div
          style={{ backgroundImage: `url(${loadedSrc})` }}
          className="absolute inset-3 bg-contain bg-center bg-no-repeat"
        />
      )}
    </div>
  );
}

function PriceTag({
  price,
  currency,
  highlight,
  small,
}: {
  price: number | null;
  currency: string;
  highlight?: boolean;
  small?: boolean;
}) {
  if (price == null) return <span className="text-sm text-gray-400 dark:text-white/40">—</span>;
  return (
    <span
      className={`${small ? "text-sm" : "text-lg"} font-bold ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}
    >
      {price.toLocaleString()} <span className="text-xs font-medium text-gray-400 dark:text-white/40">{currency}</span>
    </span>
  );
}

function RetailerBadge({ slug }: { slug: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
      {retailerLabel(slug)}
    </span>
  );
}

function StockPill({ inStock }: { inStock: boolean }) {
  return (
    <span
      className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur-sm ${
        inStock
          ? "bg-emerald-500/90 text-white"
          : "bg-gray-900/80 text-white dark:bg-white/80 dark:text-gray-900"
      }`}
    >
      {inStock ? "In stock" : "Out of stock"}
    </span>
  );
}

// A small icon-link on an already-tracked live-result row, straight to that
// product's detail page -- founder feedback (2026-07-18): "اضغط عليها
// بعدين يفتح لي صفحة فيها تراكر" (click it, then a page opens with a
// tracker). Replaces the old small popup modal, which wasn't a real
// destination.
function HistoryLink({ groupKey }: { groupKey: string }) {
  return (
    <Link
      href={`/products/${encodeURIComponent(groupKey)}`}
      aria-label="View product"
      className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="m7 14 4-4 3 3 5-6" />
      </svg>
    </Link>
  );
}

// Card-scale "track this product" action -- founder feedback (2026-07-18):
// "it's supposed to be search -- if I favorite it, it favorites the
// product; the retailer is just where to buy it." Favoriting used to be a
// per-retailer-row button; now it's one action for the whole card that
// tracks every retailer currently shown for that product at once (loop
// POST /api/favorite, all sharing the same group_key -- see
// ProductBrowser's favoriteAll). A full-width button reads more clearly as
// "one decision for this product" than N small per-row buttons would.
function TrackAllButton({
  status,
  onClick,
}: {
  status: "idle" | "saving" | "saved" | "error";
  onClick: () => void;
}) {
  const label =
    status === "saved"
      ? "Tracking / تتم متابعته"
      : status === "saving"
        ? "Saving… / جارِ الحفظ..."
        : status === "error"
          ? "Retry / أعد المحاولة"
          : "Track this product / تابع هذا المنتج";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "saving" || status === "saved"}
      className={`mt-3 flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition disabled:cursor-default ${
        status === "saved"
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
          : status === "error"
            ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
            : "bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      }`}
    >
      {status === "saving" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {status === "saved" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {label}
    </button>
  );
}

// A compact preview, not the full comparison -- founder feedback
// (2026-07-18): "المفترض منتج اضغط عليها بعدين يفتح لي صفحة فيها تراكر
// ووين اشتريه منه يرتبه بالارخص" (I click a product, then a page opens with
// a tracker and where to buy it ranked cheapest). The retailer-by-retailer
// ranking, price history, and buy/wait signal all live on that page
// (/products/[key], apps/web/src/components/product-detail.tsx) now --
// this card is just the entry point into it, showing the best price found
// and how many stores carry it.
function TrackedProductGroupCard({
  group,
  retailerSlugById,
}: {
  group: { key: string; items: Product[]; title: string };
  retailerSlugById: Record<string, string>;
}) {
  const hero = group.items[0]!;
  return (
    <Link
      href={`/products/${encodeURIComponent(group.key)}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="relative">
        <ProductImage src={hero.image_url} alt={group.title} />
        <StockPill inStock={group.items.some((p) => p.in_stock)} />
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 dark:text-white">{group.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RetailerBadge slug={retailerSlugById[hero.retailer_id] ?? "?"} />
        <PriceTag price={hero.current_price} currency={hero.currency} />
      </div>
      {group.items.length > 1 && (
        <p className="mt-1 text-[11px] text-gray-400 dark:text-white/30">
          {group.items.length} stores / {group.items.length} متاجر
        </p>
      )}
    </Link>
  );
}

// Every retailer's hit for one search is one product being compared, not N
// unrelated cards -- founder feedback (2026-07-18): "I search, click the
// product, [want to] see everywhere it's sold and each price." `results`
// must already be sorted cheapest-first by the caller. A row only gets a
// link to the detail page once it's actually tracked (`trackedByUrl`
// match) -- price history only starts accumulating from the moment of
// favoriting, so there's nothing to show on that page before then.
//
// Favoriting is a single card-level action (TrackAllButton), not a
// per-retailer-row button -- founder feedback (2026-07-18): "it's supposed
// to be search -- if I favorite it, it favorites the product." One tap
// tracks every retailer currently shown for this product at once.
function LiveResultGroupCard({
  results,
  status,
  onTrackAll,
  trackedByUrl,
}: {
  results: LiveResult[];
  status: "idle" | "saving" | "saved" | "error";
  onTrackAll: () => void;
  trackedByUrl: Record<string, Product>;
}) {
  const hero = results[0]!;
  const cheapestPrice = Math.min(...results.map((r) => r.price));
  const allTracked = results.every((r) => trackedByUrl[r.url]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]">
      <a href={hero.url} target="_blank" rel="noreferrer" className="block">
        <ProductImage src={hero.imageUrl} alt={hero.title} />
      </a>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 dark:text-white">{hero.title}</p>
      <div className="mt-2 flex flex-col divide-y divide-gray-50 dark:divide-white/5">
        {results.map((result) => {
          const tracked = trackedByUrl[result.url];
          return (
            <div key={`${result.retailerSlug}:${result.url}`} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
              <a href={result.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2">
                <RetailerBadge slug={result.retailerSlug} />
                <PriceTag price={result.price} currency={result.currency} highlight={result.price === cheapestPrice} small />
              </a>
              {tracked &&
                (() => {
                  const specs = tracked.specs as { group_key?: string } | null;
                  return <HistoryLink groupKey={specs?.group_key || tracked.id} />;
                })()}
            </div>
          );
        })}
      </div>
      <TrackAllButton status={allTracked ? "saved" : status} onClick={onTrackAll} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
      <span className="h-2 w-2 rounded-full bg-indigo-500" />
      {children}
    </p>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// The search box does two independent things, both always available, never
// one gating the other:
// 1. As you type, GET /api/search (debounced) instantly shows anything
//    already tracked/favorited that matches -- a local DB lookup.
// 2. Pressing Enter or the search button always runs POST /api/track live
//    against the retailers themselves, regardless of what step 1 found.
// Live results are shown separately and are NOT saved automatically -- the
// founder wants tracking to require a deliberate "favorite" action per
// result (POST /api/favorite), not just showing up in a search.
export function ProductBrowser({
  initialProducts,
  retailers,
}: {
  initialProducts: Product[];
  retailers: Retailer[];
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [isSearching, setIsSearching] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [liveFavoriteStatus, setLiveFavoriteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [trackedSort, setTrackedSort] = useState<"recent" | "savings">("recent");

  const retailerSlugById = useMemo(() => Object.fromEntries(retailers.map((r) => [r.id, r.slug])), [retailers]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setProducts(initialProducts);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ products?: Product[]; error?: string }>)
        .then((data) => setProducts(data.products ?? []))
        .catch((err: unknown) => {
          if (err instanceof Error && err.name !== "AbortError") console.error(err);
        })
        .finally(() => setIsSearching(false));
    }, 250); // debounce -- avoid a request on every keystroke

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function searchLive() {
    const trimmed = query.trim();
    if (!trimmed || isTracking) return;
    setIsTracking(true);
    setTrackError(null);
    setLiveResults([]);
    setLiveFavoriteStatus("idle");
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
    })
      .then((res) => res.json() as Promise<{ results?: LiveResult[]; error?: string }>)
      .then((data) => {
        if (data.error) {
          setTrackError(data.error);
          return;
        }
        setLiveResults(data.results ?? []);
      })
      .catch((err: unknown) => setTrackError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsTracking(false));
  }

  // Tracks every retailer currently shown for this product at once, not one
  // at a time -- founder feedback (2026-07-18): "it's supposed to be
  // search -- if I favorite it, it favorites the product; the retailer is
  // just where to buy it."
  //
  // Each result's group_key is resolved independently: first, check whether
  // its title actually matches something already tracked (findMatchingGroupKey
  // -- founder feedback, same day: "اكيد ينباع المنتج في اكثر من مكان...
  // لازم تصنف بذكائك حسب المواصفات," a product surely sells in more than one
  // place, classify it smartly by spec) so favoriting it from a *different*
  // search than the one that first tracked it still lands in the same group.
  // Only falls back to the normalized-query key when nothing existing
  // matches, which is also what keeps multiple genuinely-new results from
  // this same search grouped with each other.
  function favoriteAll(results: LiveResult[]) {
    const fallbackGroupKey = query.trim().toLowerCase().replace(/\s+/g, " ");
    setLiveFavoriteStatus("saving");
    Promise.all(
      results.map((result) => {
        const groupKey = findMatchingGroupKey(result.title, products) ?? fallbackGroupKey;
        return fetch("/api/favorite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...result, groupKey }),
        }).then((res) => res.json() as Promise<{ product?: Product; error?: string }>);
      }),
    )
      .then((responses) => {
        const succeeded = responses.filter((r): r is { product: Product } => !!r.product);
        setLiveFavoriteStatus(succeeded.length === results.length ? "saved" : "error");
        if (succeeded.length === 0) return;
        setProducts((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const { product } of succeeded) byId.set(product.id, product);
          return Array.from(byId.values());
        });
      })
      .catch(() => setLiveFavoriteStatus("error"));
  }

  // Lets a live-result row link straight to the detail page the moment
  // it's tracked, without a page reload -- favoriteAll() already merges the
  // new rows into `products`, so this just needs to stay in sync with that.
  const trackedByUrl = useMemo(() => {
    const map: Record<string, Product> = {};
    for (const p of products) map[p.url] = p;
    return map;
  }, [products]);

  const trackedGroups = useMemo(() => groupProducts(products), [products]);

  // "Biggest gap" sort (founder-requested, 2026-07-18): surfaces the
  // products where picking the right store saves the most, instead of
  // always ordering by most-recently-favorited.
  const sortedTrackedGroups = useMemo(() => {
    if (trackedSort === "recent") return trackedGroups;
    return [...trackedGroups].sort((a, b) => groupSavings(b.items) - groupSavings(a.items));
  }, [trackedGroups, trackedSort]);

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500 dark:text-white/40">
        Search retailers live, favorite what you want to track. / ابحث في المتاجر مباشرة، وتابع اللي يعجبك.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchLive();
        }}
        className="flex gap-2"
      >
        <div className="relative w-full">
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-gray-400 dark:text-white/40">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products... / ابحث عن منتج..."
            dir="auto"
            className="w-full rounded-full border border-gray-200 bg-white py-3.5 pl-11 pr-4 text-[15px] text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-indigo-400"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || isTracking}
          className="shrink-0 rounded-full bg-indigo-600 px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-default disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {isTracking ? "…" : "Search live / ابحث"}
        </button>
      </form>

      {isSearching && <p className="mt-2 text-xs text-gray-400 dark:text-white/30">Checking your list…</p>}

      {isTracking && (
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-white/50">
          Searching retailers live… (~30s) / جاري البحث الحي في المتاجر... (قد يأخذ ٣٠ ثانية)
        </p>
      )}

      {trackError && <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">{trackError}</p>}

      {!isTracking && liveResults.length === 0 && query.trim() && trackError === null && (
        <p className="mt-2 text-xs text-gray-400 dark:text-white/30">
          Press &quot;Search live&quot; to check retailers directly. / اضغط "ابحث" للبحث المباشر بالمتاجر.
        </p>
      )}

      {liveResults.length > 0 && (
        <div className="mt-8">
          <SectionLabel>Live results — tap Track to follow / نتائج حية — اضغط تابع للمتابعة</SectionLabel>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <LiveResultGroupCard
              results={[...liveResults].sort((a, b) => a.price - b.price)}
              status={liveFavoriteStatus}
              onTrackAll={() => favoriteAll(liveResults)}
              trackedByUrl={trackedByUrl}
            />
          </div>
        </div>
      )}

      <div className="mt-8">
        {trackedGroups.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Tracked / متابَع</SectionLabel>
            <div className="flex items-center gap-1 rounded-full bg-gray-100 p-0.5 text-[11px] font-medium dark:bg-white/5">
              {(["recent", "savings"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTrackedSort(mode)}
                  className={`rounded-full px-2.5 py-1 transition ${
                    trackedSort === mode
                      ? "bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/70"
                  }`}
                >
                  {mode === "recent" ? "Recent / الأحدث" : "Biggest gap / أكبر فرق"}
                </button>
              ))}
            </div>
          </div>
        )}

        {trackedGroups.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-white/10 dark:text-white/30">
            Nothing tracked yet — search above and tap the star to start. / ولا شي متابَع لسا — ابحث فوق واضغط النجمة عشان تبدأ.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sortedTrackedGroups.map((group) => (
              <TrackedProductGroupCard key={group.key} group={group} retailerSlugById={retailerSlugById} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
