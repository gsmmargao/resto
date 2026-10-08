import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';
import { getLimit, showLimitGate } from '../entitlements.js';

const state = {
  tab: 'items',
  categoryFilter: 'all',
  search: '',
  showInactive: false,
  categories: [],
  items: [],
  variants: [],
  addonGroups: [],
  addons: [],
  itemAddonLinks: [],
  taxRates: [],
  stations: [],
  hsnCodes: [],
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderMenuAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading menu…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[menu-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;

  const [catRes, itemRes, varRes, grpRes, addRes, linkRes, taxRes, staRes, hsnRes] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('tenant_id', tenantId).order('sort_order'),
    supabase.from('menu_items').select('*').eq('tenant_id', tenantId).order('sort_order').order('name'),
    supabase.from('menu_item_variants').select('*').eq('tenant_id', tenantId).order('sort_order'),
    supabase.from('addon_groups').select('*').eq('tenant_id', tenantId).order('sort_order'),
    supabase.from('addons').select('*').eq('tenant_id', tenantId).order('sort_order'),
    supabase.from('menu_item_addon_groups').select('*'),
    supabase.from('tax_rates').select('id, name, rate').eq('tenant_id', tenantId).eq('is_active', true).order('rate'),
    supabase.from('kitchen_stations').select('id, name, station_type').eq('outlet_id', store.state.outlet.id).eq('is_active', true),
    supabase.from('hsn_codes').select('id, code, description').eq('tenant_id', tenantId).order('code'),
  ]);

  state.categories     = catRes.data || [];
  state.items          = itemRes.data || [];
  state.variants       = varRes.data || [];
  state.addonGroups    = grpRes.data || [];
  state.addons         = addRes.data || [];
  state.itemAddonLinks = linkRes.data || [];
  state.taxRates       = taxRes.data || [];
  state.stations       = staRes.data || [];
  state.hsnCodes       = hsnRes.data || [];
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

// ============================================================
// MAIN LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  // Top header
  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Menu Management'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.items.length} items · ${state.categories.length} categories`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => {
          const limit = getLimit('items');
          const active = state.items.filter(i => i.is_active).length;
          if (active >= limit) {
            showLimitGate('menu items', active, limit, () => {
              document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove());
              location.hash = '#billing-upgrade';
            });
            return;
          }
          openItemEditor(root, null);
        },
      }, '+ New Item'),
    ]),
  ]);

  // Tabs
  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    [
      ['items',      'Items'],
      ['categories', 'Categories'],
      ['addons',     'Add-ons'],
    ].map(([key, label]) =>
      el('button', {
        class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition
                ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
        onclick: () => { state.tab = key; paint(root); },
      }, label),
    ),
  );

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto' });

  if (state.tab === 'items')      inner.appendChild(renderItemsTab(root));
  if (state.tab === 'categories') inner.appendChild(renderCategoriesTab(root));
  if (state.tab === 'addons')     inner.appendChild(renderAddonsTab(root));

  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(tabs);
  wrap.appendChild(body);
  root.appendChild(wrap);
}

// ============================================================
// ITEMS TAB
// ============================================================
function renderItemsTab(root) {
  const wrap = el('div', {});

  // Filters
  const filterBar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center' });

  const searchIn = el('input', {
    type: 'search', placeholder: 'Search items…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); repaintGrid(); },
  });
  filterBar.appendChild(searchIn);

  const catSel = el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.categoryFilter = e.target.value; repaintGrid(); },
  }, [
    el('option', { value: 'all' }, 'All categories'),
    el('option', { value: 'uncategorized' }, 'Uncategorized'),
    ...state.categories.map(c => el('option', { value: c.id, selected: state.categoryFilter === c.id ? true : null }, c.name)),
  ]);
  filterBar.appendChild(catSel);

  const showInactive = el('label', { class: 'flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm cursor-pointer' }, [
    el('input', {
      type: 'checkbox', checked: state.showInactive ? true : null,
      onchange: (e) => { state.showInactive = e.target.checked; repaintGrid(); },
    }),
    el('span', { class: 'text-slate-700' }, 'Show inactive'),
  ]);
  filterBar.appendChild(showInactive);

  wrap.appendChild(filterBar);

  // Summary
  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-3' });
  wrap.appendChild(summary);

  // Grid
  const grid = el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' });
  wrap.appendChild(grid);

  function repaintGrid() {
    // Summary
    const visible = applyFilters();
    const active = visible.filter(i => i.is_active);
    const available = visible.filter(i => i.is_available && i.is_active);
    const avgPrice = active.length ? active.reduce((s, i) => s + Number(i.base_price), 0) / active.length : 0;
    const avgMargin = active.length
      ? active.reduce((s, i) => s + (i.base_price > 0 ? (i.base_price - i.cost_price) / i.base_price * 100 : 0), 0) / active.length
      : 0;

    summary.innerHTML = '';
    summary.appendChild(kpi('Total Items', String(state.items.length), 'from-slate-600 to-slate-700', `${active.length} active`));
    summary.appendChild(kpi('Available', String(available.length), 'from-emerald-500 to-emerald-600', `${active.length - available.length} unavailable`));
    summary.appendChild(kpi('Avg Price', fmtMoney(avgPrice), 'from-indigo-500 to-indigo-600', 'Active items only'));
    summary.appendChild(kpi('Avg Margin', avgMargin.toFixed(1) + '%', avgMargin < 30 ? 'from-amber-500 to-orange-500' : 'from-emerald-500 to-emerald-600', 'Based on recipe cost'));

    // Grid
    grid.innerHTML = '';
    if (!visible.length) {
      grid.appendChild(el('div', { class: 'col-span-full bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm' }, 'No items match your filters'));
      return;
    }

    visible.forEach(item => grid.appendChild(buildItemCard(item, root)));
  }

  function applyFilters() {
    return state.items.filter(i => {
      if (!state.showInactive && !i.is_active) return false;
      if (state.search && !(i.name || '').toLowerCase().includes(state.search)) return false;
      if (state.categoryFilter === 'uncategorized' && i.category_id) return false;
      if (state.categoryFilter !== 'all' && state.categoryFilter !== 'uncategorized' && i.category_id !== state.categoryFilter) return false;
      return true;
    });
  }

  repaintGrid();
  return wrap;
}

