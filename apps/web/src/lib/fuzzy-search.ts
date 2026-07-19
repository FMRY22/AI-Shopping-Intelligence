// Postgres full-text search (search_products RPC, GET /api/search) does
// exact tokenized-word matching only -- founder feedback (2026-07-19):
// typing "iphon" (mid-word, before finishing "iphone") or a typo like
// "sasmung" returns nothing even when the product IS tracked, because
// websearch_to_tsquery requires a complete, correctly-spelled token.
// Live-verified against production (test-search-api.yml): "playstation",
// "ps5", and "sony" all matched fine against tracked titles, confirming
// the gap is prefix/typo tolerance, not the matching engine being broken.
//
// The catalog is personal-scale (tens to a few hundred tracked products,
// not a storefront's), so scoring every candidate in JS is cheap and
// avoids a new Supabase migration -- this environment only reaches
// Supabase via PostgREST (SUPABASE_SERVICE_ROLE_KEY), not raw SQL, so
// altering the search_products function itself would need the founder to
// apply a migration by hand.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Plain Levenshtein (edit distance) -- fine at these lengths (single
// words, rarely more than ~15 characters), O(n*m) is not a concern here.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

// Exact match scores highest; a prefix match (either direction, so a
// partially-typed query word and a partially-scraped title word both
// count) covers "typing as you go"; anything else falls back to edit
// distance scaled to word length, so short words need a near-exact match
// while long words tolerate a couple of typos.
function tokenScore(queryToken: string, titleToken: string): number {
  if (queryToken === titleToken) return 1;
  if (titleToken.startsWith(queryToken) || queryToken.startsWith(titleToken)) return 0.85;
  const maxLen = Math.max(queryToken.length, titleToken.length);
  if (maxLen < 3) return 0; // too short for edit-distance fuzzing to mean anything
  const allowedDistance = maxLen <= 4 ? 1 : maxLen <= 8 ? 2 : 3;
  const distance = levenshtein(queryToken, titleToken);
  if (distance > allowedDistance) return 0;
  return 0.6 * (1 - distance / maxLen);
}

const MIN_TOKEN_SCORE = 0.3;

// Every query token must find *some* matching title token (AND semantics,
// matching websearch_to_tsquery's default for space-separated terms) --
// otherwise a multi-word query like "iphone 17" would match any product
// that merely contains "iphone".
function scoreProduct(queryTokens: string[], titleTokens: string[]): number {
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const titleToken of titleTokens) best = Math.max(best, tokenScore(queryToken, titleToken));
    if (best < MIN_TOKEN_SCORE) return 0;
    total += best;
  }
  return total / queryTokens.length;
}

export function searchProductsFuzzy<T extends { title_en: string; title_ar?: string | null }>(
  products: T[],
  query: string,
): T[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return products;
  return products
    .map((product) => ({
      product,
      score: scoreProduct(queryTokens, tokenize(`${product.title_en} ${product.title_ar ?? ""}`)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);
}
