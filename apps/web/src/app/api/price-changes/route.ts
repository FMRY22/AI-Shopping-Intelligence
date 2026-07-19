import { NextResponse } from "next/server";
import { createBrowserClient } from "@repo/database";

// GET /api/price-changes?ids=id1,id2,... -- founder feedback (2026-07-19):
// "تحسينات فنية وتصميمية" (technical and design improvements) before Phase
// 2, pointing at global price-tracker sites for reference. Those sites show
// a price-drop/rise badge right on the list view, not just after opening a
// product -- this is what powers that badge on the home grid without an N+1
// fetch per card: one query for every relevant product's price_history,
// grouped and diffed here rather than round-tripping per product.
//
// "Change" is the most recent recorded price vs. the one immediately
// before it (not vs. average/min/max, which the detail page's stats
// already cover) -- the same "did it just move" signal CamelCamelCamel's
// list-view badges give at a glance.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }
  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ changes: {} });
  }

  const db = createBrowserClient();
  const { data, error } = await db
    .from("price_history")
    .select("product_id, price, scraped_at")
    .in("product_id", ids)
    .order("scraped_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const changes: Record<string, { changePercent: number; direction: "up" | "down" | "flat" }> = {};
  const seen = new Map<string, number[]>();
  for (const row of data ?? []) {
    const list = seen.get(row.product_id);
    if (list) {
      if (list.length < 2) list.push(row.price);
    } else {
      seen.set(row.product_id, [row.price]);
    }
  }
  for (const [productId, prices] of seen) {
    if (prices.length < 2) continue;
    const [latest, previous] = prices;
    if (previous === undefined || previous === 0 || latest === undefined) continue;
    const changePercent = ((latest - previous) / previous) * 100;
    changes[productId] = {
      changePercent,
      direction: changePercent < -0.5 ? "down" : changePercent > 0.5 ? "up" : "flat",
    };
  }

  return NextResponse.json({ changes });
}