function buildItemCard(item, root) {
  const cat = state.categories.find(c => c.id === item.category_id);
  const station = state.stations.find(s => s.id === item.station_id);
  const vars = state.variants.filter(v => v.menu_item_id === item.id && v.is_active);
  const margin = item.base_price > 0 ? (item.base_price - item.cost_price) / item.base_price * 100 : 0;

  const vegColors = {
    veg: 'border-emerald-600', non_veg: 'border-red-600', egg: 'border-amber-500',
    vegan: 'border-emerald-500', jain: 'border-emerald-500', beverage: 'border-sky-500',
  };
  const vegBg = { veg: 'bg-emerald-600', non_veg: 'bg-red-600', egg: 'bg-amber-500', vegan: 'bg-emerald-500', jain: 'bg-emerald-500', beverage: 'bg-sky-500' };
  const dotColor = item.food_category === 'beverage' ? 'beverage' : (item.item_type || 'veg');
  const borderCol = vegColors[dotColor] || 'border-slate-400';
  const bgCol = vegBg[dotColor] || 'bg-slate-400';

  const card = el('div', {
    class: `bg-white rounded-xl border ${item.is_active ? 'border-slate-200' : 'border-dashed border-red-300 opacity-60'} overflow-hidden hover:shadow-md transition group`,
  });

  // Top: name + veg marker + availability toggle
  const head = el('div', { class: 'p-3 pb-2 cursor-pointer', onclick: () => openItemEditor(root, item) }, [
    el('div', { class: 'flex items-start gap-2 mb-1.5' }, [
      el('span', { class: `inline-block w-3 h-3 rounded-sm border-2 ${borderCol} shrink-0 mt-0.5 relative` }, [
        el('span', { class: `absolute inset-[1.5px] rounded-full ${bgCol}` }),
      ]),
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'text-sm font-semibold text-slate-800 leading-snug line-clamp-2' }, item.name),
        item.short_name ? el('div', { class: 'text-[10px] text-slate-400 uppercase' }, item.short_name) : null,
      ].filter(Boolean)),
    ]),
    el('div', { class: 'flex items-center justify-between mt-2' }, [
      el('span', { class: 'text-lg font-bold text-slate-900' }, fmtMoney(item.base_price)),
      el('div', { class: 'flex items-center gap-1' }, [
        vars.length ? el('span', { class: 'text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold' }, `${vars.length} var`) : null,
        item.is_combo ? el('span', { class: 'text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold' }, 'COMBO') : null,
      ].filter(Boolean)),
    ]),
    el('div', { class: 'mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500' }, [
      cat ? el('span', { class: 'px-1.5 py-0.5 rounded', style: `background:${hexTint(cat.color_hex || '#94a3b8')}` }, cat.name) : el('span', {}, 'Uncategorized'),
      station ? el('span', {}, '· ' + station.name) : null,
    ].filter(Boolean)),
  ]);

  // Bottom: actions
  const foot = el('div', { class: 'px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between' }, [
    el('button', {
      class: `text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.is_available && item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`,
      title: 'Toggle availability',
      onclick: async (e) => {
        e.stopPropagation();
        const next = !item.is_available;
        const { error } = await supabase.from('menu_items').update({ is_available: next }).eq('id', item.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        item.is_available = next;
        toast(next ? 'Available' : 'Marked unavailable', 'success', 1200);
        paint(root);
      },
    }, item.is_available && item.is_active ? '● AVAILABLE' : '○ UNAVAILABLE'),

    el('div', { class: 'flex items-center gap-1' }, [
      el('button', {
        class: 'text-[10px] px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium',
        title: 'Duplicate',
        onclick: async (e) => {
          e.stopPropagation();
          await duplicateItem(item);
          await refresh();
          paint(root);
        },
      }, 'Copy'),
      el('button', {
        class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
        onclick: (e) => { e.stopPropagation(); openItemEditor(root, item); },
      }, 'Edit'),
    ]),
  ]);

  card.appendChild(head);
  card.appendChild(foot);
  return card;
}

