export async function createSupabaseBrowserClient() {
    const env = import.meta.env || {};
    const url = env.VITE_SUPABASE_URL;
    const anonKey = env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) return null;

    // Keep the sizeable Supabase SDK out of the local-only startup bundle.
    // Vite emits this as a separate cached chunk for cloud-enabled builds.
    const { createClient } = await import('@supabase/supabase-js');

    return createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
}
