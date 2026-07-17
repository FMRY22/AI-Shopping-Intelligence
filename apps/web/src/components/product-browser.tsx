"use client";

import { useEffect, useState } from "react";
import type { Product } from "@repo/database";

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

function PriceTag({ price, currency }: { price: number | null; currency: string }) {
  if (price == null) return <span className="text-sm text-gray-400 dark:text-white/40">—</span>;
  return (
    <span className="text-base font-semibold text-gray-900 dark:text-white">
      {price.toLocaleString()} <span className="text-xs font-normal text-gray-500 dark:text-white/50">{currency}</span>
    </span>
  );
}

function RetailerBadge({ slug }: { slug: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-white/70">
      {retailerLabel(slug)}
    </span>
  );
}

function TrackedProductCard({ product }: { product: Product }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03]"
    >
      <ProductImage src={product.image_url} alt={product.title_en} />
      <div className="mt-3 flex flex-1 flex-col gap-2">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 group-hover:underline dark:text-white">
          {product.title_en}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2">
          <PriceTag price={product.current_price} currency={product.currency} />
          <span
            className={`text-[11px] font-medium ${
              product.in_stock ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
            }`}
          >
            {product.in_stock ? "In stock" : "Out of stock"}
          </span>
        </div>
      </div>
    </a>
  );
}

function LiveResultCard({
  result,
  onFavorite,
  status,
}: {
  result: LiveResult;
  onFavorite: () => void;
  status: "idle" | "saving" | "saved" | "error";
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-3 transition hover:shadow-md dark:border-white/10 dark:bg-white/[0.03]">
      <a href={result.url} target="_blank" rel="noreferrer" className="group">
        <ProductImage src={result.imageUrl} alt={result.title} />
        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-900 group-hover:underline dark:text-white">
          {result.title}
        </p>
      </a>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RetailerBadge slug={result.retailerSlug} />
        <PriceTag price={result.price} currency={result.currency} />
      </div>
      <button
        type="button"
        onClick={onFavorite}
        disabled={status === "saving" || status === "saved"}
        className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-default ${
          status === "saved"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
            : status === "error"
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-white/85"
        }`}
      >
        {status === "saved" ? (
          <>✓ Favorited / أُضيف</>
        ) : status === "saving" ? (
          "…"
        ) : status === "error" ? (
          "Failed — retry / حاول مجدداً"
        ) : (
          <>☆ Favorite / تفضيل</>
        )}
      </button>
    </div>
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

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchLive();
        }}
        className="flex gap-2"
      >
        <div className="relative w-full">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 dark:text-white/40">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products... / ابحث عن منتج..."
            dir="auto"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-900/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30 dark:focus:border-white/30"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || isTracking}
          className="shrink-0 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-default disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-white/85"
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
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-white/30">
            Live results — tap Favorite to track / نتائج حية — اضغط تفضيل للمتابعة
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {liveResults.map((result) => (
              <LiveResultCard
                key={`${result.retailerSlug}:${result.url}`}
                result={result}
                status={favoriteStatus[result.url] ?? "idle"}
                onFavorite={() => favorite(result)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        {products.length > 0 && (
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-white/30">
            Tracked / متابَع
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <TrackedProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
}