function hexTint(hex) {
  return (hex || '#94a3b8') + '22';
}

async function duplicateItem(item) {
  const tenantId = store.state.tenant.id;
  const { data: newItem, error } = await supabase.from('menu_items').insert({
    tenant_id: tenantId,
    category_id: item.category_id,
    name: item.name + ' (Copy)',
    short_name: item.short_name,
    description: item.description,
    item_type: item.item_type,
    food_category: item.food_category,
    hsn_code_id: item.hsn_code_id,
    tax_rate_id: item.tax_rate_id,
    station_id: item.station_id,
    base_price: item.base_price,
    cost_price: item.cost_price,
    unit: item.unit,
    prep_time_minutes: item.prep_time_minutes,
    is_combo: item.is_combo,
    is_discountable: item.is_discountable,
    is_active: false,
    is_available: false,
    sort_order: item.sort_order,
  }).select().single();

  if (error) { toast('Copy failed: ' + error.message, 'error'); return; }
  toast('Item copied (inactive)', 'success');
}

function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

// ============================================================
// ITEM EDITOR MODAL
// ============================================================
async function openItemEditor(root, item) {
  const isNew = !item;
  const tenantId = store.state.tenant.id;

  // Working copy
  const draft = item ? { ...item } : {
    tenant_id: tenantId,
    name: '', short_name: '', description: '',
    category_id: null, item_type: 'veg', food_category: 'food',
    hsn_code_id: null, tax_rate_id: null, station_id: null,
    base_price: 0, cost_price: 0, unit: 'plate',
    prep_time_minutes: 10,
    is_combo: false, is_discountable: true,
    is_active: true, is_available: true,
    sort_order: 0,
  };

  let variants = item ? state.variants.filter(v => v.menu_item_id === item.id).map(v => ({ ...v })) : [];
  let addonGroupIds = item
    ? state.itemAddonLinks.filter(l => l.menu_item_id === item.id).map(l => l.addon_group_id)
    : [];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });

  // Header
  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10' }, [
    el('div', {}, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Menu Item' : 'Edit Menu Item'),
      !isNew ? el('p', { class: 'text-xs text-slate-500 font-mono' }, item.id.slice(0, 8)) : null,
    ].filter(Boolean)),
    el('button', {
      class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none',
      onclick: () => overlay.remove(),
    }, '×'),
  ]));

  // Body
  const body = el('div', { class: 'p-5 space-y-5' });

  // ---------- BASIC ----------
  body.appendChild(section('Basics', [
    field('Name *', el('input', {
      type: 'text', value: draft.name,
      class: inputClass,
      oninput: e => { draft.name = e.target.value; },
    })),
    field('Short name (KOT)', el('input', {
      type: 'text', value: draft.short_name || '', placeholder: 'e.g. PBM',
      class: inputClass,
      oninput: e => { draft.short_name = e.target.value; },
    })),
    field('Description', el('textarea', {
      rows: '2',
      class: inputClass + ' resize-none',
      oninput: e => { draft.description = e.target.value; },
    }, draft.description || '')),
    el('div', { class: 'grid grid-cols-2 gap-3' }, [
      field('Category', categoryPicker()),
      field('Kitchen station', el('select', {
        class: inputClass,
        onchange: e => { draft.station_id = e.target.value || null; },
      }, [
        el('option', { value: '' }, '— none —'),
        ...state.stations.map(s => el('option', { value: s.id, selected: draft.station_id === s.id ? true : null }, s.name)),
      ])),
    ]),
    el('div', { class: 'grid grid-cols-3 gap-3' }, [
      field('Item type', el('select', {
        class: inputClass,
        onchange: e => { draft.item_type = e.target.value; },
      }, ['veg','non_veg','egg','vegan','jain'].map(t =>
        el('option', { value: t, selected: draft.item_type === t ? true : null }, t.replace('_',' '))))),
      field('Food category', el('select', {
        class: inputClass,
        onchange: e => { draft.food_category = e.target.value; },
      }, ['food','beverage','dessert','combo','service'].map(t =>
        el('option', { value: t, selected: draft.food_category === t ? true : null }, t)))),
      field('Unit', el('input', {
        type: 'text', value: draft.unit || 'plate',
        class: inputClass,
        oninput: e => { draft.unit = e.target.value; },
      })),
    ]),
  ]));

  // ---------- PRICING + TAX ----------
  body.appendChild(section('Pricing & Tax', [
    el('div', { class: 'grid grid-cols-2 gap-3' }, [
      field('Selling price (₹) *', el('input', {
        type: 'number', step: '0.01', value: draft.base_price,
        class: inputClass,
        oninput: e => { draft.base_price = Number(e.target.value || 0); },
      })),
      field('Cost price (₹)', el('input', {
        type: 'number', step: '0.01', value: draft.cost_price,
        class: inputClass,
        oninput: e => { draft.cost_price = Number(e.target.value || 0); },
      })),
    ]),
    el('div', { class: 'grid grid-cols-3 gap-3' }, [
      field('Tax rate', el('select', {
        class: inputClass,
        onchange: e => { draft.tax_rate_id = e.target.value || null; },
      }, [
        el('option', { value: '' }, '— none —'),
        ...state.taxRates.map(t => el('option', { value: t.id, selected: draft.tax_rate_id === t.id ? true : null },
          `${t.name} (${(t.rate * 100).toFixed(1)}%)`)),
      ])),
      field('HSN code', el('select', {
        class: inputClass,
        onchange: e => { draft.hsn_code_id = e.target.value || null; },
      }, [
        el('option', { value: '' }, '— none —'),
        ...state.hsnCodes.map(h => el('option', { value: h.id, selected: draft.hsn_code_id === h.id ? true : null },
          h.code + (h.description ? ' · ' + h.description : ''))),
      ])),
      field('Prep time (min)', el('input', {
        type: 'number', value: draft.prep_time_minutes || 10,
        class: inputClass,
        oninput: e => { draft.prep_time_minutes = Number(e.target.value || 0); },
      })),
    ]),
  ]));

  // ---------- VARIANTS ----------
  body.appendChild(section('Variants (Half / Full / Regular / Large)', [variantsEditor()], 'Leave empty if this item has a single price.'));

  // ---------- ADD-ON GROUPS ----------
  if (state.addonGroups.length) {
    const groups = state.addonGroups.map(g => {
      const links = state.addons.filter(a => a.addon_group_id === g.id && a.is_active);
      const checked = addonGroupIds.includes(g.id);
      return el('label', { class: 'flex items-start gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer' }, [
        el('input', {
          type: 'checkbox', checked: checked ? true : null, class: 'mt-0.5',
          onchange: (e) => {
            if (e.target.checked) addonGroupIds.push(g.id);
            else addonGroupIds = addonGroupIds.filter(id => id !== g.id);
          },
        }),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('div', { class: 'text-sm font-medium text-slate-800' }, g.name),
          el('div', { class: 'text-[11px] text-slate-500' }, `${links.length} add-on${links.length !== 1 ? 's' : ''}`),
        ]),
      ]);
    });
    body.appendChild(section('Add-on groups', groups));
  }

  // ---------- FLAGS ----------
  body.appendChild(section('Flags', [
    el('div', { class: 'grid grid-cols-2 gap-3' }, [
      checkbox('Available for ordering', draft.is_available, v => { draft.is_available = v; }),
      checkbox('Active (visible in POS)', draft.is_active, v => { draft.is_active = v; }),
      checkbox('Tax discountable', draft.is_discountable, v => { draft.is_discountable = v; }),
      checkbox('Is a combo/bundle', draft.is_combo, v => { draft.is_combo = v; }),
    ]),
  ]));

  card.appendChild(body);

  // Footer
  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl sticky bottom-0' }, [
    !isNew
      ? el('button', {
          class: 'px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium',
          onclick: async () => {
            const ok = await confirmDialog(
              `Delete "${item.name}"? Items with past orders will be deactivated instead of removed.`,
              'Delete item?',
            );
            if (!ok) return;
            await deleteItem(item);
            overlay.remove();
            await refresh();
            paint(root);
          },
        }, 'Delete')
      : el('span', {}),

    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
        onclick: () => overlay.remove(),
      }, 'Cancel'),
      el('button', {
        id: 'btn-save-item',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, isNew ? 'Create Item' : 'Save Changes'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ---------- Save handler ----------
  footer.querySelector('#btn-save-item').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Saving…';
    try {
      await saveItem({ draft, variants, addonGroupIds, isNew });
      toast(isNew ? 'Item created' : 'Item saved', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      e.currentTarget.disabled = false;
      e.currentTarget.textContent = isNew ? 'Create Item' : 'Save Changes';
    }
  });

  // ---------- Nested: variants editor ----------
  function variantsEditor() {
    const wrap = el('div', { class: 'space-y-2' });

    function repaint() {
      wrap.innerHTML = '';

      if (!variants.length) {
        wrap.appendChild(el('div', { class: 'text-xs text-slate-400 italic py-2' }, 'No variants — item will use the base price.'));
      }

      variants.forEach((v, idx) => {
        wrap.appendChild(el('div', { class: 'flex items-center gap-2' }, [
          el('input', {
            type: 'text', value: v.name || '', placeholder: 'Name',
            class: inputClass + ' flex-1',
            oninput: e => { v.name = e.target.value; },
          }),
          el('input', {
            type: 'number', step: '0.01', value: v.price || 0, placeholder: 'Price',
            class: inputClass + ' w-24',
            oninput: e => { v.price = Number(e.target.value || 0); },
          }),
          el('label', { class: 'flex items-center gap-1 text-[11px] text-slate-500 whitespace-nowrap' }, [
            el('input', {
              type: 'checkbox', checked: v.is_default ? true : null,
              onchange: (e) => { variants.forEach(x => x.is_default = false); v.is_default = e.target.checked; repaint(); },
            }),
            el('span', {}, 'Default'),
          ]),
          el('button', {
            class: 'text-red-500 hover:text-red-700 text-lg leading-none px-1',
            onclick: () => { variants.splice(idx, 1); repaint(); },
          }, '×'),
        ]));
      });

      wrap.appendChild(el('button', {
        class: 'mt-2 text-xs px-3 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-indigo-400 hover:text-indigo-600 text-slate-600 font-medium',
        onclick: () => {
          variants.push({ name: '', price: draft.base_price || 0, is_default: variants.length === 0, sort_order: variants.length });
          repaint();
        },
      }, '+ Add variant'));
    }

    repaint();
    return wrap;
  }
}

