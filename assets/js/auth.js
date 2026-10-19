import { supabase } from './supabase-client.js';
import { store } from './store.js';
import { toast } from './utils.js';

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function verifyPin(tenantId, pin) {
  if (!tenantId || !pin) return null;
  const { data, error } = await supabase.rpc('login_with_pin', {
    p_tenant_id: tenantId,
    p_pin: pin,
  });
  if (error) { console.error('[auth] verifyPin', error); return null; }
  return data || null;
}

export async function signOut() {
  await supabase.auth.signOut();
  store.set('session', null);
  store.set('profile', null);
  store.set('member', null);
  store.set('tenant', null);
  store.set('outlet', null);
  store.set('cashRegister', null);
  store.set('subscription', null);
  store.set('features', new Set());
}

// ============================================================
// Load a member row — takes the first match, never errors on multi-row
// ============================================================
async function fetchMembership(userId) {
  const { data, error } = await supabase
    .from('tenant_members')
    .select('*, tenants(*), member_outlets(outlet_id, outlets(*))')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[auth] fetchMembership error', error);
    return null;
  }
  return (data && data[0]) || null;
}

// ============================================================
// Ensure tenant exists for the current user
// ============================================================
async function ensureTenant() {
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) {
    console.error('[auth] getUser failed', uErr);
    return null;
  }

  console.log('[auth] ensureTenant for', user.email);

  // Fallback Super Admin check (in case loadContext missed it)
  const { data: profile } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle();
  if (profile?.is_super_admin) {
    console.log('[auth] ensureTenant bypassed — user is super admin');
    return null;
  }

  // Already has a membership?
  const { count, error: cErr } = await supabase
    .from('tenant_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (cErr) console.error('[auth] count query error', cErr);

  if ((count || 0) > 0) {
    console.log('[auth] user already has a membership row');
    return null;
  }

  // Read signup metadata
  const meta = user.user_metadata || {};
  console.log('[auth] metadata', meta);

  const restaurantName = meta.restaurant_name || meta.pending_restaurant || null;

  if (!restaurantName) {
    console.warn('[auth] no restaurant_name in metadata — cannot auto-onboard');
    return { needsOnboarding: true };
  }

  console.log('[auth] calling signup_tenant RPC with:', restaurantName, meta.plan_code || 'starter');

  const { data, error } = await supabase.rpc('signup_tenant', {
    p_restaurant_name: restaurantName,
    p_owner_name:      meta.full_name || meta.owner_name || null,
    p_phone:           meta.phone || null,
    p_city:            meta.city || null,
    p_state_code:      meta.state_code || '27',
    p_country:         meta.country || 'IN',
    p_plan_code:       meta.plan_code || 'starter',
  });

  if (error) {
    console.error('[auth] signup_tenant RPC error:', error);
    // Surface the real error — helps debug in production
    toast('Could not create restaurant: ' + (error.message || 'unknown error'), 'error', 8000);
    return null;
  }

  console.log('[auth] signup_tenant returned:', data);
  toast(`Welcome! Your 14-day trial for "${restaurantName}" has started.`, 'success', 4000);

  // Brief pause so the DB transaction is guaranteed visible to subsequent reads
  await new Promise(r => setTimeout(r, 300));
  return data;
}

export async function loadContext() {
  const session = await getSession();
  if (!session) return null;

  store.set('session', session);

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  store.set('profile', profile);

  // First attempt
  let member = await fetchMembership(session.user.id);

  // If no membership, try to auto-onboard from signup metadata
  if (!member) {
    const result = await ensureTenant();

    if (result?.needsOnboarding) {
      return { needsOnboarding: true, session, profile };
    }

    // Retry after ensureTenant
    member = await fetchMembership(session.user.id);

    if (!member) {
      console.error('[auth] still no membership after onboarding attempt');
      // Don't sign out — let the user retry, or show onboarding modal as fallback
      return { needsOnboarding: true, session, profile };
    }
  }

  store.set('member', member);
  store.set('tenant', member.tenants);

  // Build the list of outlets this member can access
  const assignedOutlets = (member.member_outlets || [])
    .map(a => a.outlets)
    .filter(Boolean);

  let availableOutlets = assignedOutlets;
  if (!availableOutlets.length) {
    const res = await supabase
      .from('outlets').select('*')
      .eq('tenant_id', member.tenant_id)
      .eq('is_active', true)
      .order('name');
    availableOutlets = res.data || [];
  }

  // Pick the active outlet
  const savedId = localStorage.getItem('resto-active-outlet');
  const savedMatch = savedId ? availableOutlets.find(o => o.id === savedId) : null;
  const active = savedMatch || availableOutlets[0] || null;

  if (savedId && !savedMatch) {
    localStorage.removeItem('resto-active-outlet');
  }

  store.set('availableOutlets', availableOutlets);
  store.set('outlet', active);
  return { session, profile, member, tenant: member.tenants, outlet: active, outlets: availableOutlets };
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}
