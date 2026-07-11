import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Service-role client -- worker jobs (GitHub Actions) and server-only Next.js
 * Route Handlers (e.g. apps/web's /api/track), never client components.
 * Bypasses RLS entirely, per DEPLOYMENT.md §4: SUPABASE_SERVICE_ROLE_KEY must
 * live only in GitHub Actions secrets and Vercel's server-only env vars,
 * never in NEXT_PUBLIC_* or anything that reaches the browser bundle.
 */
export function createServiceClient(): TypedSupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Browser/anon client -- apps/web (Layer A, API.md §1). RLS-secured; safe to
 * use the anon key here since Postgres Row-Level Security (DATABASE.md §8,
 * supabase/migrations/0001_init.sql) enforces what it can actually read.
 */
export function createBrowserClient(): TypedSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example)",
    );
  }
  return createClient<Database>(url, key);
}
