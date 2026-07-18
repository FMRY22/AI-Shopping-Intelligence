import type { Product } from "@repo/database";

export interface ProductGroup {
  key: string;
  items: Product[];
  title: string;
}

// Shared between the home grid (apps/web/src/components/product-browser.tsx)
// and the product detail page (apps/web/src/app/products/[key]/page.tsx) --
// both need to answer "which retailer rows belong to the same product,"
// same group_key-in-specs convention documented in
// apps/web/src/app/api/favorite/route.ts.
export function groupProducts(products: Product[]): ProductGroup[] {
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
}

// Rough same-product detector based on title-word overlap -- founder
// feedback (2026-07-18): "كل منتج فيه مكان واحد يباع... انت لازم تصنف
// بذكائك حسب المواصفات، اكيد ينباع المنتج في اكثر من مكان" (every product
// [I'm seeing] has only one place selling it -- you need to classify it
// smartly by spec, a product surely sells in more than one place). Before
// this, grouping only happened when items were favorited out of the exact
// same search session (same normalized query as group_key); favoriting the
// "same" product from two different searches (e.g. "ps5" then later
// "playstation 5 slim") landed them in separate singleton groups.
//
// Retailers don't share a barcode/SKU in this schema (0001_init.sql has no
// such column), so title-token overlap is the practical signal available.
// Jaccard similarity alone is unsafe: terse/generic retailer titles ("Apple
// MacBook Air M2 256GB Midnight") only share ~45% of tokens with a fuller
// title for the exact same SKU, while two genuinely different variants
// ("...256GB" vs "...512GB", "S24" vs "S24 Ultra") can share 70-80% of
// tokens. So the threshold alone can't carry precision -- it's paired with
// explicit conflict vetoes below (size, model-code suffix, tier, and
// keyword-group mismatches) that catch the specific ways "almost the same
// title" still means "different product," checked BEFORE the jaccard
// threshold so a high score can't override a known conflict.
const TITLE_MATCH_THRESHOLD = 0.45;

// "Wi-Fi" vs "WiFi", "13-inch" vs "13 inch" -- retailers are inconsistent
// about hyphens within a single logical word, so hyphens are joined (not
// turned into a space break) before tokenizing, which also has the useful
// side effect of turning model codes like "WH-1000XM5" into one token
// ("wh1000xm5") that the trailing-digit conflict check below can compare.
const TOKEN_SYNONYMS: Record<string, string> = { generation: "gen" };

function normalizeTitleTokens(title: string): Set<string> {
  const joined = title.toLowerCase().replace(/-/g, "");
  return new Set(
    joined
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => TOKEN_SYNONYMS[token] || token),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const setA = normalizeTitleTokens(a);
  const setB = normalizeTitleTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// Storage/capacity variants ("256GB" vs "512GB") share nearly every other
// word in a title, so jaccard alone would merge them. Compares the largest
// value per unit rather than requiring the full number-sets to be disjoint,
// because a title like "8GB RAM 256GB SSD" vs "8GB 512GB" legitimately
// shares "8gb" (RAM) while genuinely conflicting on storage -- the max per
// unit is a reasonable proxy for "the spec that actually varies" (storage
// numbers dominate RAM numbers for every unit type used here).
const SIZE_UNIT_PATTERN = /(\d+(?:\.\d+)?)\s?(gb|tb|mp|mah|inch)\b/g;

function extractSizeByUnit(title: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const match of title.toLowerCase().matchAll(SIZE_UNIT_PATTERN)) {
    const unit = match[2]!;
    const value = parseFloat(match[1]!);
    const list = result.get(unit);
    if (list) list.push(value);
    else result.set(unit, [value]);
  }
  return result;
}

function hasConflictingSizes(a: string, b: string): boolean {
  const sizesA = extractSizeByUnit(a);
  const sizesB = extractSizeByUnit(b);
  for (const [unit, valuesA] of sizesA) {
    const valuesB = sizesB.get(unit);
    if (!valuesB) continue;
    if (Math.max(...valuesA) !== Math.max(...valuesB)) return true;
  }
  return false;
}

// Model-generation suffixes ("WH-1000XM5" vs "WH-1000XM4") share every
// other word too. Splits a token into its longest non-digit prefix and
// trailing digit run (not anchored to "starts with a letter" -- tokens like
// "1000xm5" start with digits) and flags a conflict when two tokens share a
// prefix but differ on the trailing number, across either title's full
// token set (order-independent, since the matching token may be anywhere).
function trailingDigitSplit(token: string): { prefix: string; digits: string } | null {
  const match = /^([a-z].*?)(\d+)$/.exec(token);
  if (!match) return null;
  return { prefix: match[1]!, digits: match[2]! };
}

function hasConflictingModelCode(tokensA: Set<string>, tokensB: Set<string>): boolean {
  for (const tokenA of tokensA) {
    const splitA = trailingDigitSplit(tokenA);
    if (!splitA) continue;
    for (const tokenB of tokensB) {
      const splitB = trailingDigitSplit(tokenB);
      if (splitB && splitA.prefix === splitB.prefix && splitA.digits !== splitB.digits) return true;
    }
  }
  return false;
}

// Tier words ("Pro", "Ultra", "Max", ...) mark a different, usually
// differently-priced product line within the same family (e.g. "Galaxy
// S24" vs "Galaxy S24 Ultra"). Flags a conflict when a tier word appears in
// exactly one of the two titles -- both titles naming the same tier (or
// neither naming one) isn't a conflict.
const TIER_WORDS = ["pro", "ultra", "plus", "max", "mini", "lite", "se", "air", "note"];

function hasConflictingTier(tokensA: Set<string>, tokensB: Set<string>): boolean {
  return TIER_WORDS.some((word) => tokensA.has(word) !== tokensB.has(word));
}

// Mutually-exclusive edition/variant keywords that aren't simple tiers.
const CONFLICTING_KEYWORD_GROUPS = [
  ["disc", "digital"],
  ["wifi", "cellular"],
  ["new", "refurbished", "used"],
];

function hasConflictingKeywordGroup(tokensA: Set<string>, tokensB: Set<string>): boolean {
  return CONFLICTING_KEYWORD_GROUPS.some((group) => {
    const inA = group.filter((word) => tokensA.has(word));
    const inB = group.filter((word) => tokensB.has(word));
    return inA.length > 0 && inB.length > 0 && !inA.some((word) => inB.includes(word));
  });
}

function isSameProduct(a: string, b: string): boolean {
  if (hasConflictingSizes(a, b)) return false;
  const tokensA = normalizeTitleTokens(a);
  const tokensB = normalizeTitleTokens(b);
  if (hasConflictingModelCode(tokensA, tokensB)) return false;
  if (hasConflictingTier(tokensA, tokensB)) return false;
  if (hasConflictingKeywordGroup(tokensA, tokensB)) return false;
  return titleSimilarity(a, b) >= TITLE_MATCH_THRESHOLD;
}

// Used at favorite-time (ProductBrowser.favoriteAll) to decide whether a
// newly-tracked item is actually the same product as something already
// tracked, regardless of which search it came from.
export function findMatchingGroupKey(title: string, existing: Product[]): string | null {
  for (const product of existing) {
    if (isSameProduct(title, product.title_en)) {
      const specs = product.specs as { group_key?: string } | null;
      return specs?.group_key || product.id;
    }
  }
  return null;
}
