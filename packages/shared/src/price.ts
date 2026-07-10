const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const CURRENCY_TOKENS = ["SAR", "sar", "ر.س", "ريال", "﷼", "SR"];

/**
 * Normalizes Eastern Arabic-Indic digits and Arabic decimal/thousands
 * separators (U+066B, U+066C) to their Western equivalents, so downstream
 * parsing doesn't need to special-case script.
 */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d)
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/٬/g, ""); // Arabic thousands separator
}

/**
 * Parses a scraped price string (e.g. "1,299.00 SAR", "SAR 899", "٨٩٩ ر.س")
 * into a plain number and detected currency code. Returns null if no
 * numeric value could be extracted -- callers must treat that as "skip this
 * item, don't write a corrupted price" (WORKERS.md §2's per-item isolation
 * rule), never as zero.
 */
export function parsePrice(raw: string): { amount: number; currency: string } | null {
  if (!raw) return null;

  let text = normalizeDigits(raw).trim();

  let currency = "SAR"; // MVP default per PRD.md §12 -- all four launch retailers price in SAR
  for (const token of CURRENCY_TOKENS) {
    if (text.includes(token)) {
      text = text.replace(token, "");
      break;
    }
  }

  // Strip anything that isn't a digit, decimal point, or minus sign, but
  // first remove thousands-separator commas so "1,299.00" -> "1299.00".
  const cleaned = text.replace(/,/g, "").replace(/[^\d.]/g, "").trim();
  if (!cleaned) return null;

  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return { amount: Math.round(amount * 100) / 100, currency };
}
