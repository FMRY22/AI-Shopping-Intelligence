"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product, Retailer } from "@repo/database";
import { PriceHistoryModal } from "@/components/price-history-chart";

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

// Small ghost icon button for an inline retailer row (chart / remove /
// favorite) -- live search results and tracked products both render as one
// grouped card with a row per retailer (founder feedback, 2026-07-18: "I
// search, click the product, see everywhere it's sold and each price" --
// showing that comparison is the point, not a secondary detail per flat
// card), so every row-level action lives inline instead of overlaid on a
// shared image the way a single-action card could get away with before.
function RowIconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="m7 14 4-4 3 3 5-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7h14Z" />
    </svg>
  );
}

// Row-scale favorite action for a live-result row -- same state machine as
// the old floating FavoriteButton, just sized/styled to sit next to
// RowIconButton instead of overlaid on the image.
function RowFavoriteButton({
  status,
  onClick,
}: {
  status: "idle" | "saving" | "saved" | "error";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "saving" || status === "saved"}
      aria-label="Favorite"
      className={`flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-default ${
        status === "saved"
          ? "bg-indigo-600 text-white"
          : status === "error"
            ? "bg-red-500 text-white"
            : "text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
      }`}
    >
      {status === "saving" ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : status === "saved" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : status === "error" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
          <path d="M12 5v9M12 18v.01" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
          <path d="M12 17.3 6.2 21l1.5-6.6L2.5 9.9l6.7-.6L12 3l2.8 6.3 6.7.6-5.2 4.5 1.5 6.6z" />
        </svg>
      )}
    </button>
  );
}

