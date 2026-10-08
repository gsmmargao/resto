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

/**
 * Verify a POS PIN against the tenant's active members.
 * Returns the matched member record (id, user_id, display_name)
 * or null if no match. Does NOT create a Supabase session.
 */
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
  store.set('member',  null);
  store.set('tenant',  null);
  store.set('outlet',  null);
  store.set('cashRegister', null);
}

export async function loadContext() {
  const session = await getSession();
  if (!session) return null;

  store.set('session', session);

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  store.set('profile', profile);

  const { data: member, error: mErr } = await supabase
    .from('tenant_members')
    .select('*, tenants(*), member_outlets(outlet_id, outlets(*))')
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (mErr) { console.error(mErr); toast('Failed to load membership', 'error'); return null; }
  if (!member) { toast('No active membership found', 'warn'); return null; }

  store.set('member', member);
  store.set('tenant', member.tenants);

  // Build the list of outlets this member can access
  const assignedOutlets = (member.member_outlets || [])
    .map(a => a.outlets)
    .filter(Boolean);

  let availableOutlets = assignedOutlets;
  if (!availableOutlets.length) {
    // Owner/admin/manager (or members with no explicit assignment) get every active outlet
    const res = await supabase
      .from('outlets')
      .select('*')
      .eq('tenant_id', member.tenant_id)
      .eq('is_active', true)
      .order('name');
    availableOutlets = res.data || [];
  }

  // Pick the active outlet: saved preference > first available
  const savedId = localStorage.getItem('resto-active-outlet');
  const savedMatch = savedId ? availableOutlets.find(o => o.id === savedId) : null;
  const active = savedMatch || availableOutlets[0] || null;

  // If saved ID is no longer valid, clean it up
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
