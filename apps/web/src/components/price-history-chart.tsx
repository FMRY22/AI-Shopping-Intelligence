"use client";

import { useEffect, useState } from "react";

interface PricePoint {
  price: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 180;
const CHART_PADDING = 24;

// Scales by actual elapsed time (not by index), so gaps between price
// checks show up honestly instead of implying evenly-spaced samples --
// matches the Keepa/CamelCamelCamel reference the founder pointed to
// (2026-07-18): the chart is the primary artifact, stats are read off it,
// not the other way around.
function buildPath(points: PricePoint[]): string {
  const times = points.map((p) => new Date(p.scraped_at).getTime());
  const prices = points.map((p) => p.price);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const timeSpan = maxTime - minTime || 1;
  const priceSpan = maxPrice - minPrice || 1;

  const x = (t: number) => CHART_PADDING + ((t - minTime) / timeSpan) * (CHART_WIDTH - CHART_PADDING * 2);
  const y = (p: number) =>
    CHART_HEIGHT - CHART_PADDING - ((p - minPrice) / priceSpan) * (CHART_HEIGHT - CHART_PADDING * 2);

  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(new Date(p.scraped_at).getTime()).toFixed(1)} ${y(p.price).toFixed(1)}`)
    .join(" ");
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-gray-400 dark:text-white/40">{label}</span>
      <span className="text-sm font-bold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

export function PriceHistoryModal({
  productId,
  title,
  currency,
  onClose,
}: {
  productId: string;
  title: string;
  currency: string;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/price-history?productId=${encodeURIComponent(productId)}`)
      .then((res) => res.json() as Promise<{ history?: PricePoint[]; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setPoints(data.history ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const prices = points?.map((p) => p.price) ?? [];
  const current = prices.length > 0 ? prices[prices.length - 1] : null;
  const min = prices.length > 0 ? Math.min(...prices) : null;
  const max = prices.length > 0 ? Math.max(...prices) : null;
  const avg = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const vsAvgPct = current != null && avg != null && avg > 0 ? ((current - avg) / avg) * 100 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl dark:bg-[#131316]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="line-clamp-2 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!error && points === null && (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-white/30">Loading… / جارِ التحميل...</p>
        )}

        {!error && points !== null && points.length < 2 && (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-white/30">
            Not enough history yet — check back after a few price checks. / ما فيه سجل كافٍ لسا — راجع بعد كم فحص للسعر.
          </p>
        )}

        {!error && points !== null && points.length >= 2 && (
          <>
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full">
              <path d={buildPath(points)} fill="none" stroke="currentColor" strokeWidth={2} className="text-indigo-500" />
            </svg>
            <div className="mt-4 grid grid-cols-4 gap-3 border-t border-gray-100 pt-4 dark:border-white/10">
              <StatTile label="Current / الحالي" value={current != null ? `${current.toLocaleString()} ${currency}` : "—"} />
              <StatTile label="Lowest / الأقل" value={min != null ? `${min.toLocaleString()} ${currency}` : "—"} />
              <StatTile label="Highest / الأعلى" value={max != null ? `${max.toLocaleString()} ${currency}` : "—"} />
              <StatTile
                label="vs. average / عن المتوسط"
                value={vsAvgPct != null ? `${vsAvgPct > 0 ? "+" : ""}${vsAvgPct.toFixed(0)}%` : "—"}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
