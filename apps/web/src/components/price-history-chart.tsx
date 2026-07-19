"use client";

import { useRef, useState } from "react";

export interface PricePoint {
  price: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 240;
const PADDING_LEFT = 58;
const PADDING_RIGHT = 12;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 28;
const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const Y_GRIDLINE_COUNT = 4;
const GRADIENT_ID = "price-chart-fill";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

// Scales by actual elapsed time (not by index), so gaps between price
// checks show up honestly instead of implying evenly-spaced samples --
// matches the Keepa/CamelCamelCamel reference the founder pointed to
// (2026-07-18): the chart is the primary artifact, stats are read off it,
// not the other way around. Founder feedback (2026-07-19, screenshot of
// the shipped chart): "الشارت ما فيه ارقام ولا اندكيتور" (the chart has no
// numbers or indicator) -- global price-tracker sites always label their
// axes and let you read an exact value, not just eyeball a shape.
function buildScale(points: PricePoint[]) {
  const times = points.map((p) => new Date(p.scraped_at).getTime());
  const prices = points.map((p) => p.price);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const timeSpan = maxTime - minTime || 1;
  // A flat price history (min === max) would otherwise divide by zero and
  // draw a degenerate line glued to one edge.
  const priceSpan = maxPrice - minPrice || Math.max(maxPrice * 0.05, 1);
  // Padding so the line and its point markers never sit flush against the
  // plot edges, which would clip half a circle marker or a hover ring.
  const pad = priceSpan * 0.12;
  const plotMin = minPrice - pad;
  const plotMax = maxPrice + pad;
  const plotSpan = plotMax - plotMin;

  const x = (t: number) => PADDING_LEFT + ((t - minTime) / timeSpan) * PLOT_WIDTH;
  const y = (p: number) => PADDING_TOP + PLOT_HEIGHT - ((p - plotMin) / plotSpan) * PLOT_HEIGHT;
  return { x, y, minTime, maxTime, minPrice, maxPrice, plotMin, plotMax };
}

function buildPath(points: PricePoint[], scale: ReturnType<typeof buildScale>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scale.x(new Date(p.scraped_at).getTime()).toFixed(1)} ${scale.y(p.price).toFixed(1)}`)
    .join(" ");
}

export function PriceChart({ points, currency }: { points: PricePoint[]; currency: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length < 2) {
    return (
      <p className="flex h-[180px] items-center justify-center text-center text-sm text-gray-400 dark:text-white/30">
        Not enough history yet — check back after a few price checks. / ما فيه سجل كافٍ لسا — راجع بعد كم فحص للسعر.
      </p>
    );
  }

  const scale = buildScale(points);
  const linePath = buildPath(points, scale);
  const areaPath = `${linePath} L ${scale.x(scale.maxTime).toFixed(1)} ${(CHART_HEIGHT - PADDING_BOTTOM).toFixed(1)} L ${scale.x(scale.minTime).toFixed(1)} ${(CHART_HEIGHT - PADDING_BOTTOM).toFixed(1)} Z`;

  const lowestIndex = points.reduce((lowest, p, i) => (p.price < points[lowest]!.price ? i : lowest), 0);

  const yGridlines = Array.from({ length: Y_GRIDLINE_COUNT }, (_, i) => {
    const value = scale.plotMin + (scale.plotMax - scale.plotMin) * (i / (Y_GRIDLINE_COUNT - 1));
    return { value, y: scale.y(value) };
  });

  // First/last dates always shown; a middle date only if the series spans
  // enough real time for it to read as a distinct label rather than a
  // near-duplicate of its neighbor.
  const spanDays = (scale.maxTime - scale.minTime) / 86_400_000;
  const xLabels = [
    { t: scale.minTime, x: scale.x(scale.minTime) },
    ...(spanDays >= 4 ? [{ t: (scale.minTime + scale.maxTime) / 2, x: scale.x((scale.minTime + scale.maxTime) / 2) }] : []),
    { t: scale.maxTime, x: scale.x(scale.maxTime) },
  ];

  function nearestIndexFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
    let nearest = 0;
    let minDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(scale.x(new Date(p.scraped_at).getTime()) - relX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    });
    return nearest;
  }

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const hoveredX = hovered ? scale.x(new Date(hovered.scraped_at).getTime()) : 0;
  const hoveredY = hovered ? scale.y(hovered.price) : 0;
  // Flips the tooltip to the point's left once it's past the chart's
  // midpoint, so it never renders clipped off the right edge.
  const tooltipOnRight = hoveredX < CHART_WIDTH / 2;

  return (
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full touch-none"
        onPointerMove={(e) => setHoverIndex(nearestIndexFromClientX(e.clientX))}
        onPointerDown={(e) => setHoverIndex(nearestIndexFromClientX(e.clientX))}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} className="text-indigo-500" />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} className="text-indigo-500" />
          </linearGradient>
        </defs>

        {yGridlines.map(({ value, y }, i) => (
          <g key={i}>
            <line
              x1={PADDING_LEFT}
              x2={CHART_WIDTH - PADDING_RIGHT}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={1}
              className="text-gray-100 dark:text-white/10"
            />
            <text x={PADDING_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-gray-400 text-[10px] dark:fill-white/40">
              {formatPrice(value)}
            </text>
          </g>
        ))}

        {xLabels.map(({ t, x }, i) => (
          <text
            key={i}
            x={Math.min(Math.max(x, PADDING_LEFT + 20), CHART_WIDTH - PADDING_RIGHT - 20)}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-gray-400 text-[10px] dark:fill-white/40"
          >
            {formatDate(new Date(t).toISOString())}
          </text>
        ))}

        <path d={areaPath} fill={`url(#${GRADIENT_ID})`} stroke="none" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" className="text-indigo-500" />

        {/* Lowest-price marker: the single number the buy/wait banner's
            reasoning is most often anchored to, called out the way
            CamelCamelCamel/Keepa mark an all-time-low point. */}
        <circle cx={scale.x(new Date(points[lowestIndex]!.scraped_at).getTime())} cy={scale.y(points[lowestIndex]!.price)} r={3.5} fill="currentColor" className="text-emerald-500" />

        {hovered && (
          <>
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={PADDING_TOP}
              y2={CHART_HEIGHT - PADDING_BOTTOM}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 3"
              className="text-gray-300 dark:text-white/20"
            />
            <circle cx={hoveredX} cy={hoveredY} r={4.5} fill="currentColor" className="text-indigo-600 dark:text-indigo-400" />
            <circle cx={hoveredX} cy={hoveredY} r={8} fill="currentColor" fillOpacity={0.15} className="text-indigo-600 dark:text-indigo-400" />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-white/10 dark:bg-[#17171a]"
          style={{
            left: tooltipOnRight ? `${(hoveredX / CHART_WIDTH) * 100}%` : undefined,
            right: tooltipOnRight ? undefined : `${100 - (hoveredX / CHART_WIDTH) * 100}%`,
            transform: tooltipOnRight ? "translateX(8px)" : "translateX(-8px)",
          }}
        >
          <p className="font-bold text-gray-900 dark:text-white">
            {formatPrice(hovered.price)} {currency}
          </p>
          <p className="text-gray-400 dark:text-white/40">{formatDate(hovered.scraped_at)}</p>
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-gray-400 dark:text-white/40">{label}</span>
      <span className="text-sm font-bold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

export function PriceStats({ points, currency }: { points: PricePoint[]; currency: string }) {
  const prices = points.map((p) => p.price);
  const current = prices.length > 0 ? prices[prices.length - 1]! : null;
  const min = prices.length > 0 ? Math.min(...prices) : null;
  const max = prices.length > 0 ? Math.max(...prices) : null;
  const avg = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const vsAvgPct = current != null && avg != null && avg > 0 ? ((current - avg) / avg) * 100 : null;

  return (
    <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-white/10 sm:grid-cols-4">
      <StatTile label="Current / الحالي" value={current != null ? `${current.toLocaleString()} ${currency}` : "—"} />
      <StatTile label="Lowest / الأقل" value={min != null ? `${min.toLocaleString()} ${currency}` : "—"} />
      <StatTile label="Highest / الأعلى" value={max != null ? `${max.toLocaleString()} ${currency}` : "—"} />
      <StatTile
        label="vs. average / عن المتوسط"
        value={vsAvgPct != null ? `${vsAvgPct > 0 ? "+" : ""}${vsAvgPct.toFixed(0)}%` : "—"}
      />
    </div>
  );
}

type Verdict = "buy_now" | "wait" | "neutral";

export interface BuyWaitSignal {
  verdict: Verdict;
  reasonEn: string;
  reasonAr: string;
}

// PRD.md §1 item 5 / FR-9, deliberately simplified: a rule against the
// same price history already loaded for the chart, not an LLM agent --
// "not a prerequisite for shipping v1" per the PRD's Phase 1 notes.
// Thresholds compare the current price to how it sits within its own
// recorded range (near the low / near the high / vs. the average), and
// the reasoning shown is exactly the number the verdict was decided
// from -- explainable by construction, not a black-box label.
export function computeBuyWaitSignal(points: PricePoint[]): BuyWaitSignal {
  const prices = points.map((p) => p.price);
  const current = prices[prices.length - 1];
  if (current === undefined) {
    return { verdict: "neutral", reasonEn: "Not enough data yet.", reasonAr: "لا توجد بيانات كافية بعد." };
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  const pctAboveMin = min > 0 ? ((current - min) / min) * 100 : 0;
  const pctFromAvg = avg > 0 ? ((current - avg) / avg) * 100 : 0;
  const pctBelowMax = max > 0 ? ((max - current) / max) * 100 : 0;

  if (pctAboveMin <= 2) {
    return {
      verdict: "buy_now",
      reasonEn: `Within ${Math.round(pctAboveMin)}% of its lowest recorded price — historically, it doesn't get much better than this.`,
      reasonAr: `ضمن ${Math.round(pctAboveMin)}% من أقل سعر مسجّل له — نادراً ما ينزل أكثر من كذا.`,
    };
  }
  if (pctFromAvg <= -3) {
    return {
      verdict: "buy_now",
      reasonEn: `${Math.round(Math.abs(pctFromAvg))}% below its typical price — a good time to buy.`,
      reasonAr: `أقل من سعره المعتاد بـ ${Math.round(Math.abs(pctFromAvg))}% — وقت مناسب للشراء.`,
    };
  }
  if (pctBelowMax <= 2) {
    return {
      verdict: "wait",
      reasonEn: `Within ${Math.round(pctBelowMax)}% of its highest recorded price — it has been cheaper before and may be again.`,
      reasonAr: `ضمن ${Math.round(pctBelowMax)}% من أعلى سعر مسجّل له — كان أرخص من قبل وممكن يرجع.`,
    };
  }
  if (pctFromAvg >= 3) {
    return {
      verdict: "wait",
      reasonEn: `${Math.round(pctFromAvg)}% above its typical price — it has historically dropped below this.`,
      reasonAr: `أعلى من سعره المعتاد بـ ${Math.round(pctFromAvg)}% — نزل تحت هالسعر من قبل.`,
    };
  }
  return {
    verdict: "neutral",
    reasonEn: "Close to its typical price — no strong signal either way.",
    reasonAr: "قريب من سعره المعتاد — ما فيه إشارة واضحة حالياً.",
  };
}

const VERDICT_STYLES: Record<Verdict, string> = {
  buy_now: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  wait: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  neutral: "bg-gray-50 text-gray-600 dark:bg-white/5 dark:text-white/60",
};

const VERDICT_LABELS: Record<Verdict, string> = {
  buy_now: "Buy now / اشترِ الآن",
  wait: "Wait / انتظر",
  neutral: "Fair price / سعر عادل",
};

export function BuyWaitBanner({ signal }: { signal: BuyWaitSignal }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${VERDICT_STYLES[signal.verdict]}`}>
      <p className="text-sm font-bold">{VERDICT_LABELS[signal.verdict]}</p>
      <p className="mt-0.5 text-xs opacity-90">
        {signal.reasonEn} / {signal.reasonAr}
      </p>
    </div>
  );
}
