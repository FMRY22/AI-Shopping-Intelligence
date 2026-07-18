import { createBrowserClient } from "@repo/database";
import type { Product, Retailer } from "@repo/database";
import { ProductBrowser } from "@/components/product-browser";

// Still the collection pipeline's raw output (UI.md §8's later feature
// slice covers the full proactive-digest Home screen from UI.md §4.1),
// but now with real search (PRD.md FR-18) instead of a static list.
export const revalidate = 0;

async function getProducts(): Promise<Product[]> {
  const db = createBrowserClient();
  const { data, error } = await db
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`could not load products: ${error.message}`);
  return data ?? [];
}

// Small, effectively-static table (4 rows) -- fetched once here rather than
// per-request from the client, so ProductBrowser can resolve a tracked
// product's retailer_id to a slug/badge without a join (avoids a
// search_products RPC signature change, which would need a migration).
async function getRetailers(): Promise<Retailer[]> {
  const db = createBrowserClient();
  const { data, error } = await db.from("retailers").select("*");
  if (error) throw new Error(`could not load retailers: ${error.message}`);
  return data ?? [];
}

export default async function HomePage() {
  const [products, retailers] = await Promise.all([getProducts(), getRetailers()]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0b0d]">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <ProductBrowser initialProducts={products} retailers={retailers} />
      </div>
    </main>
  );
}
