import { createBrowserClient } from "@repo/database";
import type { Product } from "@repo/database";
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

export default async function HomePage() {
  const products = await getProducts();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0b0d]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
          AI Shopping Intelligence
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-white/40">
          Search retailers live, favorite what you want to track.
        </p>

        <div className="mt-8">
          <ProductBrowser initialProducts={products} />
        </div>
      </div>
    </main>
  );
}
