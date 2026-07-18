import type { Product } from "@repo/database";

export interface ProductGroup {
  key: string;
  items: Product[];
  title: string;
}

// Shared between the home grid (apps/web/src/components/product-browser.tsx)
// and the product detail page (apps/web/src/app/products/[key]/page.tsx) --
// both need to answer "which retailer rows belong to the same product,"
// same group_key-in-specs convention documented in
// apps/web/src/app/api/favorite/route.ts.
export function groupProducts(products: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const specs = product.specs as { group_key?: string } | null;
    const key = specs?.group_key || product.id;
    const list = map.get(key);
    if (list) list.push(product);
    else map.set(key, [product]);
  }
  return Array.from(map.entries()).map(([key, items]) => {
    const sorted = [...items].sort((a, b) => (a.current_price ?? Infinity) - (b.current_price ?? Infinity));
    const customTitle = sorted.map((p) => (p.specs as { group_title?: string } | null)?.group_title).find((t) => !!t);
    return { key, items: sorted, title: customTitle || sorted[0]!.title_en };
  });
}
