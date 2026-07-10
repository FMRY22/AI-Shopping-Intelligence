import { createBrowserClient } from "@repo/database";
import type { Product } from "@repo/database";

// This first implementation slice deliberately renders the raw collection
// pipeline output -- no verdicts, no watchlists, no search -- so the
// question "is real data actually flowing end to end?" has a visible
// answer before the AI/notification layers (which need tables this slice
// doesn't create yet, see supabase/migrations/0001_init.sql) are built on
// top of it. UI.md §4.1's full proactive-digest Home screen is a later
// feature slice.
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

export default async function HomePage() {
  const products = await getProducts();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Tracked Products</h1>
      <p className="mt-1 text-sm text-gray-500">
        Read-only proof that the collection pipeline (worker → database) is live.
        {" "}
        {products.length === 0 && "No products yet -- add real Noon product URLs to workers/noon/src/seed.ts and run the worker."}
      </p>

      <ul className="mt-6 divide-y divide-gray-200">
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between py-4">
            <div>
              <a href={product.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {product.title_en}
              </a>
              <p className="text-sm text-gray-500">
                {product.in_stock ? "In stock" : "Out of stock"} · last checked{" "}
                {product.last_checked_at ? new Date(product.last_checked_at).toLocaleString() : "never"}
              </p>
            </div>
            <div className="text-lg font-semibold">
              {product.current_price != null ? `${product.current_price} ${product.currency}` : "—"}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
