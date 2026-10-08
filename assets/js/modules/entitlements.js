import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast } from '../utils.js';

// ============================================================
// STATE — cached in store
// ============================================================
let _loaded = false;

export async function loadEntitlements() {
  const tenantId = store.state.tenant?.id;
  if (!tenantId) return null;

  try {
    const { data, error } = await supabase
      .from('v_tenant_subscription')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      console.warn('[entitlements] no subscription row found');
      store.set('subscription', null);
      store.set('features', new Set());
      store.set('limits', {});
      return null;
    }

    // Parse features from JSON
    const featuresJson = data.plan_features || {};
    const featuresSet = new Set(
      Object.entries(featuresJson)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
    );

    // Compute effective status
    const trialDaysLeft = data.trial_days_left ?? null;
    let effective = data.effective_status;

    // Auto-downgrade: trial past due → readonly (but allow if within 7 days)
    if (data.tenant_status === 'trial' && trialDaysLeft !== null && trialDaysLeft < 0) {
      const overdueDays = Math.abs(trialDaysLeft);
      if (overdueDays > 7) effective = 'readonly';
      else effective = 'trial_grace';
    }

    store.set('subscription', {
      ...data,
      trial_days_left: trialDaysLeft,
      effective_status: effective,
    });
    store.set('features', featuresSet);
    store.set('limits', data.plan_limits || {});
    _loaded = true;

    console.log('[entitlements] loaded', {
      plan: data.plan_code,
      status: data.tenant_status,
      trial_days_left: trialDaysLeft,
      effective: effective,
      features: [...featuresSet],
    });

    return data;
  } catch (err) {
    console.error('[entitlements] load failed', err);
    return null;
  }
}

// ============================================================
// PUBLIC HELPERS
// ============================================================
export function hasFeature(key) {
  const set = store.state.features;
  if (!set) return false;
  return set.has(key);
}

export function getLimit(key) {
  const limits = store.state.limits;
  if (!limits) return 999999;
  const v = limits[key];
  return v === undefined ? 999999 : Number(v);
}

export function canCreate(resource, currentCount) {
  if (currentCount === undefined) return true;
  const limit = getLimit(resource);
  return currentCount < limit;
}

export function getSubscription() {
  return store.state.subscription;
}

export function isReadOnly() {
  const s = store.state.subscription;
  if (!s) return false;
  return s.effective_status === 'readonly' || s.effective_status === 'blocked';
}

export function isTrialExpiringSoon() {
  const s = store.state.subscription;
  if (!s || s.tenant_status !== 'trial') return false;
  const days = s.trial_days_left;
  return days !== null && days <= 3 && days >= 0;
}

export function isTrialExpired() {
  const s = store.state.subscription;
  if (!s || s.tenant_status !== 'trial') return false;
  const days = s.trial_days_left;
  return days !== null && days < 0;
}

