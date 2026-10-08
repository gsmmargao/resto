import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, toast, confirmDialog } from '../../utils.js';
import { getLimit, showLimitGate } from '../entitlements.js';

const state = {
  members: [],
  outlets: [],
  memberOutlets: new Map(),
  search: '',
  roleFilter: 'all',
  statusFilter: 'active',
  loaded: false,
};

const ROLES = [
  { id: 'owner',       label: 'Owner',        color: 'bg-purple-100 text-purple-700', desc: 'Full control, billing, all settings' },
  { id: 'admin',       label: 'Admin',        color: 'bg-red-100 text-red-700',       desc: 'Manage everything except billing' },
  { id: 'manager',     label: 'Manager',      color: 'bg-amber-100 text-amber-700',   desc: 'Day-to-day operations, reports' },
  { id: 'cashier',     label: 'Cashier',      color: 'bg-emerald-100 text-emerald-700', desc: 'POS, billing, shift management' },
  { id: 'waiter',      label: 'Waiter',       color: 'bg-sky-100 text-sky-700',       desc: 'Table orders, KOT firing' },
  { id: 'chef',        label: 'Chef',         color: 'bg-orange-100 text-orange-700', desc: 'Kitchen display, KOT status' },
  { id: 'store_keeper',label: 'Store Keeper', color: 'bg-indigo-100 text-indigo-700', desc: 'Inventory, purchase, wastage' },
  { id: 'accountant',  label: 'Accountant',   color: 'bg-slate-200 text-slate-700',   desc: 'Financial reports, reconciliation' },
  { id: 'marketing',   label: 'Marketing',    color: 'bg-pink-100 text-pink-700',     desc: 'Campaigns, loyalty, customer data' },
  { id: 'viewer',      label: 'Viewer',       color: 'bg-slate-100 text-slate-600',   desc: 'Read-only access' },
];

const roleMeta = (id) => ROLES.find(r => r.id === id) || { label: id, color: 'bg-slate-100 text-slate-600', desc: '' };

export async function renderStaffAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading staff…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[staff-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;

  const [memRes, outRes, moRes] = await Promise.all([
    supabase.from('tenant_members')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('outlets')
      .select('id, name, code, is_active')
      .eq('tenant_id', tenantId)
      .order('name'),
    supabase.from('member_outlets')
      .select('member_id, outlet_id'),
  ]);

  state.members = memRes.data || [];
  state.outlets = outRes.data || [];

  state.memberOutlets = new Map();
  (moRes.data || []).forEach(row => {
    if (!state.memberOutlets.has(row.member_id)) state.memberOutlets.set(row.member_id, new Set());
    state.memberOutlets.get(row.member_id).add(row.outlet_id);
  });

  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Staff Management'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.members.length} member${state.members.length !== 1 ? 's' : ''}`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => {
          const limit = getLimit('staff');
          const active = state.members.filter(m => m.is_active).length;
          if (active >= limit) {
            showLimitGate('staff', active, limit, () => {
              document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove());
              location.hash = '#billing-upgrade';
            });
            return;
          }
          openInviteModal(root);
        },
      }, '+ Invite Staff'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderSummary());
  inner.appendChild(renderFilterBar(root));
  inner.appendChild(renderMemberList(root));
}

// ============================================================
// SUMMARY
// ============================================================
function renderSummary() {
  const active = state.members.filter(m => m.is_active);
  const inactive = state.members.filter(m => !m.is_active);
  const byRole = {};
  active.forEach(m => { byRole[m.role] = (byRole[m.role] || 0) + 1; });
  const pinCount = active.filter(m => m.pin_hash).length;

  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3' });
  grid.appendChild(kpi('Active Staff', String(active.length), 'from-emerald-500 to-emerald-600', `${inactive.length} inactive`));
  grid.appendChild(kpi('Roles in Use', String(Object.keys(byRole).length), 'from-indigo-500 to-indigo-600', `${ROLES.length} available`));
  grid.appendChild(kpi('POS PINs', String(pinCount), 'from-purple-500 to-purple-600', `${active.length - pinCount} without`));
  grid.appendChild(kpi('Outlets', String(state.outlets.length), 'from-amber-500 to-orange-500', 'Across tenant'));
  return grid;
}

function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