// ============================================================
// SAVE ITEM
// ============================================================
async function saveItem({ draft, variants, addonGroupIds, isNew }) {
  if (!draft.name || !draft.name.trim()) throw new Error('Name is required');
  if (draft.base_price < 0) throw new Error('Price must be ≥ 0');

  const payload = {
    tenant_id: draft.tenant_id,
    category_id: draft.category_id || null,
    name: draft.name.trim(),
    short_name: (draft.short_name || '').trim() || null,
    description: (draft.description || '').trim() || null,
    item_type: draft.item_type || 'veg',
    food_category: draft.food_category || 'food',
    hsn_code_id: draft.hsn_code_id || null,
    tax_rate_id: draft.tax_rate_id || null,
    station_id: draft.station_id || null,
    base_price: Number(draft.base_price) || 0,
    cost_price: Number(draft.cost_price) || 0,
    unit: draft.unit || 'plate',
    prep_time_minutes: Number(draft.prep_time_minutes) || 10,
    is_combo: !!draft.is_combo,
    is_discountable: draft.is_discountable !== false,
    is_active: draft.is_active !== false,
    is_available: draft.is_available !== false,
    sort_order: draft.sort_order || 0,
  };

  let itemId = draft.id;

  if (isNew) {
    const { data, error } = await supabase.from('menu_items').insert(payload).select('id').single();
    if (error) throw error;
    itemId = data.id;
  } else {
    const { error } = await supabase.from('menu_items').update(payload).eq('id', itemId);
    if (error) throw error;
  }

  // ---------- VARIANTS ----------
  // Existing variant IDs on the server
  const existing = state.variants.filter(v => v.menu_item_id === itemId);
  const existingIds = new Set(existing.map(v => v.id));
  const keepIds = new Set(variants.filter(v => v.id).map(v => v.id));

  // Soft-delete variants no longer present
  const toDeactivate = [...existingIds].filter(id => !keepIds.has(id));
  if (toDeactivate.length) {
    await supabase.from('menu_item_variants').update({ is_active: false }).in('id', toDeactivate);
  }

  // Update existing, insert new
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (!v.name || !v.name.trim()) continue;
    const vPayload = {
      tenant_id: draft.tenant_id,
      menu_item_id: itemId,
      name: v.name.trim(),
      price: Number(v.price) || 0,
      cost_price: Number(v.cost_price) || 0,
      is_default: !!v.is_default,
      is_active: true,
      sort_order: i,
    };
    if (v.id) {
      await supabase.from('menu_item_variants').update(vPayload).eq('id', v.id);
    } else {
      await supabase.from('menu_item_variants').insert(vPayload);
    }
  }

  // ---------- ADD-ON GROUP LINKS ----------
  // Wipe existing links and re-insert
  await supabase.from('menu_item_addon_groups').delete().eq('menu_item_id', itemId);
  if (addonGroupIds.length) {
    const links = addonGroupIds.map((gid, i) => ({
      menu_item_id: itemId,
      addon_group_id: gid,
      sort_order: i,
    }));
    await supabase.from('menu_item_addon_groups').insert(links);
  }
}

