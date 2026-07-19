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
//
// Round 2 (2026-07-18, same day): the founder pointed at a live example --
// "Sony PlayStation 5 Slim (DIG) 825 GB SSD..." (Jarir) and "PS5, Digital
// Edition 825GB - eXtra" (extra), both 2,529 SAR, still showing as separate
// cards. Root cause was jaccard's union-based denominator: a short, terse
// title ("PS5, Digital Edition 825GB") is a near-total subset of a long,
// marketing-heavy one ("PlayStation 5 Slim Digital Edition Console, 825 GB,
// (KSA Version), 2 Year Manufacturer Warranty"), but jaccard still divides
// by the union, so the long title's extra words alone can sink the score
// even when every one of the short title's words is present in the long
// one. Switched to the overlap coefficient (intersection / smaller set
// size) to fix that, plus normalized "PlayStation 5"/"PS5" and "825 GB"/
// "825GB" to the same tokens so they can overlap at all. But overlap is
// more permissive by construction -- it'll happily score two DIFFERENT
// same-brand products high too ("Galaxy Buds" vs "Galaxy Watch" share
// "samsung"+"galaxy" and little else to disagree on) -- so two more vetoes
// were added below (distinguishing product-category words, and bare
// unit-less generation numbers like "iPhone 15" vs "14") to keep that
// precision intact. Every veto still runs BEFORE the similarity threshold,
// so a high score can never override a known conflict.
//
// Round 3 (same day, minutes after round 2 shipped): the backfill script
// using round 2's logic wrongly merged a "Nintendo Switch 2 + Mario Kart
// World Bundle" listing INTO the PS5 group on production. Cause: both
// titles carry the same retailer boilerplate -- "Console", "2 Year
// Manufacturer Warranty", "(KSA Version)" -- and overlap coefficient
// divides by the SMALLER set size, so boilerplate dominating a short
// title's token count alone was enough to cross the threshold even though
// the two products share zero real product-identity words. STOPWORDS
// strips that retailer/regional metadata before comparing -- it was never
// signal about which PRODUCT this is, only about warranty terms and which
// region's edition it's listed for. "version" itself is in the list too --
// caught in a follow-up dry run (this time run without writes first, after
// the production incident above) still matching "Nintendo Switch 2 +
// Mario Kart Bundle" against an unrelated "Nintendo Switch (OLED)" listing
// at exactly the threshold, purely because both titles end in "... Version"
// even without a shared region qualifier.
const OVERLAP_THRESHOLD = 0.5;

// Canonicalizes retailer-specific abbreviations to a shared spelling before
// tokenizing, so e.g. "PlayStation 5" (verbose retailers) and "PS5"
// (terse ones) produce the same token instead of two disjoint ones.
const ALIAS_PATTERNS: [RegExp, string][] = [[/playstation\s*(\d)/g, "ps$1"]];

// "Wi-Fi" vs "WiFi", "13-inch" vs "13 inch", "Int'l" vs "International" --
// retailers are inconsistent about hyphens and apostrophes within a single
// logical word, so both are joined (not turned into a space break) before
// tokenizing, which also has the useful side effect of turning model codes
// like "WH-1000XM5" into one token ("wh1000xm5") that the trailing-digit
// conflict check below can compare.
const TOKEN_SYNONYMS: Record<string, string> = { generation: "gen", dig: "digital" };

// Retailer/regional metadata that shows up verbatim across unrelated
// products' titles -- warranty terms and "which region's edition" markers,
// never the product itself. Left in the token set, these can single-
// handedly drag two different products' overlap score above the threshold
// (see round 3 above).
const STOPWORDS = new Set([
  "warranty", "manufacturer", "year", "years", "ksa", "international", "intl", "global", "gcc", "console", "version",
]);