// ============================================================
// FILTER BAR
// ============================================================
function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });

  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search by name / phone / email…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));

  const roleSel = el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.roleFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' }, 'All roles'),
    ...ROLES.map(r => el('option', { value: r.id, selected: state.roleFilter === r.id ? true : null }, r.label)),
  ]);
  bar.appendChild(roleSel);

  const statSel = el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.statusFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'active',   selected: state.statusFilter === 'active'   ? true : null }, 'Active only'),
    el('option', { value: 'inactive', selected: state.statusFilter === 'inactive' ? true : null }, 'Inactive only'),
    el('option', { value: 'all',      selected: state.statusFilter === 'all'      ? true : null }, 'All'),
  ]);
  bar.appendChild(statSel);

  return bar;
}

// ============================================================
// MEMBER LIST
// ============================================================
function renderMemberList(root) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Team'),
    el('span', { class: 'text-xs text-slate-500' }, `${applyFilters().length} matching`),
  ]));

  const filtered = applyFilters();

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No staff match'));
    return card;
  }

  const grid = el('div', { class: 'p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' });
  filtered.forEach(m => grid.appendChild(buildMemberCard(m, root)));
  card.appendChild(grid);
  return card;
}

function applyFilters() {
  return state.members.filter(m => {
    if (state.statusFilter === 'active'   && !m.is_active) return false;
    if (state.statusFilter === 'inactive' && m.is_active)  return false;
    if (state.roleFilter !== 'all' && m.role !== state.roleFilter) return false;
    if (state.search) {
      const hay = `${m.display_name || ''} ${m.phone || ''} ${m.employee_code || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

function buildMemberCard(member, root) {
  const meta = roleMeta(member.role);
  const initial = (member.display_name || member.role || '?').charAt(0).toUpperCase();
  const outletIds = state.memberOutlets.get(member.id) || new Set();
  const outletNames = [...outletIds]
    .map(id => state.outlets.find(o => o.id === id)?.name)
    .filter(Boolean);

  const card = el('div', { class: `bg-white rounded-xl border ${member.is_active ? 'border-slate-200' : 'border-dashed border-red-300 opacity-70'} overflow-hidden hover:shadow-md transition` });

  const head = el('div', { class: 'p-4 cursor-pointer', onclick: () => openMemberEditor(root, member) }, [
    el('div', { class: 'flex items-start gap-3' }, [
      el('div', { class: 'w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white font-bold flex items-center justify-center shrink-0' }, initial),
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'flex items-center gap-2' }, [
          el('div', { class: 'font-semibold text-slate-800 truncate' }, member.display_name || 'Unnamed'),
          member.pin_hash ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold shrink-0' }, 'PIN') : null,
        ].filter(Boolean)),
        el('div', { class: `mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${meta.color}` }, meta.label),
        member.phone || member.employee_code
          ? el('div', { class: 'text-[11px] text-slate-500 mt-1.5 truncate' },
              [member.phone, member.employee_code].filter(Boolean).join(' · '))
          : null,
      ].filter(Boolean)),
    ]),
  ]);
  card.appendChild(head);

  const meta2 = el('div', { class: 'px-4 pb-3 text-[11px] text-slate-500 space-y-1' });
  if (outletNames.length) {
    meta2.appendChild(el('div', { class: 'truncate' }, '📍 ' + outletNames.join(', ')));
  } else {
    meta2.appendChild(el('div', { class: 'text-amber-600' }, '📍 All outlets (or none assigned)'));
  }
  card.appendChild(meta2);

  const foot = el('div', { class: 'px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between' }, [
    el('button', {
      class: `text-[10px] font-semibold px-2 py-0.5 rounded-full ${member.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`,
      onclick: async (e) => {
        e.stopPropagation();
        const next = !member.is_active;
        const { error } = await supabase.from('tenant_members').update({ is_active: next }).eq('id', member.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        member.is_active = next;
        toast(next ? 'Activated' : 'Deactivated', 'success', 1200);
        paint(root);
      },
    }, member.is_active ? '● ACTIVE' : '○ INACTIVE'),

    el('div', { class: 'flex items-center gap-1' }, [
      el('button', {
        class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
        onclick: (e) => { e.stopPropagation(); openMemberEditor(root, member); },
      }, 'Edit'),
    ]),
  ]);
  card.appendChild(foot);
  return card;
}

// ============================================================
// INVITE MODAL
// ============================================================
function openInviteModal(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Invite Staff Member'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  const emailIn = el('input', { type: 'email', placeholder: 'staff@example.com', class: inputCls });
  const nameIn  = el('input', { type: 'text',  placeholder: 'Full name',            class: inputCls });
  const phoneIn = el('input', { type: 'tel',   placeholder: '+91 98765 43210',      class: inputCls });
  const codeIn  = el('input', { type: 'text',  placeholder: 'Employee code (e.g. EMP001)', class: inputCls });

  const roleSel = el('select', { class: inputCls },
    ROLES.map(r => el('option', { value: r.id, selected: r.id === 'waiter' ? true : null }, r.label)));

  body.appendChild(el('div', {}, [label('Email *'), emailIn]));
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [label('Full name'), nameIn]),
    el('div', {}, [label('Phone'),     phoneIn]),
  ]));
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [label('Employee code'), codeIn]),
    el('div', {}, [label('Role *'),        roleSel]),
  ]));

  // Outlet access
  const outletGrid = el('div', { class: 'space-y-1.5 pt-2 border-t border-slate-100' }, [
    label('Outlet access'),
    el('p', { class: 'text-[11px] text-slate-500 mb-2' }, 'Leave all unchecked to grant access to every outlet.'),
  ]);
  const outletChecks = new Map();
  state.outlets.forEach(o => {
    const cb = el('input', { type: 'checkbox', class: 'mt-0.5' });
    outletChecks.set(o.id, cb);
    outletGrid.appendChild(el('label', { class: 'flex items-start gap-2 text-sm text-slate-700 cursor-pointer py-1' }, [
      cb,
      el('span', {}, o.name + (o.is_active ? '' : ' (inactive)')),
    ]));
  });
  body.appendChild(outletGrid);

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl' }, [
    el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      id: 'btn-invite',
      class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
    }, 'Send Invite'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  footer.querySelector('#btn-invite').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const email = emailIn.value.trim().toLowerCase();
    if (!email) { toast('Email is required', 'warn'); return; }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('invite-staff', {
        body: {
          email,
          full_name:     nameIn.value.trim(),
          phone:         phoneIn.value.trim(),
          employee_code: codeIn.value.trim(),
          role:          roleSel.value,
          outlet_ids:    [...outletChecks.entries()].filter(([, cb]) => cb.checked).map(([id]) => id),
          tenant_id:     store.state.tenant.id,
        },
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });

      if (res.error) {
        // Fallback: create a shell member without an auth user
        console.warn('[invite] edge function unavailable:', res.error);
        const fallback = await createMemberWithoutAuth({
          email,
          name: nameIn.value.trim(),
          phone: phoneIn.value.trim(),
          code: codeIn.value.trim(),
          role: roleSel.value,
          outletIds: [...outletChecks.entries()].filter(([, cb]) => cb.checked).map(([id]) => id),
        });
        if (!fallback) throw new Error('Could not create member');
      }

      toast('Staff member added', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Invite failed: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'Send Invite';
    }
  });
}

async function createMemberWithoutAuth({ email, name, phone, code, role, outletIds }) {
  // Insert into tenant_members directly. user_id will be null until they sign up
  // and a DB trigger links it by email match.
  const tenantId = store.state.tenant.id;

  const { data, error } = await supabase.from('tenant_members').insert({
    tenant_id:     tenantId,
    user_id:       null,
    role:          role,
    display_name:  name || null,
    phone:         phone || null,
    employee_code: code || null,
    is_active:     true,
  }).select().single();

  if (error) { toast('Insert failed: ' + error.message, 'error'); return null; }

  if (outletIds.length) {
    await supabase.from('member_outlets').insert(
      outletIds.map(id => ({ member_id: data.id, outlet_id: id })),
    );
  }
  return data;
}

// ============================================================
// EDIT MEMBER
// ============================================================
function openMemberEditor(root, member) {
  const meta = roleMeta(member.role);
  const isSelf = member.user_id === store.state.session?.user?.id;
  const isOwner = member.role === 'owner';

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, member.display_name || 'Edit Staff'),
      el('p', { class: `text-xs mt-0.5 px-2 py-0.5 rounded-full inline-block font-semibold uppercase tracking-wide ${meta.color}` }, meta.label),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  // Read-only email / user id
  if (member.user_id) {
    body.appendChild(readonlyRow('User ID', member.user_id.slice(0, 16) + '…'));
  } else {
    body.appendChild(el('div', { class: 'text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3' },
      'This member has no linked login yet. Ask them to sign up with the invite email, then an admin can link the account.'));
  }

  const nameIn  = el('input', { type: 'text', value: member.display_name || '', class: inputCls });
  const phoneIn = el('input', { type: 'tel',  value: member.phone || '',        class: inputCls });
  const codeIn  = el('input', { type: 'text', value: member.employee_code || '',class: inputCls });

  body.appendChild(el('div', {}, [label('Display name'), nameIn]));
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [label('Phone'), phoneIn]),
    el('div', {}, [label('Employee code'), codeIn]),
  ]));

  // Role — cannot demote last owner; cannot self-demote
  const roleSel = el('select', { class: inputCls, disabled: isSelf && isOwner ? true : null },
    ROLES.map(r => el('option', { value: r.id, selected: member.role === r.id ? true : null }, r.label)));
  body.appendChild(el('div', {}, [label('Role'), roleSel]));
  body.appendChild(el('p', { class: 'text-[11px] text-slate-500 -mt-2' }, meta.desc || ''));

  // Outlet access
  const currentSet = state.memberOutlets.get(member.id) || new Set();
  const outletGrid = el('div', { class: 'space-y-1.5 pt-2 border-t border-slate-100' }, [
    label('Outlet access'),
    el('p', { class: 'text-[11px] text-slate-500 mb-2' }, 'Leave all unchecked to grant access to every outlet.'),
  ]);
  const outletChecks = new Map();
  state.outlets.forEach(o => {
    const cb = el('input', { type: 'checkbox', class: 'mt-0.5', checked: currentSet.has(o.id) ? true : null });
    outletChecks.set(o.id, cb);
    outletGrid.appendChild(el('label', { class: 'flex items-start gap-2 text-sm text-slate-700 cursor-pointer py-1' }, [
      cb,
      el('span', {}, o.name + (o.is_active ? '' : ' (inactive)')),
    ]));
  });
  body.appendChild(outletGrid);

  // PIN management
  const pinSection = el('div', { class: 'pt-2 border-t border-slate-100 space-y-2' }, [
    label('POS PIN (4–6 digits)'),
    el('p', { class: 'text-[11px] text-slate-500' },
      member.pin_hash
        ? 'A PIN is set. Enter a new one to change it, or click Clear to remove.'
        : 'No PIN set. Staff can use this PIN for fast POS login on shared terminals.'),
  ]);
  const pinIn = el('input', {
    type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '••••',
    class: inputCls + ' tracking-widest',
  });
  pinSection.appendChild(pinIn);
  if (member.pin_hash) {
    pinSection.appendChild(el('button', {
      class: 'text-[11px] text-red-600 hover:text-red-700 underline',
      onclick: async (e) => {
        e.preventDefault();
        if (!confirm('Clear PIN for this staff member?')) return;
        const { error } = await supabase.from('tenant_members').update({ pin_hash: null }).eq('id', member.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('PIN cleared', 'success');
        member.pin_hash = null;
        overlay.remove();
        paint(root);
      },
    }, 'Clear PIN'));
  }
  body.appendChild(pinSection);

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    el('button', {
      class: `px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`,
      disabled: isSelf ? true : null,
      onclick: async () => {
        if (isSelf) return;
        const ok = await confirmDialog(
          `Remove ${member.display_name || 'this member'} from the team? Their historical orders and payments will remain.`,
          'Remove staff member?',
        );
        if (!ok) return;
        const { error } = await supabase.from('tenant_members').delete().eq('id', member.id);
        if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
        toast('Staff member removed', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      },
    }, isSelf ? 'Cannot remove self' : 'Remove'),

    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        id: 'btn-save-member',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, 'Save Changes'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  footer.querySelector('#btn-save-member').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const pin = pinIn.value.trim();
      if (pin && (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) {
        throw new Error('PIN must be 4–6 digits');
      }

      const patch = {
        display_name:  nameIn.value.trim() || null,
        phone:         phoneIn.value.trim() || null,
        employee_code: codeIn.value.trim() || null,
        role:          roleSel.value,
      };

      // PIN: hash via pgcrypto in a secure RPC
      if (pin) {
        const { error: pinErr } = await supabase.rpc('set_member_pin', {
          p_member_id: member.id,
          p_pin: pin,
        });
        if (pinErr) throw pinErr;
      }

      const { error } = await supabase.from('tenant_members').update(patch).eq('id', member.id);
      if (error) throw error;

      // Outlet assignments
      const selectedIds = [...outletChecks.entries()].filter(([, cb]) => cb.checked).map(([id]) => id);
      await supabase.from('member_outlets').delete().eq('member_id', member.id);
      if (selectedIds.length) {
        const { error: moErr } = await supabase.from('member_outlets').insert(
          selectedIds.map(id => ({ member_id: member.id, outlet_id: id })),
        );
        if (moErr) throw moErr;
      }

      toast('Changes saved', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

function readonlyRow(labelText, value) {
  return el('div', { class: 'text-xs text-slate-500 flex justify-between py-1 border-b border-dashed border-slate-200' }, [
    el('span', { class: 'font-medium' }, labelText),
    el('span', { class: 'font-mono text-slate-400' }, value),
  ]);
}

function label(text) {
  return el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, text);
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
