import { NextResponse } from "next/server";
import { createBrowserClient } from "@repo/database";

// GET /api/price-history?productId=... (PRD.md FR-17): price-over-time for
// the chart on a tracked product's card. price_history has a public-read RLS
// policy (supabase/migrations/0001_init.sql), same Layer A pattern as
// /api/search -- no service-role client needed.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const db = createBrowserClient();
  const { data, error } = await db
    .from("price_history")
    .select("price, currency, in_stock, scraped_at")
    .eq("product_id", productId)
    .order("scraped_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ history: data ?? [] });
}
