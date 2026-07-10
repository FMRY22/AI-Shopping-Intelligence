-- 0001_init.sql
-- First implementation slice per PRD.md/DATABASE.md: proves the collection
-- pipeline end to end (retailer -> price data -> scheduler -> readable UI).
-- Deliberately excludes AI/user/notification tables (change_events,
-- product_verdicts, product_embeddings, watchlists, profiles, etc.) --
-- those ship in a later migration alongside the feature slice that needs
-- them, per the founder's "build feature by feature" instruction.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Reference tables (DATABASE.md §3)
-- ---------------------------------------------------------------------

create table retailers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_ar text not null,
  base_url text not null,
  logo_url text,
  worker_workflow text,
  is_active boolean not null default true
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_ar text not null,
  parent_id uuid references categories (id)
);

-- ---------------------------------------------------------------------
-- Core product & pricing tables (DATABASE.md §4)
-- ---------------------------------------------------------------------

create table products (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailers (id),
  retailer_product_id text not null,
  url text not null,
  category_id uuid references categories (id),
  title_en text not null,
  title_ar text,
  image_url text,
  current_price numeric(10, 2),
  currency char(3) not null default 'SAR',
  in_stock boolean not null default true,
  rating_avg numeric(2, 1),
  rating_count integer not null default 0,
  specs jsonb,
  -- Scheduler fields (ARCHITECTURE.md §3.5, WORKERS.md §3.1)
  popularity_score real not null default 0,
  volatility_score real not null default 0,
  check_interval interval not null default '24 hours',
  last_checked_at timestamptz,
  next_due_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retailer_id, retailer_product_id)
);

create index products_scheduler_idx on products (retailer_id, next_due_at);
create index products_category_idx on products (category_id);
create index products_search_idx on products
  using gin (to_tsvector('simple', title_en || ' ' || coalesce(title_ar, '')));

create table price_history (
  id bigserial primary key,
  product_id uuid not null references products (id) on delete cascade,
  price numeric(10, 2) not null,
  currency char(3) not null,
  in_stock boolean not null,
  scraped_at timestamptz not null default now()
);

create index price_history_product_idx on price_history (product_id, scraped_at desc);

create table price_history_daily (
  id bigserial primary key,
  product_id uuid not null references products (id) on delete cascade,
  day date not null,
  open_price numeric(10, 2) not null,
  close_price numeric(10, 2) not null,
  min_price numeric(10, 2) not null,
  max_price numeric(10, 2) not null,
  currency char(3) not null,
  unique (product_id, day)
);

create index price_history_daily_product_idx on price_history_daily (product_id, day desc);

-- ---------------------------------------------------------------------
-- Admin & ops (DATABASE.md §9) -- worker_runs only for this slice
-- ---------------------------------------------------------------------

create table worker_runs (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid references retailers (id),
  worker_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('success', 'partial', 'failed')),
  items_processed integer not null default 0,
  error_message text
);

-- ---------------------------------------------------------------------
-- Scheduler RPC (ARCHITECTURE.md §3.5, WORKERS.md §3.1, API.md §1 Layer C)
-- Called directly via supabase.rpc('get_due_items', ...) from worker
-- scripts using the service-role key -- no HTTP API layer in between.
-- ---------------------------------------------------------------------

create or replace function get_due_items(p_retailer_slug text, p_limit int default 25)
returns setof products
language sql
stable
as $$
  select p.*
  from products p
  join retailers r on r.id = p.retailer_id
  where r.slug = p_retailer_slug
    and r.is_active = true
    and p.is_active = true
  order by (now() - p.next_due_at) desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------

alter table retailers enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table price_history enable row level security;
alter table price_history_daily enable row level security;
alter table worker_runs enable row level security;

-- Public read access for catalog data (Layer A direct-client reads, API.md §1)
create policy "public read retailers" on retailers for select using (true);
create policy "public read categories" on categories for select using (true);
create policy "public read products" on products for select using (is_active = true);
create policy "public read price_history" on price_history for select using (true);
create policy "public read price_history_daily" on price_history_daily for select using (true);

-- worker_runs has no public policy -- deliberately admin-only once auth/admin
-- roles exist (a later slice); the service-role key used by workers bypasses
-- RLS entirely, so writes are unaffected by the absence of a policy here.
