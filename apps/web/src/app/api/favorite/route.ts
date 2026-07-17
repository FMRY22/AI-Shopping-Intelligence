import { NextResponse } from "next/server";
import { createServiceClient } from "@repo/database";

// POST /api/favorite: the deliberate-action counterpart to POST /api/track's
// live search. A search result is not tracked just by showing up -- the
// founder wants that to require pressing "favorite" on a specific result,
// same rule as 0003_product_source.sql's 'user_search' source: once saved
// here, it's permanent and never touched by catalog-crawl pruning.
export const runtime = "nodejs";

interface FavoriteBody {
  retailerSlug?: string;
  url?: string;
  title?: string;
  price?: number;
  currency?: string;
}

function deriveProductId(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? url;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as FavoriteBody | null;
  const { retailerSlug, url, title, price, currency } = body ?? {};
  if (!retailerSlug || !url || !title || typeof price !== "number" || !currency) {
    return NextResponse.json({ error: "retailerSlug, url, title, price, and currency are required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: retailer, error: retailerError } = await db
    .from("retailers")
    .select("*")
    .eq("slug", retailerSlug)
    .single();
  if (retailerError || !retailer) {
    return NextResponse.json({ error: `unknown retailer '${retailerSlug}'` }, { status: 400 });
  }

  const retailerProductId = deriveProductId(url);
  const { data: existing } = await db
    .from("products")
    .select("*")
    .eq("retailer_id", retailer.id)
    .eq("retailer_product_id", retailerProductId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ product: existing });
  }

  const { data: inserted, error: insertError } = await db
    .from("products")
    .insert({
      retailer_id: retailer.id,
      retailer_product_id: retailerProductId,
      url,
      title_en: title,
      current_price: price,
      currency,
      in_stock: true,
      last_checked_at: new Date().toISOString(),
      next_due_at: new Date().toISOString(),
      source: "user_search",
    })
    .select()
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "insert failed" }, { status: 500 });
  }

  await db.from("price_history").insert({
    product_id: inserted.id,
    price,
    currency,
    in_stock: true,
  });

  return NextResponse.json({ product: inserted });
}
