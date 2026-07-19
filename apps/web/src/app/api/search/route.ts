import { NextResponse } from "next/server";
import { createBrowserClient } from "@repo/database";
import { searchProductsFuzzy } from "@/lib/fuzzy-search";

// API.md §3 GET /api/search -- the one search-related Route Handler,
// because ranking (Postgres full-text search, API.md §1 Layer C) needs
// server logic beyond a single-table RLS-gated read; everything simpler
// (watchlist, profile, etc. -- not built yet) goes through the direct
// Supabase client instead (Layer A).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const db = createBrowserClient();

  if (!q) {
    const { data, error } = await db.rpc("search_products", { q: "", p_limit: 50 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ products: data ?? [] });
  }

  // websearch_to_tsquery (search_products, 'simple' config) requires a
  // complete, correctly-spelled token -- founder feedback (2026-07-19):
  // typing "iphon" mid-word or a typo like "sasmung" returned nothing even
  // for a tracked product. Fetches a broad candidate pool (catalog is
  // personal-scale) and re-ranks it with prefix/typo-tolerant scoring in
  // JS instead (see fuzzy-search.ts) -- no Supabase migration needed,
  // since this only calls the existing search_products RPC with a larger
  // p_limit, not a new function.
  const { data, error } = await db.rpc("search_products", { q: "", p_limit: 500 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const products = searchProductsFuzzy(data ?? [], q).slice(0, 50);
  return NextResponse.json({ products });
}
