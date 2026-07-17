"use client";

import { useEffect, useState } from "react";
import type { Product } from "@repo/database";

interface LiveResult {
  retailerSlug: string;
  url: string;
  title: string;
  price: number;
  currency: string;
}

function ProductRow({ product }: { product: Product }) {
  return (
    <li className="flex items-center justify-between py-4">
      <div>
        <a href={product.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {product.title_en}
        </a>
        <p className="text-sm text-gray-500">
          {product.in_stock ? "In stock" : "Out of stock"} · last checked{" "}
          {product.last_checked_at ? new Date(product.last_checked_at).toLocaleString() : "never"}
        </p>
      </div>
      <div className="text-lg font-semibold">
        {product.current_price != null ? `${product.current_price} ${product.currency}` : "—"}
      </div>
    </li>
  );
}

function LiveResultRow({
  result,
  onFavorite,
  status,
}: {
  result: LiveResult;
  onFavorite: () => void;
  status: "idle" | "saving" | "saved" | "error";
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <a href={result.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {result.title}
        </a>
        <p className="text-sm text-gray-500">{result.retailerSlug}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-lg font-semibold">
          {result.price} {result.currency}
        </span>
        <button
          type="button"
          onClick={onFavorite}
          disabled={status === "saving" || status === "saved"}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {status === "saved" ? "✓ Favorited / أُضيف" : status === "saving" ? "…" : "☆ Favorite / تفضيل"}
        </button>
      </div>
    </li>
  );
}

// The search box does two independent things, both always available, never
// one gating the other:
// 1. As you type, GET /api/search (debounced) instantly shows anything
//    already tracked/favorited that matches -- a local DB lookup.
// 2. Pressing Enter or the search button always runs POST /api/track live
//    against the retailers themselves, regardless of what step 1 found.
//    Earlier this only appeared when local search came up empty, which was
//    confusing (a query that happened to match something local hid the
//    live-search option entirely) -- it's unconditional now.
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products... / ابحث عن منتج..."
          dir="auto"
          className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!query.trim() || isTracking}
          className="shrink-0 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isTracking ? "…" : "Search live / ابحث"}
        </button>
      </form>

      {isSearching && <p className="mt-2 text-xs text-gray-400">Checking your list…</p>}

      {isTracking && (
        <p className="mt-6 text-center text-sm text-gray-500">
          Searching retailers live… (~30s) / جاري البحث الحي في المتاجر... (قد يأخذ ٣٠ ثانية)
        </p>
      )}

      {trackError && <p className="mt-4 text-center text-sm text-red-600">{trackError}</p>}

      {!isTracking && liveResults.length === 0 && query.trim() && trackError === null && (
        <p className="mt-2 text-xs text-gray-400">
          Press &quot;Search live&quot; to check retailers directly. / اضغط "ابحث" للبحث المباشر بالمتاجر.
        </p>
      )}

      {liveResults.length > 0 && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-400">
            Live results -- tap Favorite to track / نتائج حية -- اضغط تفضيل للمتابعة
          </p>
          <ul className="mt-2 divide-y divide-gray-200">
            {liveResults.map((result) => (
              <LiveResultRow
                key={`${result.retailerSlug}:${result.url}`}
                result={result}
                status={favoriteStatus[result.url] ?? "idle"}
                onFavorite={() => favorite(result)}
              />
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-6 divide-y divide-gray-200">
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>
    </div>
  );
}
