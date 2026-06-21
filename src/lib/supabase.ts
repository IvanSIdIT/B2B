import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

export { isSupabaseConfigured };

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }

  if (!client) {
    client = createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey());
  }

  return client;
}
