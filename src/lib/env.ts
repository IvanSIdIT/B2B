export function getSupabaseUrl(): string {
  return (
    import.meta.env.SUPABASE_URL ??
    import.meta.env.VITE_SUPABASE_URL ??
    ""
  );
}

export function getSupabaseAnonKey(): string {
  return (
    import.meta.env.SUPABASE_ANON_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    ""
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}
