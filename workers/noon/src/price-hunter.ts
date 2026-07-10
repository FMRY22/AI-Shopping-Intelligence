/**
 * Price Hunter -- deterministic logic (AI_AGENTS.md §3.1), inline in every
 * retailer worker's scrape step. No LLM call; this is exactly the kind of
 * signal-from-data-comparison task that plain code handles well and for
 * free, keeping the scarce OpenRouter budget for genuine reasoning tasks.
 *
 * change_events emission (the FR-14 gate that triggers Deal Hunter) is
 * deferred to the AI-agents implementation slice, since the `change_events`
 * table doesn't exist yet in this first collection-pipeline slice -- see
 * supabase/migrations/0001_init.sql's header comment.
 */

const MATERIAL_CHANGE_THRESHOLD = 0.02; // 2% -- below this, treat as noise, not a real change

const HIGH_VOLATILITY_INTERVAL = "6 hours";
const LOW_VOLATILITY_INTERVAL = "24 hours";
const VOLATILITY_INTERVAL_CUTOFF = 0.05; // coefficient of variation above this = "volatile"

export function isMaterialPriceChange(oldPrice: number | null, newPrice: number): boolean {
  if (oldPrice === null || oldPrice === 0) return true; // first price ever recorded
  return Math.abs(newPrice - oldPrice) / oldPrice >= MATERIAL_CHANGE_THRESHOLD;
}

/** Coefficient of variation (stddev / mean) over recent prices -- a simple,
 * dependency-free volatility measure. Returns 0 for fewer than 2 points. */
export function computeVolatility(recentPrices: number[]): number {
  if (recentPrices.length < 2) return 0;
  const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  if (mean === 0) return 0;
  const variance =
    recentPrices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / recentPrices.length;
  return Math.sqrt(variance) / mean;
}

export function checkIntervalFor(volatility: number): string {
  return volatility >= VOLATILITY_INTERVAL_CUTOFF ? HIGH_VOLATILITY_INTERVAL : LOW_VOLATILITY_INTERVAL;
}
