"use client";

import { useEffect, useState } from "react";
import type { Product } from "@repo/database";

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

// Debounced client-side search against GET /api/search (API.md §3), which
// calls the search_products Postgres function (0002_search_function.sql).
// Kept as a small, self-contained client component -- the initial list
// still renders server-side in page.tsx for a fast first paint; this only
// takes over once the user actually types.
//
// GET /api/search only covers products already collected. When it comes up
// empty, POST /api/track (PRD.md FR-1/FR-18) is the fallback: a live,
// on-demand search of the retailer itself, seconds long, offered as an
// explicit action rather than fired automatically on every keystroke.
export function ProductBrowser({ initialProducts }: { initialProducts: Product[] }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState(initialProducts);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearchedLocally, setHasSearchedLocally] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    setTrackError(null);
    if (!trimmed) {
      setProducts(initialProducts);
      setIsSearching(false);
      setHasSearchedLocally(false);
      return;
    }

    setIsSearching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ products?: Product[]; error?: string }>)
        .then((data) => {
          setProducts(data.products ?? []);
          setHasSearchedLocally(true);
        })
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

  function searchNow() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsTracking(true);
    setTrackError(null);
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
    })
      .then((res) => res.json() as Promise<{ products?: Product[]; error?: string }>)
      .then((data) => {
        if (data.error) {
          setTrackError(data.error);
          return;
        }
        setProducts(data.products ?? []);
      })
      .catch((err: unknown) => setTrackError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsTracking(false));
  }

  const showSearchNow = hasSearchedLocally && !isSearching && products.length === 0 && query.trim();

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products... / ابحث عن منتج..."
        dir="auto"
        className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-gray-500 focus:outline-none"
      />

      {isSearching && <p className="mt-2 text-xs text-gray-400">Searching…</p>}

      {showSearchNow && !isTracking && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            No products match &quot;{query}&quot; yet. / ما لقينا شي محلياً.
          </p>
          <button
            type="button"
            onClick={searchNow}
            className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Search retailers now / ابحث الآن في المتاجر
          </button>
          <p className="mt-2 text-xs text-gray-400">Can take up to ~30 seconds / قد يأخذ حتى ٣٠ ثانية</p>
        </div>
      )}

      {isTracking && (
        <p className="mt-6 text-center text-sm text-gray-500">
          Searching amazon.sa live… / جاري البحث الحي في أمازون...
        </p>
      )}

      {trackError && <p className="mt-4 text-center text-sm text-red-600">{trackError}</p>}

      <ul className="mt-6 divide-y divide-gray-200">
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>
    </div>
  );
}
