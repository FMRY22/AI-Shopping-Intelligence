import { log } from "./logger";

export interface BatchResult {
  status: "success" | "partial" | "failed";
  itemsProcessed: number;
  errorMessage: string | null;
}

/**
 * Runs `handler` once per item with per-item isolation (WORKERS.md §2 rule
 * 1): one item throwing never aborts the batch. Errors are logged and
 * aggregated into a single summary suitable for a `worker_runs` row --
 * failed items are simply left for the *next* scheduled run rather than
 * retried in a loop here (rule 2).
 */
export async function runBatch<T>(
  items: T[],
  handler: (item: T) => Promise<void>,
  describe: (item: T) => string,
): Promise<BatchResult> {
  const errors: string[] = [];
  let processed = 0;

  for (const item of items) {
    try {
      await handler(item);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", "item failed, continuing batch", { item: describe(item), error: message });
      errors.push(`${describe(item)}: ${message}`);
    }
  }

  if (items.length === 0) {
    return { status: "success", itemsProcessed: 0, errorMessage: null };
  }
  if (errors.length === 0) {
    return { status: "success", itemsProcessed: processed, errorMessage: null };
  }
  if (processed === 0) {
    return { status: "failed", itemsProcessed: 0, errorMessage: errors.join("; ").slice(0, 2000) };
  }
  return { status: "partial", itemsProcessed: processed, errorMessage: errors.join("; ").slice(0, 2000) };
}

/**
 * At most one retry for a genuinely transient failure (e.g. a dropped
 * connection) -- explicitly not a loop, per WORKERS.md §2 rule 2 ("no
 * aggressive retries within a run"). A block/CAPTCHA should not be retried
 * at all; callers decide what's worth the single retry.
 */
export async function withSingleRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}
