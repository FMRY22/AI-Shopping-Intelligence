-- 0003_product_source.sql
-- Distinguishes how a product entered the catalog, so catalog-crawl
-- discovery (packages/scraper-core's discoverUrls, PRD.md FR-1) can be
-- capped to a small rotating set without ever touching anything the
-- founder actually asked for -- either by manual seed or by live
-- search-and-track (apps/web's POST /api/track, PRD.md FR-18).
--
-- 'seed'          -- manually-seeded URLs (workers/*/src/seed.ts)
-- 'catalog_crawl' -- auto-discovered from a bestseller/listing page;
--                    capped and pruned, safe to delete when it rotates out
-- 'user_search'   -- the founder searched for it via /api/track; permanent,
--                    exactly like a seeded product

alter table products
  add column source text not null default 'seed';

alter table products
  add constraint products_source_check check (source in ('seed', 'catalog_crawl', 'user_search'));

-- One-time cleanup: the catalog-crawl discovery that ran before this
-- distinction existed added a bunch of unrelated accessories (chargers,
-- cables, batteries, phone holders...) alongside the real Nintendo Switch
-- products the founder actually searched for. Keep the original PS5 seeds
-- and anything Nintendo-related; drop the rest so the catalog starts clean
-- under the new cap.
delete from products
where retailer_id = (select id from retailers where slug = 'amazon_sa')
  and retailer_product_id <> 'B0CN5Q73LC'
  and title_en not ilike '%nintendo%'
  and title_en not ilike '%switch%';

update products
set source = 'user_search'
where title_en ilike '%nintendo%' or title_en ilike '%switch%';