async function deleteItem(item) {
  // Try hard delete; if orders reference it, soft-delete
  const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
  if (!error) { toast('Item deleted', 'success'); return; }

  // Soft delete
  const { error: sErr } = await supabase.from('menu_items').update({ is_active: false, is_available: false }).eq('id', item.id);
  if (sErr) { toast('Delete failed: ' + sErr.message, 'error'); return; }
  toast('Item deactivated (has order history)', 'success');
}

// ============================================================
// CATEGORIES TAB
// ============================================================
function renderCategoriesTab(root) {
  const wrap = el('div', {});

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Menu Categories'),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
      onclick: () => openCategoryEditor(root, null),
    }, '+ New Category'),
  ]));

  const cats = [...state.categories].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

  if (!cats.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No categories yet'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  cats.forEach((c, idx) => {
    const itemCount = state.items.filter(i => i.category_id === c.id && i.is_active).length;
    const station = state.stations.find(s => s.id === c.default_station_id);

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'flex items-center gap-3' }, [
          el('span', { class: 'w-3 h-3 rounded', style: `background:${c.color_hex || '#94a3b8'}` }),
          el('div', {}, [
            el('div', { class: 'text-sm font-medium text-slate-800' }, c.name),
            c.description ? el('div', { class: 'text-[11px] text-slate-400 truncate max-w-[280px]' }, c.description) : null,
          ].filter(Boolean)),
        ]),
      ]),
      el('td', { class: 'px-4 py-3 text-xs text-slate-500 hidden md:table-cell' }, station ? station.name : '—'),
      el('td', { class: 'px-4 py-3 text-right text-sm text-slate-700' }, `${itemCount} items`),
      el('td', { class: 'px-4 py-3 text-right' }, [
        el('div', { class: 'flex items-center justify-end gap-1' }, [
          el('button', {
            class: 'w-6 h-6 rounded text-xs hover:bg-slate-100 disabled:opacity-30',
            disabled: idx === 0 ? true : null,
            onclick: async () => {
              await swapCategoryOrder(cats, idx, idx - 1);
              await refresh();
              paint(root);
            },
          }, '↑'),
          el('button', {
            class: 'w-6 h-6 rounded text-xs hover:bg-slate-100 disabled:opacity-30',
            disabled: idx === cats.length - 1 ? true : null,
            onclick: async () => {
              await swapCategoryOrder(cats, idx, idx + 1);
              await refresh();
              paint(root);
            },
          }, '↓'),
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium ml-1',
            onclick: () => openCategoryEditor(root, c),
          }, 'Edit'),
        ]),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Name'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Default Station'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Items'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-40' }, 'Actions'),
      ]),
    ]),
    tbody,
  ]));

  wrap.appendChild(card);
  return wrap;
}

