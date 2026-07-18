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

// "Last checked" indicator per retailer row (founder-requested, 2026-07-18)
// -- a coarse relative time is enough to answer "is this data stale," not a
// precise duration.
function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now / الآن";
  if (minutes < 60) return `${minutes}m ago / قبل ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago / قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  return `${days}d ago / قبل ${days} يوم`;
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

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// "Split" -- undo an accidental/wrong merge for one retailer row, leaving
// the rest of the group intact (founder-requested, 2026-07-18).
function UngroupIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8 7.5 15.5 11M8 16.5 15.5 13" />
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
// instead of one card comparing them. The image comes from the cheapest
// item (`items[0]`, pre-sorted by the caller); every retailer gets its own
// row below with its own price, history, and remove action, since each
// retailer's listing has its own independent price_history series.
//
// Also carries the founder's follow-up "additional improvements" batch
// (2026-07-18): an editable display title (specs.group_title, falls back to
// the hero's own title), a per-row "last checked" timestamp, a per-row
// ungroup/split action (only when the group has more than one retailer --
// splitting a singleton is a no-op), and a merge-into-another-group picker
// for fixing a grouping the automatic query-based heuristic got wrong.
function TrackedProductGroupCard({
  items,
  retailerSlugById,
  otherGroups,
  onShowHistory,
  onRemove,
  onUngroup,
  onMerge,
  onRename,
}: {
  items: Product[];
  retailerSlugById: Record<string, string>;
  otherGroups: { key: string; title: string }[];
  onShowHistory: (product: Product) => void;
  onRemove: (product: Product) => void;
  onUngroup: (product: Product) => void;
  onMerge: (targetGroupKey: string) => void;
  onRename: (title: string) => void;
}) {
  const hero = items[0]!;
  const customTitle = items
    .map((p) => (p.specs as { group_title?: string } | null)?.group_title)
    .find((t): t is string => !!t);
  const displayTitle = customTitle || hero.title_en;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(displayTitle);

  const cheapestPrice = items.reduce<number | null>((min, p) => {
    if (p.current_price == null) return min;
    return min == null ? p.current_price : Math.min(min, p.current_price);
  }, null);

  function commitRename() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== displayTitle) onRename(trimmed);
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]">
      <div className="relative">
        <a href={hero.url} target="_blank" rel="noreferrer" className="block">
          <ProductImage src={hero.image_url} alt={displayTitle} />
        </a>
        <StockPill inStock={items.some((p) => p.in_stock)} />
      </div>

      {editingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditingTitle(false);
          }}
          dir="auto"
          className="mt-3 w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm text-gray-900 outline-none dark:border-indigo-400 dark:bg-white/5 dark:text-white"
        />
      ) : (
        <div className="mt-3 flex items-start gap-1">
          <p className="line-clamp-2 min-h-[2.5rem] flex-1 text-sm font-medium text-gray-900 dark:text-white">{displayTitle}</p>
          <button
            type="button"
            onClick={() => {
              setTitleDraft(displayTitle);
              setEditingTitle(true);
            }}
            aria-label="Rename"
            className="shrink-0 rounded-full p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-600 dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            <PencilIcon />
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-col divide-y divide-gray-50 dark:divide-white/5">
        {items.map((product) => (
          <div key={product.id} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
            <a href={product.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <RetailerBadge slug={retailerSlugById[product.retailer_id] ?? "?"} />
                <PriceTag
                  price={product.current_price}
                  currency={product.currency}
                  highlight={cheapestPrice != null && product.current_price === cheapestPrice}
                  small
                />
              </span>
              <span className="text-[10px] text-gray-400 dark:text-white/30">{formatRelativeTime(product.last_checked_at)}</span>
            </a>
            <div className="flex shrink-0 items-center gap-0.5">
              <RowIconButton onClick={() => onShowHistory(product)} label="Price history">
                <HistoryIcon />
              </RowIconButton>
              {items.length > 1 && (
                <RowIconButton onClick={() => onUngroup(product)} label="Split into its own product">
                  <UngroupIcon />
                </RowIconButton>
              )}
              <RowIconButton onClick={() => onRemove(product)} label="Remove">
                <TrashIcon />
              </RowIconButton>
            </div>
          </div>
        ))}
      </div>

      {otherGroups.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onMerge(e.target.value);
          }}
          className="mt-2 w-full rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-500 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white/50"
        >
          <option value="">Merge with another tracked product… / دمج مع منتج آخر...</option>
          {otherGroups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title}
            </option>
          ))}
        </select>
      )}
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

  function applyPatch(productId: string, body: Record<string, unknown>) {
    return fetch("/api/favorite", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, ...body }),
    }).then((res) => res.json() as Promise<{ product?: Product; error?: string }>);
  }

  function applyUpdatedProducts(results: { product?: Product; error?: string }[]) {
    const updated = results.filter((r): r is { product: Product } => !!r.product);
    if (updated.length === 0) return;
    setProducts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const { product } of updated) byId.set(product.id, product);
      return Array.from(byId.values());
    });
  }

  // Un-does an accidental/wrong grouping for one retailer row without
  // touching the rest of the group -- founder-requested, 2026-07-18.
  function ungroupProduct(product: Product) {
    applyPatch(product.id, { groupKey: null })
      .then((data) => applyUpdatedProducts([data]))
      .catch((err: unknown) => console.error(err));
  }

  // Moves every item in the current group into another existing group --
  // founder-requested, 2026-07-18, for when the automatic query-based
  // grouping missed that two separately-searched items are the same
  // product.
  function mergeGroupInto(sourceItems: Product[], targetGroupKey: string) {
    Promise.all(sourceItems.map((p) => applyPatch(p.id, { groupKey: targetGroupKey })))
      .then(applyUpdatedProducts)
      .catch((err: unknown) => console.error(err));
  }

  // Renames a group's display title -- stored on every item in the group
  // (redundant but simple) so any of them can supply it on the next render,
  // founder-requested, 2026-07-18.
  function renameGroup(items: Product[], title: string) {
    Promise.all(items.map((p) => applyPatch(p.id, { groupTitle: title })))
      .then(applyUpdatedProducts)
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
  // group so `items[0]` is always the hero/cheapest for display. `title`
  // resolves the same custom-title-else-hero-title logic the card itself
  // uses, so the merge picker (built from this) shows the same name the
  // card does.
  const trackedGroups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products) {
      const specs = product.specs as { group_key?: string } | null;
      const key = specs?.group_key || product.id;
      const list = map.get(key);
      if (list) list.push(product);
      else map.set(key, [product]);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const sorted = [...items].sort((a, b) => (a.current_price ?? Infinity) - (b.current_price ?? Infinity));
      const customTitle = sorted.map((p) => (p.specs as { group_title?: string } | null)?.group_title).find((t) => !!t);
      return { key, items: sorted, title: customTitle || sorted[0]!.title_en };
    });
  }, [products]);

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
              <TrackedProductGroupCard
                key={group.key}
                items={group.items}
                retailerSlugById={retailerSlugById}
                otherGroups={trackedGroups.filter((g) => g.key !== group.key).map((g) => ({ key: g.key, title: g.title }))}
                onShowHistory={(product) =>
                  setHistoryProduct({ id: product.id, title: product.title_en, currency: product.currency })
                }
                onRemove={removeProduct}
                onUngroup={ungroupProduct}
                onMerge={(targetGroupKey) => mergeGroupInto(group.items, targetGroupKey)}
                onRename={(title) => renameGroup(group.items, title)}
              />
            ))}
          </div>
        )}
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