// One product, tracked across however many retailers the founder favorited
// it from -- founder feedback (2026-07-18): favoriting the same product
// from multiple retailers was rendering as separate, unrelated cards
// instead of one card comparing them. The image/title come from the
// cheapest item (`items[0]`, pre-sorted by the caller); every retailer gets
// its own row below with its own price, history, and remove action, since
// each retailer's listing has its own independent price_history series.
function TrackedProductGroupCard({
  items,
  retailerSlugById,
  onShowHistory,
  onRemove,
}: {
  items: Product[];
  retailerSlugById: Record<string, string>;
  onShowHistory: (product: Product) => void;
  onRemove: (product: Product) => void;
}) {
  const hero = items[0]!;
  const cheapestPrice = items.reduce<number | null>((min, p) => {
    if (p.current_price == null) return min;
    return min == null ? p.current_price : Math.min(min, p.current_price);
  }, null);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]">
      <div className="relative">
        <a href={hero.url} target="_blank" rel="noreferrer" className="block">
          <ProductImage src={hero.image_url} alt={hero.title_en} />
        </a>
        <StockPill inStock={items.some((p) => p.in_stock)} />
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 dark:text-white">{hero.title_en}</p>
      <div className="mt-2 flex flex-col divide-y divide-gray-50 dark:divide-white/5">
        {items.map((product) => (
          <div key={product.id} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
            <a href={product.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2">
              <RetailerBadge slug={retailerSlugById[product.retailer_id] ?? "?"} />
              <PriceTag
                price={product.current_price}
                currency={product.currency}
                highlight={cheapestPrice != null && product.current_price === cheapestPrice}
                small
              />
            </a>
            <div className="flex shrink-0 items-center gap-0.5">
              <RowIconButton onClick={() => onShowHistory(product)} label="Price history">
                <HistoryIcon />
              </RowIconButton>
              <RowIconButton onClick={() => onRemove(product)} label="Remove">
                <TrashIcon />
              </RowIconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Every retailer's hit for one search is one product being compared, not N
// unrelated cards -- founder feedback (2026-07-18): "I search, click the
// product, [want to] see everywhere it's sold and each price." `results`
// must already be sorted cheapest-first by the caller (same convention as
// TrackedProductGroupCard's `items`). A row only gets a history icon once
// it's actually tracked (`trackedByUrl` match) -- price history only starts
// accumulating from the moment of favoriting, so showing the icon earlier
// would open a chart with nothing in it.
function LiveResultGroupCard({
  results,
  favoriteStatus,
  onFavorite,
  trackedByUrl,
  onShowHistory,
}: {
  results: LiveResult[];
  favoriteStatus: Record<string, "idle" | "saving" | "saved" | "error">;
  onFavorite: (result: LiveResult) => void;
  trackedByUrl: Record<string, Product>;
  onShowHistory: (product: Product) => void;
}) {
  const hero = results[0]!;
  const cheapestPrice = Math.min(...results.map((r) => r.price));

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]">
      <a href={hero.url} target="_blank" rel="noreferrer" className="block">
        <ProductImage src={hero.imageUrl} alt={hero.title} />
      </a>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 dark:text-white">{hero.title}</p>
      <div className="mt-2 flex flex-col divide-y divide-gray-50 dark:divide-white/5">
        {results.map((result) => {
          const tracked = trackedByUrl[result.url];
          // Already-tracked rows (from a previous session, or just favorited
          // in this one) always read as "saved" -- favoriteStatus only knows
          // about actions taken in the current session, but trackedByUrl is
          // the actual source of truth for whether it's being followed.
          const status = tracked ? "saved" : (favoriteStatus[result.url] ?? "idle");
          return (
            <div key={`${result.retailerSlug}:${result.url}`} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
              <a href={result.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2">
                <RetailerBadge slug={result.retailerSlug} />
                <PriceTag price={result.price} currency={result.currency} highlight={result.price === cheapestPrice} small />
              </a>
              <div className="flex shrink-0 items-center gap-0.5">
                {tracked && (
                  <RowIconButton onClick={() => onShowHistory(tracked)} label="Price history">
                    <HistoryIcon />
                  </RowIconButton>
                )}
                <RowFavoriteButton status={status} onClick={() => onFavorite(result)} />
              </div>
            </div>
          );
        })}
      </div>
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
  const [favoriteStatus, setFavoriteStatus] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [historyProduct, setHistoryProduct] = useState<{ id: string; title: string; currency: string } | null>(null);

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
    setFavoriteStatus({});
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

  function favorite(result: LiveResult) {
    // Everything favorited out of the same live search shares a group_key
    // (the normalized query), so it renders as one grouped card instead of
    // scattered singles -- founder feedback, 2026-07-18.
    const groupKey = query.trim().toLowerCase().replace(/\s+/g, " ");
    setFavoriteStatus((prev) => ({ ...prev, [result.url]: "saving" }));
    fetch("/api/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...result, groupKey }),
    })
      .then((res) => res.json() as Promise<{ product?: Product; error?: string }>)
      .then((data) => {
        if (data.error || !data.product) {
          setFavoriteStatus((prev) => ({ ...prev, [result.url]: "error" }));
          return;
        }
        setFavoriteStatus((prev) => ({ ...prev, [result.url]: "saved" }));
        setProducts((prev) => [data.product!, ...prev.filter((p) => p.id !== data.product!.id)]);
      })
      .catch(() => setFavoriteStatus((prev) => ({ ...prev, [result.url]: "error" })));
  }

  function removeProduct(product: Product) {
    const confirmed = window.confirm(
      `Remove "${product.title_en}" from tracked? / إزالة "${product.title_en}" من المتابَعة؟`,
    );
    if (!confirmed) return;
    fetch(`/api/favorite?productId=${encodeURIComponent(product.id)}`, { method: "DELETE" })
      .then((res) => res.json() as Promise<{ ok?: boolean; error?: string }>)
      .then((data) => {
        if (data.error) {
          console.error(data.error);
          return;
        }
        setProducts((prev) => prev.filter((p) => p.id !== product.id));
        setHistoryProduct((prev) => (prev?.id === product.id ? null : prev));
      })
      .catch((err: unknown) => console.error(err));
  }

  // Lets a live-result row show a history icon the moment it's tracked,
  // without a page reload -- favorite() already prepends the new row to
  // `products`, so this just needs to stay in sync with that.
  const trackedByUrl = useMemo(() => {
    const map: Record<string, Product> = {};
    for (const p of products) map[p.url] = p;
    return map;
  }, [products]);

  // Groups favorited items by the search they were favorited from (see
  // `favorite()`), falling back to the product's own id so anything without
  // a group_key (favorited before this feature, or favorited alone) still
  // renders as its own single-item group. Sorted cheapest-first within a
  // group so `items[0]` is always the hero/cheapest for display.
  const trackedGroups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products) {
      const specs = product.specs as { group_key?: string } | null;
      const key = specs?.group_key || product.id;
      const list = map.get(key);
      if (list) list.push(product);
      else map.set(key, [product]);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      items: [...items].sort((a, b) => (a.current_price ?? Infinity) - (b.current_price ?? Infinity)),
    }));
  }, [products]);

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
          <SectionLabel>Live results — tap Favorite to track / نتائج حية — اضغط تفضيل للمتابعة</SectionLabel>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <LiveResultGroupCard
              results={[...liveResults].sort((a, b) => a.price - b.price)}
              favoriteStatus={favoriteStatus}
              onFavorite={favorite}
              trackedByUrl={trackedByUrl}
              onShowHistory={(product) =>
                setHistoryProduct({ id: product.id, title: product.title_en, currency: product.currency })
              }
            />
          </div>
        </div>
      )}

      <div className="mt-8">
        {trackedGroups.length > 0 && <SectionLabel>Tracked / متابَع</SectionLabel>}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {trackedGroups.map((group) => (
            <TrackedProductGroupCard
              key={group.key}
              items={group.items}
              retailerSlugById={retailerSlugById}
              onShowHistory={(product) =>
                setHistoryProduct({ id: product.id, title: product.title_en, currency: product.currency })
              }
              onRemove={removeProduct}
            />
          ))}
        </div>
      </div>

      {historyProduct && (
        <PriceHistoryModal
          productId={historyProduct.id}
          title={historyProduct.title}
          currency={historyProduct.currency}
          onClose={() => setHistoryProduct(null)}
        />
      )}
    </div>
  );
}
