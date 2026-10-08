import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, fmtRelative, toast, confirmDialog } from '../../utils.js';

const state = {
  tenants: [],
  search: '',
  statusFilter: 'all',
  planFilter: 'all',
  loaded: false,
  selected: null,
};

export async function renderSuperAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading tenants…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[super-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const { data, error } = await supabase.rpc('list_all_tenants');
  if (error) throw error;
  state.tenants = data || [];
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, '🛡 Super Admin'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.tenants.length} tenant${state.tenants.length !== 1 ? 's' : ''} on the platform`),
    ]),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium',
      onclick: async (e) => { const b = e.currentTarget; b.disabled = true; await refresh(); paint(root); toast('Refreshed', 'success', 1000); b.disabled = false; },
    }, 'Refresh'),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);

  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderKPIs());
  inner.appendChild(renderFilterBar(root));
  inner.appendChild(renderTable(root));

  if (state.selected) inner.appendChild(renderDetailPanel(root, state.selected));
}

function renderKPIs() {
  const active = state.tenants.filter(t => t.status === 'active' || t.status === 'trial');
  const trials = state.tenants.filter(t => t.status === 'trial');
  const suspended = state.tenants.filter(t => t.status === 'suspended');
  const totalRevenue = state.tenants.reduce((s, t) => s + Number(t.total_revenue || 0), 0);
  const totalOrders = state.tenants.reduce((s, t) => s + Number(t.order_count || 0), 0);

  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-5 gap-3' });
  grid.appendChild(kpi('Total Tenants', String(state.tenants.length), 'from-slate-600 to-slate-700', `${active.length} active`));
  grid.appendChild(kpi('Trials', String(trials.length), 'from-amber-500 to-orange-500', 'Need attention'));
  grid.appendChild(kpi('Suspended', String(suspended.length), 'from-red-500 to-red-600', 'Blocked access'));
  grid.appendChild(kpi('Platform GMV', fmtMoney(totalRevenue), 'from-indigo-500 to-indigo-600', 'Lifetime paid orders'));
  grid.appendChild(kpi('Total Orders', String(totalOrders), 'from-emerald-500 to-emerald-600', 'All tenants'));
  return grid;
}

function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });

  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search by name, slug, or owner email…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.statusFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' },       'All statuses'),
    el('option', { value: 'trial' },     'Trial'),
    el('option', { value: 'active' },    'Active'),
    el('option', { value: 'past_due' },  'Past due'),
    el('option', { value: 'suspended' }, 'Suspended'),
    el('option', { value: 'cancelled' }, 'Cancelled'),
  ]));

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.planFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' },        'All plans'),
    el('option', { value: 'starter' },    'Starter'),
    el('option', { value: 'growth' },     'Growth'),
    el('option', { value: 'enterprise' }, 'Enterprise'),
  ]));

  return bar;
}

function renderTable(root) {
  const filtered = state.tenants.filter(t => {
    if (state.statusFilter !== 'all' && t.status !== state.statusFilter) return false;
    if (state.planFilter !== 'all' && t.plan_code !== state.planFilter) return false;
    if (state.search) {
      const hay = `${t.name || ''} ${t.slug || ''} ${t.owner_email || ''} ${t.owner_name || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Tenants (${filtered.length})`),
    el('span', { class: 'text-xs text-slate-500' }, 'Click a row to manage'),
  ]));

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No tenants match'));
    return card;
  }

  const tbody = el('tbody');
  filtered.forEach(t => {
    const statusMeta = statusBadge(t.status);
    const isSelected = state.selected?.id === t.id;

    tbody.appendChild(el('tr', {
      class: `border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-indigo-50' : ''}`,
      onclick: () => { state.selected = isSelected ? null : t; paint(root); },
    }, [
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'flex items-center gap-3' }, [
          el('div', { class: 'w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-xs font-bold flex items-center justify-center shrink-0' },
            (t.name || '?').charAt(0).toUpperCase()),
          el('div', { class: 'min-w-0' }, [
            el('div', { class: 'text-sm font-semibold text-slate-800 truncate' }, t.name),
            el('div', { class: 'text-[11px] text-slate-500 truncate' }, t.owner_email || '—'),
          ]),
        ]),
      ]),
      el('td', { class: 'px-4 py-3 text-xs text-slate-500 hidden md:table-cell' }, t.slug),
      el('td', { class: 'px-4 py-3 text-right text-sm text-slate-700 hidden md:table-cell' }, t.outlet_count),
      el('td', { class: 'px-4 py-3 text-right text-sm text-slate-700 hidden lg:table-cell' }, t.member_count),
      el('td', { class: 'px-4 py-3 text-right text-sm text-slate-700 hidden lg:table-cell' }, t.order_count),
      el('td', { class: 'px-4 py-3 text-right text-sm font-semibold text-slate-800' }, fmtMoney(t.total_revenue)),
      el('td', { class: 'px-4 py-3 text-right hidden md:table-cell' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${statusMeta.cls}` }, statusMeta.label),
      ]),
      el('td', { class: 'px-4 py-3 text-right text-xs text-slate-500 hidden lg:table-cell' },
        t.last_activity ? fmtRelative(t.last_activity) + ' ago' : '—'),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Tenant'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Slug'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Outlets'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden lg:table-cell' }, 'Staff'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden lg:table-cell' }, 'Orders'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'GMV'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Status'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden lg:table-cell' }, 'Last Activity'),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

function statusBadge(status) {
  return {
    trial:     { label: 'Trial',     cls: 'bg-amber-100 text-amber-700' },
    active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700' },
    past_due:  { label: 'Past Due',  cls: 'bg-orange-100 text-orange-700' },
    suspended: { label: 'Suspended', cls: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-600' },
  }[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
}

function renderDetailPanel(root, t) {
  const card = el('div', { class: 'bg-white rounded-xl border-2 border-indigo-200 overflow-hidden' });

  // Header
  card.appendChild(el('div', { class: 'px-5 py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, 'Managing Tenant'),
      el('div', { class: 'text-lg font-bold' }, t.name),
      el('div', { class: 'text-xs opacity-90 font-mono mt-0.5' }, t.slug),
    ]),
    el('button', {
      class: 'text-white/80 hover:text-white text-2xl leading-none',
      onclick: () => { state.selected = null; paint(root); },
    }, '×'),
  ]));

  // Info grid
  const infoGrid = el('div', { class: 'p-5 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-slate-100' });
  infoGrid.appendChild(infoBlock('Owner', t.owner_name || '—', t.owner_email || ''));
  infoGrid.appendChild(infoBlock('Plan', t.plan_code || '—', `Trial ends ${t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('en-IN') : '—'}`));
  infoGrid.appendChild(infoBlock('Created', new Date(t.created_at).toLocaleDateString('en-IN'), fmtRelative(t.created_at) + ' ago'));
  infoGrid.appendChild(infoBlock('Status', t.status.toUpperCase(), `Since ${new Date(t.created_at).toLocaleDateString('en-IN')}`));
  card.appendChild(infoGrid);

  // Actions
  const actions = el('div', { class: 'p-5 space-y-3' });

  // Status change
  actions.appendChild(el('div', {}, [
    el('div', { class: 'text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide' }, 'Change Status'),
    el('div', { class: 'flex flex-wrap gap-2' },
      ['trial', 'active', 'past_due', 'suspended', 'cancelled'].map(s =>
        el('button', {
          class: `px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            t.status === s
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
          }`,
          onclick: async (e) => {
            if (t.status === s) return;
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const { error } = await supabase.rpc('admin_set_tenant_status', { p_tenant_id: t.id, p_status: s });
              if (error) throw error;
              toast(`Status → ${s}`, 'success');
              await refresh();
              state.selected = state.tenants.find(x => x.id === t.id);
              paint(root);
            } catch (err) {
              toast('Failed: ' + err.message, 'error');
              b.disabled = false;
            }
          },
        }, s.replace('_', ' ')))),
  ]));

  // Plan change
  actions.appendChild(el('div', {}, [
    el('div', { class: 'text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide' }, 'Change Plan'),
    el('div', { class: 'flex flex-wrap gap-2' },
      ['starter', 'growth', 'enterprise'].map(p =>
        el('button', {
          class: `px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            t.plan_code === p
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
          }`,
          onclick: async (e) => {
            if (t.plan_code === p) return;
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const { error } = await supabase.rpc('admin_set_tenant_plan', { p_tenant_id: t.id, p_plan_code: p });
              if (error) throw error;
              toast(`Plan → ${p}`, 'success');
              await refresh();
              state.selected = state.tenants.find(x => x.id === t.id);
              paint(root);
            } catch (err) {
              toast('Failed: ' + err.message, 'error');
              b.disabled = false;
            }
          },
        }, p))),
  ]));

  // Extend trial
  actions.appendChild(el('div', {}, [
    el('div', { class: 'text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide' }, 'Extend Trial'),
    el('div', { class: 'flex flex-wrap gap-2' },
      [7, 14, 30, 90].map(d =>
        el('button', {
          class: 'px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:border-indigo-400 transition',
          onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const { data, error } = await supabase.rpc('admin_extend_trial', { p_tenant_id: t.id, p_days: d });
              if (error) throw error;
              toast(`Trial extended by ${d} days`, 'success');
              await refresh();
              state.selected = state.tenants.find(x => x.id === t.id);
              paint(root);
            } catch (err) {
              toast('Failed: ' + err.message, 'error');
              b.disabled = false;
            }
          },
        }, `+${d} days`))),
  ]));

  card.appendChild(actions);
  return card;
}

function infoBlock(label, value, sub = '') {
  return el('div', {}, [
    el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, label),
    el('div', { class: 'text-sm font-semibold text-slate-800 mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] text-slate-400 mt-0.5 truncate' }, String(sub)) : null,
  ].filter(Boolean));
}