function preprocessTitle(title: string): string {
  let normalized = title.toLowerCase();
  for (const [pattern, replacement] of ALIAS_PATTERNS) normalized = normalized.replace(pattern, replacement);
  // "825 GB" -> "825gb", matching however extractSizeByUnit already reads it,
  // so the tokenizer doesn't split what the size-conflict check treats as one value.
  normalized = normalized.replace(/(\d)\s+(gb|tb|mp|mah|inch)\b/g, "$1$2");
  normalized = normalized.replace(/-/g, "");
  return normalized.replace(/'/g, "");
}

function normalizeTitleTokens(title: string): Set<string> {
  const joined = preprocessTitle(title);
  return new Set(
    joined
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => TOKEN_SYNONYMS[token] || token)
      .filter((token) => !STOPWORDS.has(token)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const setA = normalizeTitleTokens(a);
  const setB = normalizeTitleTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  return intersection / Math.min(setA.size, setB.size);
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
// S24" vs "Galaxy S24 Ultra"). Product-category nouns ("Buds" vs "Watch")
// catch the overlap-coefficient false-positive described above -- two
// different products in the same brand/line. Both use the same rule: a
// conflict if the word appears in exactly one of the two titles, since both
// titles naming the same tier/category (or neither naming one) isn't a
// conflict. Deliberately excludes generic descriptors like "console" that a
// retailer might just omit for the identical product (e.g. "PS5" alone vs
// "PS5 Console") -- those would false-positive far more than they'd catch.
const DISTINGUISHING_WORDS = [
  "pro", "ultra", "plus", "max", "mini", "lite", "se", "air", "note",
  "buds", "watch", "tablet", "laptop", "headphones", "earbuds",
  "tv", "camera", "speaker", "keyboard", "mouse", "monitor",
];

function hasConflictingDistinguishingWord(tokensA: Set<string>, tokensB: Set<string>): boolean {
  return DISTINGUISHING_WORDS.some((word) => tokensA.has(word) !== tokensB.has(word));
}

// The overlap-coefficient false-positive risk applies to bare model/
// generation numbers too ("iPhone 15" vs "iPhone 14" share "iphone" and
// disagree on almost nothing else). Neither the size check (no unit
// attached) nor the model-code check (no letter prefix on the token itself)
// catches a lone number, so this looks specifically for two short (<=3
// digit) standalone number tokens that never coincide between the titles --
// only when BOTH titles have at least one, so a title that simply doesn't
// mention a number (no signal either way) never trips it.
function bareNumberTokens(tokens: Set<string>): Set<string> {
  return new Set([...tokens].filter((token) => /^\d{1,3}$/.test(token)));
}

function hasConflictingBareNumbers(tokensA: Set<string>, tokensB: Set<string>): boolean {
  const numbersA = bareNumberTokens(tokensA);
  const numbersB = bareNumberTokens(tokensB);
  if (numbersA.size === 0 || numbersB.size === 0) return false;
  for (const number of numbersA) if (numbersB.has(number)) return false;
  return true;
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
  if (hasConflictingDistinguishingWord(tokensA, tokensB)) return false;
  if (hasConflictingKeywordGroup(tokensA, tokensB)) return false;
  if (hasConflictingBareNumbers(tokensA, tokensB)) return false;
  return titleSimilarity(a, b) >= OVERLAP_THRESHOLD;
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

// Used on live (not-yet-tracked) search results -- founder feedback
// (2026-07-19): typing "iPhone 16" showed everything (16, 16 Pro, 16 Pro
// Max, different colors/storage across retailers) crammed into one
// comparison card, as if they were all the same product at different
// prices. That assumption held for a specific-SKU query ("PS5 digital
// edition") but not a broad one -- a live search's results were never
// guaranteed to be one product, only "whatever matched the query text."
// Clusters raw titles with the same same-product logic used everywhere
// else (union-find over isSameProduct, order-independent), so the caller
// can render one comparison card per actual distinct product instead of
// assuming there's only ever one.
export function clusterTitles(titles: string[]): number[][] {
  const parent = titles.map((_, index) => index);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(x: number, y: number) {
    const rootX = find(x);
    const rootY = find(y);
    if (rootX !== rootY) parent[rootX] = rootY;
  }

  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      if (isSameProduct(titles[i]!, titles[j]!)) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < titles.length; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }
  return Array.from(clusters.values());
}
