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
  imageUrl?: string | null;
  // The normalized search query this result came from -- lets the same
  // physical product favorited from multiple retailers in one search
  // render as one grouped card instead of scattered singles (founder
  // feedback, 2026-07-18). Stashed in the pre-existing `specs` jsonb
  // column rather than a new column: no migration path exists from this
  // environment (no direct Postgres/management-API credential, only the
  // PostgREST-facing service-role key, which can't run DDL).
  groupKey?: string | null;
}

function deriveProductId(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? url;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as FavoriteBody | null;
  const { retailerSlug, url, title, price, currency, imageUrl, groupKey } = body ?? {};
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
      image_url: imageUrl ?? null,
      specs: groupKey ? { group_key: groupKey } : null,
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

// PATCH /api/favorite -- adjusts a tracked product's grouping/display
// (merge two groups, split one item back out, rename a group's display
// title), per the founder's "additional improvements" request, 2026-07-18.
// Reads-then-merges `specs` instead of overwriting it wholesale, so a
// rename doesn't clobber a group_key set by a previous merge or vice versa.
interface FavoritePatchBody {
  productId?: string;
  // undefined = leave alone, null = clear (split back to a standalone
  // single-item group), string = set (merge into that group).
  groupKey?: string | null;
  groupTitle?: string | null;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as FavoritePatchBody | null;
  const { productId, groupKey, groupTitle } = body ?? {};
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: existing, error: fetchError } = await db
    .from("products")
    .select("specs")
    .eq("id", productId)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: fetchError?.message ?? "product not found" }, { status: 404 });
  }

  const nextSpecs: Record<string, unknown> = { ...((existing.specs as Record<string, unknown> | null) ?? {}) };
  if (groupKey !== undefined) {
    if (groupKey === null) delete nextSpecs.group_key;
    else nextSpecs.group_key = groupKey;
  }
  if (groupTitle !== undefined) {
    if (groupTitle === null) delete nextSpecs.group_title;
    else nextSpecs.group_title = groupTitle;
  }

  const { data: updated, error: updateError } = await db
    .from("products")
    .update({ specs: Object.keys(nextSpecs).length > 0 ? nextSpecs : null })
    .eq("id", productId)
    .select()
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "update failed" }, { status: 500 });
  }
  return NextResponse.json({ product: updated });
}

// DELETE /api/favorite?productId=... -- the inverse of favoriting (founder
// feedback, 2026-07-18: "can I remove a favorited product?"). price_history
// rows cascade-delete with the product (0001_init.sql's `on delete cascade`
// FK), so no separate cleanup is needed here.
export async function DELETE(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("products").delete().eq("id", productId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
