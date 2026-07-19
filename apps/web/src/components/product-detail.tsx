"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Product, Retailer } from "@repo/database";
import { BuyWaitBanner, computeBuyWaitSignal, PriceChart, PriceStats, type PricePoint } from "@/components/price-history-chart";

const RETAILER_LABELS: Record<string, string> = {
  amazon_sa: "Amazon.sa",
  jarir: "Jarir",
  extra: "extra",
  noon: "noon",
};

function retailerLabel(slug: string): string {
  return RETAILER_LABELS[slug] ?? slug;
}

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

// One row per retailer where this product is available, cheapest first --
// "ووين اشتريه منه يرتبه بالارخص" (founder, 2026-07-18): the ranking is the
// point, not a side detail.
function RetailerRow({
  product,
  slug,
  isCheapest,
  canSplit,
  onSplit,
}: {
  product: Product;
  slug: string;
  isCheapest: boolean;
  canSplit: boolean;
  onSplit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-3 dark:border-white/10">
      <a href={product.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          {retailerLabel(slug)}
        </span>
        <span className={`text-base font-bold ${isCheapest ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>
          {product.current_price != null ? product.current_price.toLocaleString() : "—"}{" "}
          <span className="text-xs font-medium text-gray-400 dark:text-white/40">{product.currency}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            product.in_stock
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40"
          }`}
        >
          {product.in_stock ? "In stock" : "Out of stock"}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-white/30">
          {formatRelativeTime(product.last_checked_at)}
        </span>
      </a>
      {canSplit && (
        <button
          type="button"
          onClick={onSplit}
          aria-label="This is not the same product"
          title="Split into its own product / فصل كمنتج مستقل"
          className="shrink-0 rounded-full p-1.5 text-gray-300 transition hover:bg-gray-100 hover:text-gray-600 dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/70"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="12" r="2.5" />
            <path d="M8 7.5 15.5 11M8 16.5 15.5 13" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ProductDetail({
  groupKey,
  initialItems,
  initialTitle,
  retailers,
  otherGroups,
}: {
  groupKey: string;
  initialItems: Product[];
  initialTitle: string;
  retailers: Retailer[];
  otherGroups: { key: string; title: string }[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [historyByProduct, setHistoryByProduct] = useState<Record<string, PricePoint[]>>({});

  const retailerSlugById = useMemo(() => Object.fromEntries(retailers.map((r) => [r.id, r.slug])), [retailers]);
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.current_price ?? Infinity) - (b.current_price ?? Infinity)),
    [items],
  );
  const hero = sortedItems[0];
  const cheapestPrice = hero?.current_price ?? null;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      items.map((p) =>
        fetch(`/api/price-history?productId=${encodeURIComponent(p.id)}`)
          .then((res) => res.json() as Promise<{ history?: PricePoint[] }>)
          .then((data) => [p.id, data.history ?? []] as const)
          .catch(() => [p.id, []] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setHistoryByProduct(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((p) => p.id).join(",")]);

  // "كم كان سعره ع الفترة الماضية" (founder, 2026-07-18) answered across the
  // whole product, not one retailer: the best price available on each day,
  // picked across every tracked retailer that had a check that day. This is
  // also what the buy/wait signal reasons over, since "should I buy now" is
  // about the best deal actually available, not an arbitrary single store.
  const mergedHistory = useMemo(() => {
    const byDay = new Map<string, PricePoint>();
    for (const points of Object.values(historyByProduct)) {
      for (const p of points) {
        const day = p.scraped_at.slice(0, 10);
        const existing = byDay.get(day);
        if (!existing || p.price < existing.price) byDay.set(day, p);
      }
    }
    return Array.from(byDay.values()).sort((a, b) => a.scraped_at.localeCompare(b.scraped_at));
  }, [historyByProduct]);

  function applyPatch(productId: string, body: Record<string, unknown>) {
    return fetch("/api/favorite", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, ...body }),
    }).then((res) => res.json() as Promise<{ product?: Product; error?: string }>);
  }

  function commitRename() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    Promise.all(items.map((p) => applyPatch(p.id, { groupTitle: trimmed }))).catch((err: unknown) => console.error(err));
  }

  function splitOut(product: Product) {
    applyPatch(product.id, { groupKey: null })
      .then((data) => {
        if (!data.product) return;
        setItems((prev) => prev.filter((p) => p.id !== product.id));
      })
      .catch((err: unknown) => console.error(err));
  }

  function mergeInto(targetKey: string) {
    Promise.all(items.map((p) => applyPatch(p.id, { groupKey: targetKey })))
      .then((results) => {
        if (results.every((r) => r.product)) router.push(`/products/${encodeURIComponent(targetKey)}`);
      })
      .catch((err: unknown) => console.error(err));
  }

  function removeAll() {
    const confirmed = window.confirm(`Remove "${title}" from tracked? / إزالة "${title}" من المتابَعة؟`);
    if (!confirmed) return;
    Promise.all(
      items.map((p) => fetch(`/api/favorite?productId=${encodeURIComponent(p.id)}`, { method: "DELETE" })),
    )
      .then(() => router.push("/"))
      .catch((err: unknown) => console.error(err));
  }

  if (sortedItems.length === 0) {
    return (
      <div>
        <Link href="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Back / رجوع
        </Link>
        <p className="mt-6 text-center text-sm text-gray-400 dark:text-white/30">
          This product is no longer tracked. / هذا المنتج ما عاد متابَع.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link href="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← Back / رجوع
      </Link>

      <div className="mt-4 flex items-start gap-2">
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
            className="w-full rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xl font-bold text-gray-900 outline-none dark:border-indigo-400 dark:bg-white/5 dark:text-white"
          />
        ) : (
          <h1 className="flex-1 text-xl font-bold text-gray-900 dark:text-white" dir="auto">
            {title}
          </h1>
        )}
        <button
          type="button"
          onClick={() => {
            setTitleDraft(title);
            setEditingTitle(true);
          }}
          aria-label="Rename"
          className="shrink-0 rounded-full p-2 text-gray-300 transition hover:bg-gray-100 hover:text-gray-600 dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/70"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={removeAll}
          aria-label="Remove product"
          className="shrink-0 rounded-full p-2 text-gray-300 transition hover:bg-red-50 hover:text-red-500 dark:text-white/20 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7h14Z" />
          </svg>
        </button>
      </div>

      {cheapestPrice != null && (
        <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          {cheapestPrice.toLocaleString()} <span className="text-sm font-medium text-gray-400 dark:text-white/40">{hero!.currency}</span>
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        {mergedHistory.length >= 2 && <BuyWaitBanner signal={computeBuyWaitSignal(mergedHistory)} />}
        <div className={mergedHistory.length >= 2 ? "mt-4" : ""}>
          <PriceChart points={mergedHistory} currency={hero?.currency ?? "SAR"} />
        </div>
        {mergedHistory.length >= 2 && (
          <div className="mt-4">
            <PriceStats points={mergedHistory} currency={hero?.currency ?? "SAR"} />
          </div>
        )}
      </div>

      <h2 className="mt-8 text-sm font-bold text-gray-900 dark:text-white">Where to buy / وين تشتريه</h2>
      <div className="mt-3 flex flex-col gap-2">
        {sortedItems.map((product) => (
          <RetailerRow
            key={product.id}
            product={product}
            slug={retailerSlugById[product.retailer_id] ?? "?"}
            isCheapest={cheapestPrice != null && product.current_price === cheapestPrice}
            canSplit={sortedItems.length > 1}
            onSplit={() => splitOut(product)}
          />
        ))}
      </div>

      {otherGroups.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) mergeInto(e.target.value);
          }}
          className="mt-4 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white/50"
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
