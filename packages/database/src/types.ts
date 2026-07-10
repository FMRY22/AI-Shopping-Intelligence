// Hand-maintained to match supabase/migrations/0001_init.sql.
// Once a live Supabase project exists, replace with generated types via
// `supabase gen types typescript --project-id <id> > src/types.ts` and keep
// this file's shape (a `Database` type consumed by `createClient<Database>`)
// so nothing downstream needs to change.
//
// IMPORTANT: every row shape below must be declared with `type`, not
// `interface` -- @supabase/supabase-js's generic constraints check each
// table against `Record<string, unknown>`, and TypeScript only infers the
// implicit index signature that satisfies that check for object type
// literals (`type X = {...}`), not for `interface X {...}` declarations.
// Using `interface` here silently collapses every query's return type to
// `never` with no error at the `Database` definition site -- it only
// surfaces as confusing "Property does not exist on type 'never'" errors
// at every call site. Confirmed by isolated repro against
// @supabase/supabase-js@2.110.2 during this slice's implementation.

type RetailersRow = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  base_url: string;
  logo_url: string | null;
  worker_workflow: string | null;
  is_active: boolean;
};

type CategoriesRow = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  parent_id: string | null;
};

type ProductsRow = {
  id: string;
  retailer_id: string;
  retailer_product_id: string;
  url: string;
  category_id: string | null;
  title_en: string;
  title_ar: string | null;
  image_url: string | null;
  current_price: number | null;
  currency: string;
  in_stock: boolean;
  rating_avg: number | null;
  rating_count: number;
  specs: Record<string, unknown> | null;
  popularity_score: number;
  volatility_score: number;
  check_interval: string;
  last_checked_at: string | null;
  next_due_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type PriceHistoryRow = {
  id: number;
  product_id: string;
  price: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
};

type PriceHistoryDailyRow = {
  id: number;
  product_id: string;
  day: string;
  open_price: number;
  close_price: number;
  min_price: number;
  max_price: number;
  currency: string;
};

type WorkerRunsRow = {
  id: string;
  retailer_id: string | null;
  worker_name: string;
  started_at: string;
  finished_at: string | null;
  status: "success" | "partial" | "failed";
  items_processed: number;
  error_message: string | null;
};

export type Database = {
  public: {
    Tables: {
      retailers: {
        Row: RetailersRow;
        Insert: Partial<RetailersRow> &
          Pick<RetailersRow, "slug" | "name_en" | "name_ar" | "base_url">;
        Update: Partial<RetailersRow>;
        Relationships: [];
      };
      categories: {
        Row: CategoriesRow;
        Insert: Partial<CategoriesRow> & Pick<CategoriesRow, "slug" | "name_en" | "name_ar">;
        Update: Partial<CategoriesRow>;
        Relationships: [];
      };
      products: {
        Row: ProductsRow;
        Insert: Partial<ProductsRow> &
          Pick<ProductsRow, "retailer_id" | "retailer_product_id" | "url" | "title_en">;
        Update: Partial<ProductsRow>;
        Relationships: [];
      };
      price_history: {
        Row: PriceHistoryRow;
        Insert: Partial<PriceHistoryRow> &
          Pick<PriceHistoryRow, "product_id" | "price" | "currency" | "in_stock">;
        Update: Partial<PriceHistoryRow>;
        Relationships: [];
      };
      price_history_daily: {
        Row: PriceHistoryDailyRow;
        Insert: Partial<PriceHistoryDailyRow> &
          Pick<
            PriceHistoryDailyRow,
            "product_id" | "day" | "open_price" | "close_price" | "min_price" | "max_price" | "currency"
          >;
        Update: Partial<PriceHistoryDailyRow>;
        Relationships: [];
      };
      worker_runs: {
        Row: WorkerRunsRow;
        Insert: Partial<WorkerRunsRow> & Pick<WorkerRunsRow, "worker_name" | "started_at" | "status">;
        Update: Partial<WorkerRunsRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_due_items: {
        Args: { p_retailer_slug: string; p_limit?: number };
        Returns: ProductsRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Product = ProductsRow;
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type PriceHistoryInsert = Database["public"]["Tables"]["price_history"]["Insert"];
export type WorkerRunInsert = Database["public"]["Tables"]["worker_runs"]["Insert"];
export type Retailer = RetailersRow;
