-- Reference data for local/dev environments.
-- MVP retailers per PRD.md §9 / WORKERS.md §4.
insert into retailers (slug, name_en, name_ar, base_url, worker_workflow, is_active) values
  ('noon', 'Noon', 'نون', 'https://www.noon.com', 'worker-noon.yml', true),
  ('amazon_sa', 'Amazon.sa', 'أمازون السعودية', 'https://www.amazon.sa', 'worker-amazon.yml', false),
  ('jarir', 'Jarir Bookstore', 'مكتبة جرير', 'https://www.jarir.com', 'worker-jarir.yml', true),
  ('extra', 'extra', 'اكسترا', 'https://www.extra.com', 'worker-extra.yml', false)
on conflict (slug) do nothing;

-- A small starter category set (DATABASE.md §3) -- expanded as real coverage grows.
insert into categories (slug, name_en, name_ar) values
  ('electronics', 'Electronics', 'إلكترونيات'),
  ('laptops', 'Laptops', 'لابتوبات'),
  ('smartphones', 'Smartphones', 'هواتف ذكية')
on conflict (slug) do nothing;
