import { createClient } from '@supabase/supabase-js';

export function createSupabaseBrowserClient() {
    const env = import.meta.env || {};
    const url = env.VITE_SUPABASE_URL;
    const anonKey = env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) return null;

    return createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
}
