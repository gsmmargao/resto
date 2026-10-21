import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, toast, confirmDialog } from '../../utils.js';

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
  { id: 'waiter',      label: 'Waiter',       color: 'bg-sky-100 text-sky-700',       desc: 'Table orders, KOT firing (no billing)' },
  { id: 'chef',        label: 'Chef',         color: 'bg-orange-100 text-orange-700', desc: 'Kitchen display, KOT status' },
  { id: 'store_keeper',label: 'Store Keeper', color: 'bg-indigo-100 text-indigo-700', desc: 'Inventory, physical stock counts' },
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
    supabase.from('tenant_members').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabase.from('outlets').select('id, name, code, is_active').eq('tenant_id', tenantId).order('name'),
    supabase.from('member_outlets').select('member_id, outlet_id'),
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
        class: 'px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold',
        onclick: () => openSecurityModal(root),
      }, '🔒 Set Cancel Password'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openCreateStaffModal(root),
      }, '+ Create Staff'),
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

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });

  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search by name / phone / email…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.roleFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' }, 'All roles'),
    ...ROLES.map(r => el('option', { value: r.id, selected: state.roleFilter === r.id ? true : null }, r.label)),
  ]));

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.statusFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'active',   selected: state.statusFilter === 'active'   ? true : null }, 'Active only'),
    el('option', { value: 'inactive', selected: state.statusFilter === 'inactive' ? true : null }, 'Inactive only'),
    el('option', { value: 'all',      selected: state.statusFilter === 'all'      ? true : null }, 'All'),
  ]));

  return bar;
}

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
  const outletNames = [...outletIds].map(id => state.outlets.find(o => o.id === id)?.name).filter(Boolean);

  const card = el('div', { class: `bg-white rounded-xl border ${member.is_active ? 'border-slate-200' : 'border-dashed border-red-300 opacity-70'} overflow-hidden hover:shadow-md transition` });

  const head = el('div', { class: 'p-4 cursor-pointer', onclick: () => openMemberEditor(root, member) }, [
    el('div', { class: 'flex items-start gap-3' }, [
      el('div', { class: 'w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white font-bold flex items-center justify-center shrink-0' }, initial),
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'flex items-center gap-2' }, [
          el('div', { class: 'font-semibold text-slate-800 truncate' }, member.display_name || 'Unnamed'),
        ]),
        el('div', { class: `mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${meta.color}` }, meta.label),
        member.phone || member.employee_code
          ? el('div', { class: 'text-[11px] text-slate-500 mt-1.5 truncate' }, [member.phone, member.employee_code].filter(Boolean).join(' · '))
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
    el('button', {
      class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
      onclick: (e) => { e.stopPropagation(); openMemberEditor(root, member); },
    }, 'Edit'),
  ]);
  card.appendChild(foot);
  return card;
}

// ============================================================
// CREATE STAFF MODAL
// ============================================================
function openCreateStaffModal(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Create Staff Account'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  const emailIn = el('input', { type: 'email', placeholder: 'staff@example.com', class: inputCls });
  const passIn  = el('input', { type: 'text',  placeholder: 'Set Password (min 6 chars)', class: inputCls + ' font-mono' });
  const nameIn  = el('input', { type: 'text',  placeholder: 'Full name',            class: inputCls });
  const phoneIn = el('input', { type: 'tel',   placeholder: '+91 98765 43210',      class: inputCls });
  
  const roleSel = el('select', { class: inputCls },
    ROLES.map(r => el('option', { value: r.id, selected: r.id === 'waiter' ? true : null }, r.label)));

  body.appendChild(el('div', {}, [label('Email *'), emailIn]));
  body.appendChild(el('div', {}, [label('Password *'), passIn]));
  
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [label('Full name'), nameIn]),
    el('div', {}, [label('Phone'),     phoneIn]),
  ]));
  
  body.appendChild(el('div', {}, [label('Role *'), roleSel]));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl' }, [
    el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      id: 'btn-create-staff',
      class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
    }, 'Create Account'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  footer.querySelector('#btn-create-staff').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const email = emailIn.value.trim().toLowerCase();
    const password = passIn.value.trim();
    
    if (!email) { toast('Email is required', 'warn'); return; }
    if (password.length < 6) { toast('Password must be at least 6 characters', 'warn'); return; }

    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const { error } = await supabase.rpc('admin_create_staff', {
        p_email: email,
        p_password: password,
        p_name: nameIn.value.trim() || 'Staff',
        p_phone: phoneIn.value.trim() || null,
        p_role: roleSel.value
      });
      
      if (error) throw error;

      toast('Staff account created successfully!', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
}