async function swapCategoryOrder(cats, i, j) {
  const a = cats[i], b = cats[j];
  const aOrder = a.sort_order, bOrder = b.sort_order;
  await supabase.from('menu_categories').update({ sort_order: bOrder }).eq('id', a.id);
  await supabase.from('menu_categories').update({ sort_order: aOrder }).eq('id', b.id);
}

function openCategoryEditor(root, category) {
  const isNew = !category;
  const tenantId = store.state.tenant.id;
  const outletId = store.state.outlet.id;

  const draft = category ? { ...category } : {
    tenant_id: tenantId,
    outlet_id: null,
    parent_id: null,
    name: '',
    description: '',
    image_url: '',
    default_station_id: null,
    default_tax_rate_id: null,
    hsn_code_id: null,
    color_hex: '#6366f1',
    sort_order: (state.categories.length + 1) * 10,
    is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Category' : 'Edit Category'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  body.appendChild(field('Name *', el('input', {
    type: 'text', value: draft.name, class: inputClass,
    oninput: e => { draft.name = e.target.value; },
  })));
  body.appendChild(field('Description', el('input', {
    type: 'text', value: draft.description || '', class: inputClass,
    oninput: e => { draft.description = e.target.value; },
  })));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Default station', el('select', {
      class: inputClass,
      onchange: e => { draft.default_station_id = e.target.value || null; },
    }, [
      el('option', { value: '' }, '— none —'),
      ...state.stations.map(s => el('option', { value: s.id, selected: draft.default_station_id === s.id ? true : null }, s.name)),
    ])),
    field('Default tax rate', el('select', {
      class: inputClass,
      onchange: e => { draft.default_tax_rate_id = e.target.value || null; },
    }, [
      el('option', { value: '' }, '— none —'),
      ...state.taxRates.map(t => el('option', { value: t.id, selected: draft.default_tax_rate_id === t.id ? true : null },
        `${t.name} (${(t.rate * 100).toFixed(1)}%)`)),
    ])),
  ]));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Colour', el('input', {
      type: 'color', value: draft.color_hex || '#6366f1',
      class: 'h-10 w-full rounded-lg border border-slate-300 cursor-pointer',
      oninput: e => { draft.color_hex = e.target.value; },
    })),
    field('Active', el('label', { class: 'flex items-center gap-2 h-10' }, [
      el('input', {
        type: 'checkbox', checked: draft.is_active !== false ? true : null,
        onchange: e => { draft.is_active = e.target.checked; },
      }),
      el('span', { class: 'text-sm text-slate-700' }, 'Visible in POS'),
    ])),
  ]));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    !isNew
      ? el('button', {
          class: 'px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium',
          onclick: async () => {
            const inUse = state.items.filter(i => i.category_id === category.id && i.is_active).length;
            const msg = inUse
              ? `Category "${category.name}" has ${inUse} active items. They will become uncategorized. Continue?`
              : `Delete category "${category.name}"?`;
            const ok = await confirmDialog(msg, 'Delete category?');
            if (!ok) return;
            const { error } = await supabase.from('menu_categories').delete().eq('id', category.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            toast('Category deleted', 'success');
            overlay.remove();
            await refresh();
            paint(root);
          },
        }, 'Delete')
      : el('span', {}),

    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
        onclick: () => overlay.remove(),
      }, 'Cancel'),
      el('button', {
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
        onclick: async (e) => {
          if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Saving…';
          try {
            const payload = {
              tenant_id: tenantId,
              outlet_id: draft.outlet_id || null,
              parent_id: draft.parent_id || null,
              name: draft.name.trim(),
              description: (draft.description || '').trim() || null,
              image_url: draft.image_url || null,
              default_station_id: draft.default_station_id || null,
              default_tax_rate_id: draft.default_tax_rate_id || null,
              hsn_code_id: draft.hsn_code_id || null,
              color_hex: draft.color_hex || null,
              sort_order: draft.sort_order || 0,
              is_active: draft.is_active !== false,
            };

            if (isNew) {
              const { error } = await supabase.from('menu_categories').insert(payload);
              if (error) throw error;
            } else {
              const { error } = await supabase.from('menu_categories').update(payload).eq('id', category.id);
              if (error) throw error;
            }
            toast(isNew ? 'Category created' : 'Category saved', 'success');
            overlay.remove();
            await refresh();
            paint(root);
          } catch (err) {
            console.error(err);
            toast('Failed: ' + err.message, 'error');
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = isNew ? 'Create' : 'Save';
          }
        },
      }, isNew ? 'Create' : 'Save'),
    ]),
  ]);

  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// ADD-ONS TAB
