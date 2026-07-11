import { NextResponse } from "next/server";
import { createBrowserClient } from "@repo/database";

// API.md §3 GET /api/search -- the one search-related Route Handler,
// because ranking (Postgres full-text search, API.md §1 Layer C) needs
// server logic beyond a single-table RLS-gated read; everything simpler
// (watchlist, profile, etc. -- not built yet) goes through the direct
// Supabase client instead (Layer A).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const db = createBrowserClient();
  const { data, error } = await db.rpc("search_products", { q, p_limit: 50 });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ products: data ?? [] });
}
