"use client";

import { useEffect, useState } from "react";
import type { Product } from "@repo/database";
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
}: {
  price: number | null;
  currency: string;
  highlight?: boolean;
}) {
  if (price == null) return <span className="text-sm text-gray-400 dark:text-white/40">—</span>;
  return (
    <span className={`text-lg font-bold ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>
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

// Marks the cheapest of the current live results, so "where's the best
// price" (PRD.md §1, item 3) is a glance instead of eyeballing every card's
// price -- only shown when there's more than one retailer to compare
// against (see ProductBrowser), since with a single result "best" is
// trivially true and just noise.
function BestPricePill() {
  return (
    <span className="absolute left-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm backdrop-blur-sm">
      Best price
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

// A floating circular button over the product photo, not a full-width bar
// below it -- founder feedback (2026-07-17, twice: "still looks primitive",
// wants it closer to a polished consumer app like Blink) pointed at flat,
// text-heavy cards as the culprit. Sits as a sibling of the <a> (not
// nested inside it) so clicking it doesn't also trigger the product-page
// navigation.
function FavoriteButton({
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
      className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition disabled:cursor-default ${
        status === "saved"
          ? "bg-indigo-600 text-white"
          : status === "error"
            ? "bg-red-500 text-white"
            : "bg-white/90 text-gray-700 hover:bg-white hover:text-indigo-600 dark:bg-white/15 dark:text-white dark:hover:bg-white/25"
      }`}
    >
      {status === "saving" ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : status === "saved" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : status === "error" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
          <path d="M12 5v9M12 18v.01" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path d="M12 17.3 6.2 21l1.5-6.6L2.5 9.9l6.7-.6L12 3l2.8 6.3 6.7.6-5.2 4.5 1.5 6.6z" />
        </svg>
      )}
    </button>
  );
}

// A small chart-icon button over the image, mirroring FavoriteButton's
// sibling-of-<a> placement (§ above) -- opens the price history modal
// (PRD.md FR-17) without competing with the card's own link to the
// retailer. Restructured from a single whole-card <a> (image-only <a> +
// separate title <a>, like LiveResultCard) specifically so this button
// isn't nested inside an anchor, which is invalid HTML and would need
// preventDefault/stopPropagation gymnastics to behave.
function HistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Price history"
      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:text-indigo-600 dark:bg-white/15 dark:text-white dark:hover:bg-white/25"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="m7 14 4-4 3 3 5-6" />
      </svg>
    </button>
  );
}

function TrackedProductCard({ product, onShowHistory }: { product: Product; onShowHistory: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]">
      <div className="relative">
        <a href={product.url} target="_blank" rel="noreferrer" className="block">
          <ProductImage src={product.image_url} alt={product.title_en} />
        </a>
        <StockPill inStock={product.in_stock} />
        <HistoryButton onClick={onShowHistory} />
      </div>
      <a href={product.url} target="_blank" rel="noreferrer" className="group">
        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-300">
          {product.title_en}
        </p>
      </a>
      <div className="mt-2">
        <PriceTag price={product.current_price} currency={product.currency} />
      </div>
    </div>
  );
}

function LiveResultCard({
  result,
  onFavorite,
  status,
  isBestPrice,
}: {
  result: LiveResult;
  onFavorite: () => void;
  status: "idle" | "saving" | "saved" | "error";
  isBestPrice: boolean;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border bg-white p-3 shadow-sm transition hover:shadow-lg dark:bg-white/[0.03] ${
        isBestPrice ? "border-emerald-400 dark:border-emerald-500/60" : "border-gray-100 dark:border-white/10"
      }`}
    >
      <div className="relative">
        <a href={result.url} target="_blank" rel="noreferrer" className="block">
          <ProductImage src={result.imageUrl} alt={result.title} />
        </a>
        {isBestPrice && <BestPricePill />}
        <FavoriteButton status={status} onClick={onFavorite} />
      </div>
      <a href={result.url} target="_blank" rel="noreferrer" className="group">
        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-300">
          {result.title}
        </p>
      </a>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RetailerBadge slug={result.retailerSlug} />
        <PriceTag price={result.price} currency={result.currency} highlight={isBestPrice} />
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
export function ProductBrowser({ initialProducts }: { initialProducts: Product[] }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [isSearching, setIsSearching] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [favoriteStatus, setFavoriteStatus] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [historyProduct, setHistoryProduct] = useState<{ id: string; title: string; currency: string } | null>(null);

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
    setFavoriteStatus((prev) => ({ ...prev, [result.url]: "saving" }));
    fetch("/api/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
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

  const lowestLivePrice = liveResults.length > 0 ? Math.min(...liveResults.map((r) => r.price)) : null;

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
            {liveResults.map((result) => (
              <LiveResultCard
                key={`${result.retailerSlug}:${result.url}`}
                result={result}
                status={favoriteStatus[result.url] ?? "idle"}
                onFavorite={() => favorite(result)}
                isBestPrice={liveResults.length > 1 && result.price === lowestLivePrice}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        {products.length > 0 && <SectionLabel>Tracked / متابَع</SectionLabel>}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <TrackedProductCard
              key={product.id}
              product={product}
              onShowHistory={() =>
                setHistoryProduct({ id: product.id, title: product.title_en, currency: product.currency })
              }
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
