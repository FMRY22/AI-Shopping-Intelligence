import { notFound } from "next/navigation";
import { createBrowserClient } from "@repo/database";
import { ProductDetail } from "@/components/product-detail";
import { groupProducts } from "@/lib/product-groups";

// The dedicated "click a product, see a real page" view the founder asked
// for (2026-07-18): "المفترض منتج اضغط عليها بعدين يفتح لي صفحة فيها تراكر
// ووين اشتريه منه يرتبه بالارخص، كم كان سعره ع الفترة الماضية" -- a tracker
// page, retailers ranked cheapest-first, and price-over-time. Replaces the
// small PriceHistoryModal popup, which wasn't a real destination.
export const revalidate = 0;

async function getGroupData(key: string) {
  const db = createBrowserClient();
  const [{ data: products, error: productsError }, { data: retailers, error: retailersError }] = await Promise.all([
    db.from("products").select("*"),
    db.from("retailers").select("*"),
  ]);
  if (productsError) throw new Error(`could not load products: ${productsError.message}`);
  if (retailersError) throw new Error(`could not load retailers: ${retailersError.message}`);
  return { allProducts: products ?? [], retailers: retailers ?? [] };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const { allProducts, retailers } = await getGroupData(key);

  const group = groupProducts(allProducts).find((g) => g.key === key);
  if (!group) notFound();

  const otherGroups = groupProducts(allProducts)
    .filter((g) => g.key !== key)
    .map((g) => ({ key: g.key, title: g.title }));

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0b0d]">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <ProductDetail
          groupKey={key}
          initialItems={group.items}
          initialTitle={group.title}
          retailers={retailers}
          otherGroups={otherGroups}
        />
      </div>
    </main>
  );
}
