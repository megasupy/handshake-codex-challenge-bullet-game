import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) {
    return client;
  }

  const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    client = null;
    return client;
  }

  client = createClient(url, anonKey);
  return client;
}
