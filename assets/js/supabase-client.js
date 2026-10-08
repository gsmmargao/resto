import { CONFIG } from '../../config.js';

let createClient;
try {
  const mod = await import('./lib/supabase.esm.js');
  if (mod.__FALLBACK__) throw new Error('fallback');
  createClient = mod.createClient;
} catch {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  createClient = mod.createClient;
}

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'resto-auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