// ============================================================
// EDIT MEMBER MODAL
// ============================================================
function openMemberEditor(root, member) {
  const meta = roleMeta(member.role);
  const isSelf = member.user_id === store.state.session?.user?.id;

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

  const nameIn  = el('input', { type: 'text', value: member.display_name || '', class: inputCls });
  const phoneIn = el('input', { type: 'tel',  value: member.phone || '',        class: inputCls });
  const codeIn  = el('input', { type: 'text', value: member.employee_code || '',class: inputCls });

  body.appendChild(el('div', {}, [label('Display name'), nameIn]));
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [label('Phone'), phoneIn]),
    el('div', {}, [label('Employee code'), codeIn]),
  ]));

  const roleSel = el('select', { class: inputCls, disabled: isSelf ? true : null },
    ROLES.map(r => el('option', { value: r.id, selected: member.role === r.id ? true : null }, r.label)));
  body.appendChild(el('div', {}, [label('Role'), roleSel]));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    el('button', {
      class: `px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`,
      disabled: isSelf ? true : null,
      onclick: async () => {
        if (isSelf) return;
        const ok = await confirmDialog(`Remove ${member.display_name || 'this member'}?`, 'Remove staff?');
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
      const patch = {
        display_name:  nameIn.value.trim() || null,
        phone:         phoneIn.value.trim() || null,
        employee_code: codeIn.value.trim() || null,
        role:          roleSel.value,
      };

      const { error } = await supabase.from('tenant_members').update(patch).eq('id', member.id);
      if (error) throw error;

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

function label(text) {
  return el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, text);
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

// ============================================================
// SECURITY SETTINGS MODAL (Cancel Order Password)
// ============================================================
function openSecurityModal(root) {
  const hasExisting = !!store.state.tenant?.settings?.cancel_password;
  
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });
  
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Security Settings'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, hasExisting 
    ? 'A cancel password is active. Enter a new one below to change it.' 
    : 'Set the password required to void or cancel an entire order.'));

  // New Cancel Password Input (Masked)
  const newPassIn = el('input', { 
    type: 'password', 
    placeholder: 'New Cancel Password', 
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono' 
  });

  // Admin Login Password Input (Masked) for Authorization
  const adminPassIn = el('input', { 
    type: 'password', 
    placeholder: 'Your Admin Login Password', 
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono mt-2' 
  });

  card.appendChild(el('label', { class: 'block text-left text-xs font-medium text-slate-600 mb-1 mt-2' }, 'New Cancel Password'));
  card.appendChild(newPassIn);
  
  card.appendChild(el('label', { class: 'block text-left text-xs font-medium text-slate-600 mb-1 mt-2' }, 'Verify Identity (Admin Password)'));
  card.appendChild(adminPassIn);

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-4' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const newPass = newPassIn.value.trim();
        const adminPass = adminPassIn.value.trim();
        
        if (!newPass) { toast('New password cannot be empty', 'warn'); return; }
        if (!adminPass) { toast('Please enter your admin password to confirm', 'warn'); return; }

        btn.disabled = true; btn.textContent = 'Verifying…';
        
        try {
          // 1. Verify the admin's identity using their login password
          const userEmail = store.state.session?.user?.email;
          const { error: authErr } = await supabase.auth.signInWithPassword({
            email: userEmail,
            password: adminPass
          });

          if (authErr) throw new Error('Incorrect admin password');

          // 2. Save the new cancel password to tenant settings
          const currentSettings = store.state.tenant.settings || {};
          const updatedSettings = { ...currentSettings, cancel_password: newPass };

          // 1. Perform the update
          const { error: dbErr } = await supabase.from('tenants')
            .update({ settings: updatedSettings })
            .eq('id', store.state.tenant.id);
            
          if (dbErr) throw dbErr;

          // 2. Verify it actually saved by fetching it back
          const { data: verifyData, error: vErr } = await supabase
            .from('tenants')
            .select('settings')
            .eq('id', store.state.tenant.id)
            .single();

          if (vErr) throw vErr;
          if (verifyData?.settings?.cancel_password !== newPass) {
            throw new Error('Database rejected the update (RLS issue)');
          }
          
          // 3. Update local store
          store.state.tenant.settings = updatedSettings;
          
          toast('Cancel password updated successfully!', 'success');
          overlay.remove();
        } catch (err) {
          console.error(err);
          toast(err.message || 'Failed to update password', 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      },
    }, 'Save'),
  ]);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => newPassIn.focus(), 50);
}