// ============================================================
// UI: plan badge for topbar
// ============================================================
export function buildPlanBadge(onUpgradeClick) {
  const s = store.state.subscription;
  const badge = el('button', {
    class: 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition',
    onclick: () => onUpgradeClick && onUpgradeClick(),
  });

  if (!s) {
    badge.className = 'hidden';
    return badge;
  }

  const status = s.effective_status || s.tenant_status;
  const planName = s.plan_name || s.plan_code || 'plan';

  let colorCls, label;
  if (status === 'active') {
    colorCls = 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200';
    label = planName;
  } else if (status === 'trial' || status === 'trial_grace') {
    const days = s.trial_days_left ?? 0;
    colorCls = days <= 3 ? 'bg-amber-900/40 hover:bg-amber-900/60 text-amber-200' : 'bg-indigo-900/40 hover:bg-indigo-900/60 text-indigo-200';
    label = `${planName} · ${days}d trial`;
  } else if (status === 'past_due') {
    colorCls = 'bg-orange-900/40 hover:bg-orange-900/60 text-orange-200';
    label = `${planName} · past due`;
  } else if (status === 'readonly') {
    colorCls = 'bg-red-900/40 hover:bg-red-900/60 text-red-200';
    label = 'Read-only';
  } else {
    colorCls = 'bg-slate-800 hover:bg-slate-700 text-slate-300';
    label = planName;
  }

  badge.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${colorCls}`;
  badge.appendChild(el('span', { class: 'text-[10px]' }, '⭐'));
  badge.appendChild(el('span', {}, label));
  badge.title = `Plan: ${planName} · Status: ${status}`;
  return badge;
}

// ============================================================
// UI: trial banner (top of dashboard)
// ============================================================
export function maybeTrialBanner(onUpgradeClick) {
  const s = store.state.subscription;
  if (!s) return null;

  const status = s.effective_status;

  if (status === 'readonly' || status === 'blocked') {
    return el('div', { class: 'bg-red-600 text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2' }, [
      el('div', { class: 'flex items-center gap-2 text-sm' }, [
        el('span', { class: 'text-lg' }, '🔒'),
        el('span', { class: 'font-medium' }, 'Read-only mode — your trial has ended. Upgrade to continue using RestoPOS.'),
      ]),
      el('button', {
        class: 'px-4 py-1.5 rounded-lg bg-white text-red-700 text-sm font-bold hover:bg-red-50 transition',
        onclick: () => onUpgradeClick && onUpgradeClick(),
      }, 'Upgrade now'),
    ]);
  }

  if (status === 'trial_grace') {
    return el('div', { class: 'bg-orange-500 text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2' }, [
      el('div', { class: 'flex items-center gap-2 text-sm' }, [
        el('span', { class: 'text-lg' }, '⏰'),
        el('span', { class: 'font-medium' }, `Trial expired ${Math.abs(s.trial_days_left)} day(s) ago. Grace period ends in ${7 - Math.abs(s.trial_days_left)} day(s).`),
      ]),
      el('button', {
        class: 'px-4 py-1.5 rounded-lg bg-white text-orange-700 text-sm font-bold hover:bg-orange-50 transition',
        onclick: () => onUpgradeClick && onUpgradeClick(),
      }, 'Upgrade'),
    ]);
  }

  if (status === 'trial' && s.trial_days_left !== null && s.trial_days_left <= 3) {
    return el('div', { class: 'bg-amber-100 border-b border-amber-200 text-amber-800 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2' }, [
      el('div', { class: 'flex items-center gap-2 text-sm' }, [
        el('span', { class: 'text-lg' }, '⏳'),
        el('span', { class: 'font-medium' }, `Trial ends in ${s.trial_days_left} day${s.trial_days_left === 1 ? '' : 's'}. Upgrade to keep full access.`),
      ]),
      el('button', {
        class: 'px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition',
        onclick: () => onUpgradeClick && onUpgradeClick(),
      }, 'See plans'),
    ]);
  }

  if (status === 'past_due') {
    return el('div', { class: 'bg-orange-100 border-b border-orange-200 text-orange-800 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2' }, [
      el('div', { class: 'flex items-center gap-2 text-sm' }, [
        el('span', { class: 'text-lg' }, '💳'),
        el('span', { class: 'font-medium' }, 'Your last payment failed. Update your payment method to avoid suspension.'),
      ]),
      el('button', {
        class: 'px-4 py-1.5 rounded-lg bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 transition',
        onclick: () => onUpgradeClick && onUpgradeClick(),
      }, 'Fix payment'),
    ]);
  }

  return null;
}

// ============================================================
// UI: upgrade gate — shown when a feature isn't available
// ============================================================
export function showUpgradeGate(featureLabel, onUpgradeClick) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center' });

  card.appendChild(el('div', { class: 'w-16 h-16 rounded-full bg-amber-100 mx-auto flex items-center justify-center mb-4' }, [
    el('span', { class: 'text-3xl' }, '🔒'),
  ]));
  card.appendChild(el('h3', { class: 'text-xl font-bold text-slate-800 mb-2' }, 'Upgrade required'));
  card.appendChild(el('p', { class: 'text-sm text-slate-600 mb-6' }, `${featureLabel} isn't included in your current plan. Upgrade to unlock this and more.`));

  card.appendChild(el('div', { class: 'space-y-2' }, [
    el('button', {
      class: 'w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition',
      onclick: () => { overlay.remove(); onUpgradeClick && onUpgradeClick(); },
    }, 'View plans'),
    el('button', {
      class: 'w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
      onclick: () => overlay.remove(),
    }, 'Maybe later'),
  ]));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// UI: usage limit gate
// ============================================================
export function showLimitGate(resource, current, limit, onUpgradeClick) {
  const resourceLabel = {
    outlets: 'outlets',
    staff: 'staff members',
    items: 'menu items',
    customers: 'customers',
  }[resource] || resource;

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center' });

  card.appendChild(el('div', { class: 'w-16 h-16 rounded-full bg-amber-100 mx-auto flex items-center justify-center mb-4' }, [
    el('span', { class: 'text-3xl' }, '📊'),
  ]));
  card.appendChild(el('h3', { class: 'text-xl font-bold text-slate-800 mb-2' }, 'Plan limit reached'));
  card.appendChild(el('p', { class: 'text-sm text-slate-600 mb-1' }, `You've used ${current} of ${limit} ${resourceLabel}.`));
  card.appendChild(el('p', { class: 'text-xs text-slate-500 mb-6' }, 'Upgrade to add more.'));

  card.appendChild(el('div', { class: 'space-y-2' }, [
    el('button', {
      class: 'w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition',
      onclick: () => { overlay.remove(); onUpgradeClick && onUpgradeClick(); },
    }, 'Upgrade plan'),
    el('button', {
      class: 'w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
      onclick: () => overlay.remove(),
    }, 'Close'),
  ]));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