// ============================================================
function renderAddonsTab(root) {
  const wrap = el('div', { class: 'space-y-4' });

  const topBar = el('div', { class: 'flex items-center justify-between' }, [
    el('div', {}, [
      el('h3', { class: 'font-semibold text-slate-800' }, 'Add-on Groups'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.addonGroups.length} groups · ${state.addons.length} add-ons`),
    ]),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
      onclick: () => openAddonGroupEditor(root, null),
    }, '+ New Group'),
  ]);
  wrap.appendChild(topBar);

  if (!state.addonGroups.length) {
    wrap.appendChild(el('div', { class: 'bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm' }, 'No add-on groups'));
    return wrap;
  }

  state.addonGroups.forEach(g => {
    const groupAddons = state.addons.filter(a => a.addon_group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);

    const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });

    card.appendChild(el('div', { class: 'px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between' }, [
      el('div', {}, [
        el('div', { class: 'font-semibold text-slate-800 text-sm' }, g.name),
        el('div', { class: 'text-[11px] text-slate-500' },
          `${g.min_select || 0}–${g.max_select || 1} selectable${g.is_required ? ' · required' : ''}`),
      ]),
      el('div', { class: 'flex gap-1' }, [
        el('button', {
          class: 'text-xs px-2.5 py-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium',
          onclick: () => openAddonGroupEditor(root, g),
        }, 'Edit'),
        el('button', {
          class: 'text-xs px-2.5 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
          onclick: () => openAddonEditor(root, null, g.id),
        }, '+ Add-on'),
        el('button', {
          class: 'text-xs px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-medium',
          onclick: async () => {
            const ok = await confirmDialog(`Delete "${g.name}" and all its add-ons?`, 'Delete group?');
            if (!ok) return;
            const { error } = await supabase.from('addon_groups').delete().eq('id', g.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            toast('Group deleted', 'success');
            await refresh();
            paint(root);
          },
        }, 'Delete'),
      ]),
    ]));

    if (!groupAddons.length) {
      card.appendChild(el('div', { class: 'px-5 py-4 text-slate-400 text-xs italic' }, 'No add-ons in this group'));
    } else {
      const tbody = el('tbody');
      groupAddons.forEach(a => {
        tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
          el('td', { class: 'px-5 py-2 text-sm text-slate-800' }, a.name),
          el('td', { class: 'px-5 py-2 text-right text-sm text-slate-700' }, fmtMoney(a.price)),
          el('td', { class: 'px-5 py-2 text-right text-xs' }, [
            a.is_active
              ? el('span', { class: 'px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold' }, 'Active')
              : el('span', { class: 'px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold' }, 'Inactive'),
          ]),
          el('td', { class: 'px-5 py-2 text-right w-32' }, [
            el('div', { class: 'flex justify-end gap-1' }, [
              el('button', {
                class: 'text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700',
                onclick: () => openAddonEditor(root, a, g.id),
              }, 'Edit'),
              el('button', {
                class: 'text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600',
                onclick: async () => {
                  const { error } = await supabase.from('addons').delete().eq('id', a.id);
                  if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
                  toast('Add-on deleted', 'success');
                  await refresh();
                  paint(root);
                },
              }, '×'),
            ]),
          ]),
        ]));
      });

      card.appendChild(el('table', { class: 'w-full' }, [
        el('thead', { class: 'text-slate-500 text-[10px] uppercase tracking-wide' }, [
          el('tr', {}, [
            el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Name'),
            el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Price'),
            el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Status'),
            el('th', { class: 'text-right px-5 py-2 font-semibold' }, ''),
          ]),
        ]),
        tbody,
      ]));
    }

    wrap.appendChild(card);
  });

  return wrap;
}

function openAddonGroupEditor(root, group) {
  const isNew = !group;
  const tenantId = store.state.tenant.id;

  const draft = group ? { ...group } : {
    tenant_id: tenantId,
    name: '',
    min_select: 0,
    max_select: 1,
    is_required: false,
    sort_order: (state.addonGroups.length + 1) * 10,
    is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Add-on Group' : 'Edit Add-on Group'));

  card.appendChild(field('Group name *', el('input', {
    type: 'text', value: draft.name, placeholder: 'e.g. Extras, Spice Level, Sides',
    class: inputClass,
    oninput: e => { draft.name = e.target.value; },
  })));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Min select', el('input', {
      type: 'number', min: 0, value: draft.min_select,
      class: inputClass,
      oninput: e => { draft.min_select = Number(e.target.value || 0); },
    })),
    field('Max select', el('input', {
      type: 'number', min: 1, value: draft.max_select,
      class: inputClass,
      oninput: e => { draft.max_select = Number(e.target.value || 1); },
    })),
  ]));

  card.appendChild(el('label', { class: 'flex items-center gap-2' }, [
    el('input', {
      type: 'checkbox', checked: draft.is_required ? true : null,
      onchange: e => { draft.is_required = e.target.checked; },
    }),
    el('span', { class: 'text-sm text-slate-700' }, 'Required (customer must pick at least min_select)'),
  ]));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm',
      onclick: () => overlay.remove(),
    }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: tenantId,
            name: draft.name.trim(),
            min_select: Number(draft.min_select) || 0,
            max_select: Number(draft.max_select) || 1,
            is_required: !!draft.is_required,
            sort_order: draft.sort_order || 0,
            is_active: true,
          };
          if (isNew) {
            const { error } = await supabase.from('addon_groups').insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('addon_groups').update(payload).eq('id', group.id);
            if (error) throw error;
          }
          toast('Saved', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Save';
        }
      },
    }, isNew ? 'Create' : 'Save'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function openAddonEditor(root, addon, groupId) {
  const isNew = !addon;
  const tenantId = store.state.tenant.id;

  const draft = addon ? { ...addon } : {
    tenant_id: tenantId,
    addon_group_id: groupId,
    name: '',
    price: 0,
    cost_price: 0,
    is_active: true,
    sort_order: state.addons.filter(a => a.addon_group_id === groupId).length + 1,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Add-on' : 'Edit Add-on'));

  card.appendChild(field('Name *', el('input', {
    type: 'text', value: draft.name, placeholder: 'e.g. Extra Cheese',
    class: inputClass,
    oninput: e => { draft.name = e.target.value; },
  })));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Price (₹)', el('input', {
      type: 'number', step: '0.01', value: draft.price,
      class: inputClass,
      oninput: e => { draft.price = Number(e.target.value || 0); },
    })),
    field('Cost (₹)', el('input', {
      type: 'number', step: '0.01', value: draft.cost_price || 0,
      class: inputClass,
      oninput: e => { draft.cost_price = Number(e.target.value || 0); },
    })),
  ]));

  card.appendChild(el('label', { class: 'flex items-center gap-2' }, [
    el('input', {
      type: 'checkbox', checked: draft.is_active !== false ? true : null,
      onchange: e => { draft.is_active = e.target.checked; },
    }),
    el('span', { class: 'text-sm text-slate-700' }, 'Active'),
  ]));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm',
      onclick: () => overlay.remove(),
    }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: tenantId,
            addon_group_id: groupId,
            name: draft.name.trim(),
            price: Number(draft.price) || 0,
            cost_price: Number(draft.cost_price) || 0,
            is_active: draft.is_active !== false,
            sort_order: draft.sort_order || 0,
          };
          if (isNew) {
            const { error } = await supabase.from('addons').insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('addons').update(payload).eq('id', addon.id);
            if (error) throw error;
          }
          toast('Saved', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Save';
        }
      },
    }, isNew ? 'Create' : 'Save'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// SHARED UI HELPERS
// ============================================================
const inputClass = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}

function section(title, children, help = '') {
  return el('div', {}, [
    el('div', { class: 'mb-3' }, [
      el('h4', { class: 'text-sm font-semibold text-slate-800' }, title),
      help ? el('p', { class: 'text-[11px] text-slate-500 mt-0.5' }, help) : null,
    ].filter(Boolean)),
    el('div', { class: 'space-y-3' }, children),
  ]);
}

function checkbox(label, checked, onChange) {
  return el('label', { class: 'flex items-center gap-2 py-1 cursor-pointer' }, [
    el('input', {
      type: 'checkbox', checked: checked ? true : null,
      onchange: e => onChange(e.target.checked),
    }),
    el('span', { class: 'text-sm text-slate-700' }, label),
  ]);
}

// Inline category picker with "+ New" button
function categoryPicker() {
  // We need to reach into the parent's `draft` closure — so this returns a small component
  // that the caller will wire. Simpler approach: use a select + a button that opens a
  // minimal inline prompt (uses native prompt() — fine for now).
  const container = el('div', { class: 'flex gap-1.5' });
  const sel = el('select', {
    class: inputClass + ' flex-1',
  }, [
    el('option', { value: '' }, '— uncategorized —'),
    ...state.categories.map(c => el('option', { value: c.id }, c.name)),
  ]);
  // Caller patches this below.
  container._select = sel;
  container.appendChild(sel);
  container.appendChild(el('button', {
    class: 'px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold',
    title: 'New category',
    type: 'button',
    onclick: async () => {
      const name = prompt('New category name:');
      if (!name || !name.trim()) return;
      const { data, error } = await supabase.from('menu_categories').insert({
        tenant_id: store.state.tenant.id,
        name: name.trim(),
        sort_order: (state.categories.length + 1) * 10,
        is_active: true,
      }).select().single();
      if (error) { toast('Failed: ' + error.message, 'error'); return; }
      state.categories.push(data);
      // Add option and select it
      const opt = el('option', { value: data.id, selected: true }, data.name);
      sel.appendChild(opt);
      sel.value = data.id;
      sel.dispatchEvent(new Event('change'));
      toast('Category added', 'success');
    },
  }, '+'));
  return container;
}
