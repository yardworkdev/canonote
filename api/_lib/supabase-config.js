export const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
export const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
export const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || null;

export const hasSupabaseServiceConfig = Boolean(supabaseUrl && supabaseServiceKey);
