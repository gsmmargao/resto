import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, toast } from '../utils.js';

const state = {
  tab: 'levels',
  search: '',
  categoryFilter: 'all',
  lowOnly: false,
  ingredients: [],
  categories: [],
  levels: [],
  loaded: false,
};

export async function renderStock(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading inventory…'));

  try {
    if (!state.loaded) await loadBase();
    paint(root);
  } catch (err) {
    console.error('[stock]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadBase() {
  const tenantId = store.state.tenant.id;
  const outletId = store.state.outlet.id;

  const [ingRes, catRes, lvlRes] = await Promise.all([
    supabase.from('ingredients')
      .select('id, name, sku, category_id, unit_id, min_stock, max_stock, reorder_qty, avg_cost, storage_type, is_active, units(name, abbreviation)')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('ingredient_categories').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('stock_levels').select('*').eq('outlet_id', outletId),
  ]);

  state.ingredients = ingRes.data || [];
  state.categories  = catRes.data || [];
  const lvlMap = new Map((lvlRes.data || []).map(l => [l.ingredient_id, l]));
  state.levels = state.ingredients.map(i => ({
    ...i,
    quantity_on_hand: lvlMap.get(i.id)?.quantity_on_hand || 0,
    stock_value:      lvlMap.get(i.id)?.stock_value || 0,
  }));
  state.loaded = true;
}

function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Inventory'),
      el('p', { class: 'text-xs text-slate-500' }, store.state.outlet?.name || ''),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openAdjustModal(root),
      }, '+ Adjust Stock'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium',
        onclick: async () => { state.loaded = false; await renderStock(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
    ]),
  ]);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    [['levels', 'Stock Levels'], ['movements', 'Movements'], ['wastage', 'Wastage'], ['reorder', 'Reorder'], ['recipes', 'Recipes']]
      .map(([key, label]) =>
        el('button', {
          class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
          onclick: async () => { state.tab = key; await renderStock(root); },
        }, label)));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto' });

  const panels = { levels: renderLevels, movements: renderMovements, wastage: renderWastage, reorder: renderReorder, recipes: renderRecipes };
  panels[state.tab](root).then(panel => {
    inner.innerHTML = '';
    inner.appendChild(panel);
  }).catch(err => {
    console.error(err);
    inner.innerHTML = '';
    inner.appendChild(el('div', { class: 'bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm' }, 'Failed: ' + (err.message || err)));
  });

  body.appendChild(inner);
  wrap.appendChild(header); wrap.appendChild(tabs); wrap.appendChild(body);
  root.appendChild(wrap);
}

// ============================================================
// LEVELS
// ============================================================
async function renderLevels(root) {
  const wrap = el('div', {});

  const filterBar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center' });
  const searchIn = el('input', {
    type: 'search', placeholder: 'Search ingredient…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); repaint(); },
  });
  filterBar.appendChild(searchIn);

  const catSel = el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.categoryFilter = e.target.value; repaint(); },
  }, [
    el('option', { value: 'all' }, 'All categories'),
    ...state.categories.map(c => el('option', { value: c.id, selected: state.categoryFilter === c.id ? true : null }, c.name)),
  ]);
  filterBar.appendChild(catSel);

  filterBar.appendChild(el('label', { class: 'flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm cursor-pointer' }, [
    el('input', { type: 'checkbox', checked: state.lowOnly ? true : null, onchange: (e) => { state.lowOnly = e.target.checked; repaint(); } }),
    el('span', { class: 'text-slate-700' }, 'Low stock only'),
  ]));

  wrap.appendChild(filterBar);

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-3' });
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  const tbody = el('tbody');
  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Category'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'On Hand'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Min'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Value'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-24' }, ''),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);

  function repaint() {
    const filtered = state.levels.filter(i => {
      if (state.search && !i.name.toLowerCase().includes(state.search)) return false;
      if (state.categoryFilter !== 'all' && i.category_id !== state.categoryFilter) return false;
      if (state.lowOnly && !isLow(i)) return false;
      return true;
    });

    const low = filtered.filter(isLow);
    const totalValue = filtered.reduce((s, i) => s + Number(i.stock_value || 0), 0);

    summary.innerHTML = '';
    summary.appendChild(kpi('Total Items', String(filtered.length), 'from-slate-600 to-slate-700', 'Active ingredients'));
    summary.appendChild(kpi('Low Stock', String(low.length), low.length > 0 ? 'from-red-500 to-red-600' : 'from-emerald-500 to-emerald-600', 'Below minimum'));
    summary.appendChild(kpi('Stock Value', fmtMoney(totalValue), 'from-indigo-500 to-indigo-600', 'At avg cost'));
    summary.appendChild(kpi('Categories', String(state.categories.length), 'from-purple-500 to-purple-600', 'Active'));

    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.appendChild(el('tr', {}, [el('td', { class: 'text-center text-slate-400 text-sm py-10', colspan: 6 }, 'No ingredients match')]));
      return;
    }

    filtered.forEach(ing => {
      const low = isLow(ing);
      const pct = ing.min_stock > 0 ? Math.min(100, (Number(ing.quantity_on_hand) / Math.max(ing.min_stock * 3, 1)) * 100) : 0;
      const cat = state.categories.find(c => c.id === ing.category_id)?.name || '—';
      const unit = ing.units?.abbreviation || '';

      tbody.appendChild(el('tr', { class: `border-t border-slate-100 hover:bg-slate-50 ${low ? 'bg-red-50/40' : ''}` }, [
        el('td', { class: 'px-4 py-2.5' }, [
          el('div', { class: 'font-medium text-slate-800 truncate max-w-[200px]' }, ing.name),
          el('div', { class: 'text-[10px] text-slate-400 uppercase' }, ing.storage_type || 'dry'),
        ]),
        el('td', { class: 'px-4 py-2.5 text-xs text-slate-500 hidden md:table-cell' }, cat),
        el('td', { class: 'px-4 py-2.5 text-right' }, [
          el('div', { class: `font-semibold ${low ? 'text-red-600' : 'text-slate-800'}` }, `${formatQty(ing.quantity_on_hand)} ${unit}`),
          ing.min_stock > 0
            ? el('div', { class: 'mt-1 w-24 ml-auto bg-slate-100 rounded-full h-1 overflow-hidden' }, [
                el('div', { class: `${low ? 'bg-red-500' : 'bg-emerald-500'} h-full`, style: `width: ${pct}%` }),
              ])
            : null,
        ].filter(Boolean)),
        el('td', { class: 'px-4 py-2.5 text-right text-xs text-slate-500 hidden md:table-cell' }, `${formatQty(ing.min_stock)} ${unit}`),
        el('td', { class: 'px-4 py-2.5 text-right text-slate-700 hidden md:table-cell' }, fmtMoney(ing.stock_value)),
        el('td', { class: 'px-4 py-2.5 text-right' }, [
          el('button', {
            class: 'text-xs px-2.5 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium',
            onclick: () => openAdjustModal(root, ing),
          }, 'Adjust'),
        ]),
      ]));
    });
  }

  repaint();
  return wrap;
}

function isLow(ing) { return Number(ing.quantity_on_hand) <= Number(ing.min_stock || 0); }
function formatQty(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}
function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

// ============================================================
// MOVEMENTS
// ============================================================
async function renderMovements() {
  const { data: movs } = await supabase.from('stock_movements')
    .select('id, movement_type, quantity, unit_cost, total_cost, reference_type, notes, created_at, ingredient_id, ingredients(name, units(abbreviation))')
    .eq('outlet_id', store.state.outlet.id)
    .order('created_at', { ascending: false }).limit(100);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Recent Movements'),
    el('span', { class: 'text-xs text-slate-500' }, `${movs?.length || 0} entries`),
  ]));

  if (!movs?.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No movements yet'));
    return card;
  }

  const tbody = el('tbody');
  movs.forEach(m => {
    const isIn = Number(m.quantity) > 0;
    const unit = m.ingredients?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2' }, [
        el('div', { class: 'text-sm text-slate-800 truncate max-w-[180px]' }, m.ingredients?.name || '—'),
        m.notes ? el('div', { class: 'text-[10px] text-slate-400 truncate' }, m.notes) : null,
      ].filter(Boolean)),
      el('td', { class: 'px-4 py-2' }, [el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${badgeClass(m.movement_type)}` }, labelType(m.movement_type))]),
      el('td', { class: `px-4 py-2 text-right font-semibold ${isIn ? 'text-emerald-600' : 'text-red-600'}` }, (isIn ? '+' : '') + formatQty(m.quantity) + ' ' + unit),
      el('td', { class: 'px-4 py-2 text-right text-xs text-slate-500 hidden md:table-cell' }, m.unit_cost ? fmtMoney(m.unit_cost) : '—'),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700 hidden md:table-cell' }, m.total_cost ? fmtMoney(m.total_cost) : '—'),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'When'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Type'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Unit Cost'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Total'),
      ]),
    ]),
    tbody,
  ]));
  return card;
}
function badgeClass(t) {
  if (['purchase', 'opening', 'transfer_in', 'production_in', 'adjustment_in'].includes(t)) return 'bg-emerald-100 text-emerald-700';
  if (['sale_deduction', 'consumption'].includes(t)) return 'bg-indigo-100 text-indigo-700';
  if (['wastage', 'expiry'].includes(t)) return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
}
function labelType(t) {
  return { opening: 'Opening', purchase: 'Purchase', sale_deduction: 'Sale', wastage: 'Wastage', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', adjustment_in: 'Adj +', adjustment_out: 'Adj −', return_to_supplier: 'Return', production_in: 'Production', consumption: 'Consumption', expiry: 'Expiry' }[t] || t;
}

// ============================================================
// WASTAGE
// ============================================================
async function renderWastage(root) {
  const { data } = await supabase.from('wastage_logs')
    .select('id, quantity, cost, reason, notes, created_at, ingredients(name, units(abbreviation))')
    .eq('outlet_id', store.state.outlet.id)
    .order('created_at', { ascending: false }).limit(100);

  const wrap = el('div', {});
  const totalCost = (data || []).reduce((s, w) => s + Number(w.cost || 0), 0);
  const reasonCounts = {};
  (data || []).forEach(w => { reasonCounts[w.reason] = (reasonCounts[w.reason] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-3 gap-3 mb-3' });
  summary.appendChild(kpi('Total Wastage', fmtMoney(totalCost), 'from-red-500 to-red-600', `${data?.length || 0} entries`));
  summary.appendChild(kpi('Top Reason', topReason ? topReason[0].replace('_', ' ') : '—', 'from-amber-500 to-orange-500', topReason ? `${topReason[1]}×` : 'None'));
  summary.appendChild(kpi('This Month', fmtMoney(totalCost), 'from-slate-600 to-slate-700', 'Rolling total'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Wastage Log'),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold',
      onclick: () => openWastageModal(root),
    }, '+ Log Wastage'),
  ]));

  if (!data?.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No wastage logged yet'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  data.forEach(w => {
    const unit = w.ingredients?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(w.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, w.ingredients?.name || '—'),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, `${formatQty(w.quantity)} ${unit}`),
      el('td', { class: 'px-4 py-2 text-right text-sm text-red-600 font-semibold' }, fmtMoney(w.cost)),
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 capitalize' }, w.reason.replace('_', ' ')),
      el('td', { class: 'px-4 py-2 text-xs text-slate-400 truncate max-w-[180px]' }, w.notes || '—'),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'When'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Cost'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Reason'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Notes'),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);
  return wrap;
}

// ============================================================
// REORDER
// ============================================================
async function renderReorder() {
  const { data, error } = await supabase.from('v_reorder_sheet')
    .select('*').eq('outlet_id', store.state.outlet.id)
    .order('estimated_cost', { ascending: false });

  if (error) console.warn('[reorder]', error);
  const rows = data || [];
  const wrap = el('div', {});

  const totalCost = rows.reduce((s, r) => s + Number(r.estimated_cost || 0), 0);
  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-3 gap-3 mb-3' });
  summary.appendChild(kpi('Items to Order', String(rows.length), 'from-amber-500 to-orange-500', 'Below minimum stock'));
  summary.appendChild(kpi('Estimated Cost', fmtMoney(totalCost), 'from-indigo-500 to-indigo-600', 'At last purchase price'));
  summary.appendChild(kpi('Critical', String(rows.filter(r => Number(r.quantity_on_hand) === 0).length), 'from-red-500 to-red-600', 'Zero on hand'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Reorder Sheet'),
    rows.length ? el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium',
      onclick: () => copyReorderSheet(rows),
    }, 'Copy as Text') : null,
  ].filter(Boolean)));

  if (!rows.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, '🎉 Nothing to reorder'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  rows.forEach(r => {
    const critical = Number(r.quantity_on_hand) === 0;
    tbody.appendChild(el('tr', { class: `border-t border-slate-100 hover:bg-slate-50 ${critical ? 'bg-red-50/40' : ''}` }, [
      el('td', { class: 'px-4 py-2.5' }, [
        el('div', { class: 'font-medium text-slate-800 text-sm' }, r.ingredient_name),
        r.sku ? el('div', { class: 'text-[10px] text-slate-400' }, r.sku) : null,
      ].filter(Boolean)),
      el('td', { class: `px-4 py-2.5 text-right text-sm font-semibold ${critical ? 'text-red-600' : 'text-amber-600'}` }, `${formatQty(r.quantity_on_hand)} ${r.unit || ''}`),
      el('td', { class: 'px-4 py-2.5 text-right text-xs text-slate-500' }, `${formatQty(r.min_stock)} ${r.unit || ''}`),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-indigo-700 font-semibold' }, `${formatQty(r.suggested_order_qty)} ${r.unit || ''}`),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, fmtMoney(r.estimated_cost)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'On Hand'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Min'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Order Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Est. Cost'),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);
  return wrap;
}

function copyReorderSheet(rows) {
  const text = rows.map(r => `${r.ingredient_name}\t${formatQty(r.suggested_order_qty)} ${r.unit || ''}\t~₹${Number(r.estimated_cost).toFixed(2)}`).join('\n');
  const header = `Reorder Sheet — ${new Date().toLocaleDateString('en-IN')}\n${'─'.repeat(40)}\n`;
  navigator.clipboard.writeText(header + text).then(() => toast('Reorder sheet copied', 'success')).catch(() => toast('Copy failed', 'error'));
}

// ============================================================
// RECIPES
// ============================================================
async function renderRecipes() {
  const { data: recipes } = await supabase.from('recipes')
    .select('id, computed_cost, yield_quantity, menu_item_id, variant_id, is_active, menu_items(name, base_price), menu_item_variants(name, price), recipe_ingredients(quantity, ingredient_id, wastage_percent, ingredients(name, avg_cost, units(abbreviation)))')
    .eq('tenant_id', store.state.tenant.id).eq('is_active', true)
    .order('computed_cost', { ascending: false });

  const wrap = el('div', {});
  const list = recipes || [];
  const totalCost = list.reduce((s, r) => s + Number(r.computed_cost || 0), 0);
  const avgCost = list.length ? totalCost / list.length : 0;

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-3 gap-3 mb-3' });
  summary.appendChild(kpi('Active Recipes', String(list.length), 'from-purple-500 to-purple-600', 'With BOM defined'));
  summary.appendChild(kpi('Avg Recipe Cost', fmtMoney(avgCost), 'from-slate-600 to-slate-700', 'Per unit'));
  summary.appendChild(kpi('Total BOM Cost', fmtMoney(totalCost), 'from-indigo-500 to-indigo-600', 'Sum of all recipes'));
  wrap.appendChild(summary);

  if (!list.length) {
    wrap.appendChild(el('div', { class: 'bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm' }, 'No recipes yet'));
    return wrap;
  }

  const grid = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' });
  list.forEach(r => {
    const itemName = r.menu_items?.name || '—';
    const variant = r.menu_item_variants?.name ? ` (${r.menu_item_variants.name})` : '';
    const sellPrice = Number(r.menu_item_variants?.price ?? r.menu_items?.base_price ?? 0);
    const cost = Number(r.computed_cost || 0);
    const margin = sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : 0;

    const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
    card.appendChild(el('div', { class: 'px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-2' }, [
      el('div', { class: 'min-w-0' }, [
        el('div', { class: 'font-semibold text-slate-800 text-sm truncate' }, itemName + variant),
        el('div', { class: 'text-[10px] text-slate-500 uppercase' }, `Yield: ${r.yield_quantity}`),
      ]),
      el('div', { class: 'text-right shrink-0' }, [
        el('div', { class: `text-xs font-semibold ${margin < 20 ? 'text-red-600' : margin < 40 ? 'text-amber-600' : 'text-emerald-600'}` }, margin.toFixed(1) + '%'),
        el('div', { class: 'text-[10px] text-slate-400' }, 'margin'),
      ]),
    ]));

    card.appendChild(el('div', { class: 'grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100' }, [
      el('div', { class: 'px-3 py-2 text-center' }, [
        el('div', { class: 'text-[9px] uppercase text-slate-500 font-semibold' }, 'Cost'),
        el('div', { class: 'text-sm font-bold text-slate-800' }, fmtMoney(cost)),
      ]),
      el('div', { class: 'px-3 py-2 text-center' }, [
        el('div', { class: 'text-[9px] uppercase text-slate-500 font-semibold' }, 'Sell'),
        el('div', { class: 'text-sm font-bold text-slate-800' }, fmtMoney(sellPrice)),
      ]),
    ]));

    const ingList = el('div', { class: 'p-3 space-y-1 max-h-40 overflow-y-auto' });
    (r.recipe_ingredients || []).forEach(ri => {
      const qty = Number(ri.quantity || 0);
      const unit = ri.ingredients?.units?.abbreviation || '';
      const lineCost = qty * Number(ri.ingredients?.avg_cost || 0);
      ingList.appendChild(el('div', { class: 'flex items-center justify-between text-xs' }, [
        el('span', { class: 'text-slate-600 truncate flex-1 mr-2' }, ri.ingredients?.name || '—'),
        el('span', { class: 'text-slate-500 font-mono text-[10px] mr-2' }, formatQty(qty) + ' ' + unit),
        el('span', { class: 'text-slate-700 font-medium' }, fmtMoney(lineCost)),
      ]));
    });
    if (!r.recipe_ingredients?.length) {
      ingList.appendChild(el('div', { class: 'text-xs text-slate-400 italic text-center py-2' }, 'No ingredients'));
    }
    card.appendChild(ingList);
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  return wrap;
}

// ============================================================
// MODAL — ADJUST STOCK
// ============================================================
function openAdjustModal(root, preselected = null) {
  const ingredients = state.levels;
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Manual Stock Adjustment'));

  const ingSel = el('select', { class: inputCls }, [
    el('option', { value: '' }, 'Select ingredient…'),
    ...ingredients.map(i => el('option', { value: i.id, selected: preselected?.id === i.id ? true : null },
      `${i.name} — on hand: ${formatQty(i.quantity_on_hand)} ${i.units?.abbreviation || ''}`)),
  ]);

  const typeSel = el('select', { class: inputCls }, [
    el('option', { value: 'adjustment_in' }, 'Adjustment + (found stock)'),
    el('option', { value: 'adjustment_out' }, 'Adjustment − (removed)'),
    el('option', { value: 'wastage' }, 'Wastage / Spillage'),
    el('option', { value: 'expiry' }, 'Expired'),
    el('option', { value: 'opening' }, 'Opening Stock'),
  ]);

  const qtyIn = el('input', { type: 'number', step: '0.001', min: '0', placeholder: 'Quantity', class: inputCls });
  const reasonIn = el('input', { type: 'text', placeholder: 'Reason / notes', class: inputCls });
  const preview = el('div', { class: 'text-xs text-slate-500' }, '');

  function updatePreview() {
    const ing = ingredients.find(i => i.id === ingSel.value);
    const qty = Number(qtyIn.value || 0);
    if (!ing || !qty) { preview.textContent = ''; return; }
    const sign = ['adjustment_in', 'opening'].includes(typeSel.value) ? 1 : -1;
    const after = Number(ing.quantity_on_hand) + sign * qty;
    preview.textContent = `After: ${formatQty(after)} ${ing.units?.abbreviation || ''}`;
  }
  ingSel.addEventListener('change', updatePreview);
  qtyIn.addEventListener('input', updatePreview);
  typeSel.addEventListener('change', updatePreview);

  const actions = el('div', { class: 'grid grid-cols-2 gap-2 pt-1' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const ingId = ingSel.value;
        const qty = Number(qtyIn.value || 0);
        if (!ingId) { toast('Select ingredient', 'warn'); return; }
        if (!qty || qty <= 0) { toast('Enter valid quantity', 'warn'); return; }
        const ing = ingredients.find(i => i.id === ingId);
        const sign = ['adjustment_in', 'opening'].includes(typeSel.value) ? 1 : -1;
        const signed = sign * qty;
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Saving…';
        try {
          const { error } = await supabase.from('stock_movements').insert({
            tenant_id: store.state.tenant.id,
            outlet_id: store.state.outlet.id,
            ingredient_id: ingId,
            movement_type: typeSel.value,
            quantity: signed,
            unit_cost: Number(ing.avg_cost || 0),
            total_cost: Math.abs(signed) * Number(ing.avg_cost || 0),
            reference_type: 'manual',
            notes: reasonIn.value.trim() || null,
            created_by: store.state.session?.user?.id || null,
          });
          if (error) throw error;
          toast('Stock adjusted', 'success');
          overlay.remove();
          state.loaded = false;
          await renderStock(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Save';
        }
      },
    }, 'Save Adjustment'),
  ]);

  card.appendChild(ingSel); card.appendChild(typeSel); card.appendChild(qtyIn); card.appendChild(reasonIn); card.appendChild(preview); card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => ingSel.focus(), 50);
}

// ============================================================
// MODAL — WASTAGE
// ============================================================
function openWastageModal(root) {
  const ingredients = state.levels;
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Log Wastage'));

  const ingSel = el('select', { class: inputCls }, [
    el('option', { value: '' }, 'Select ingredient…'),
    ...ingredients.map(i => el('option', { value: i.id }, `${i.name} — on hand: ${formatQty(i.quantity_on_hand)} ${i.units?.abbreviation || ''}`)),
  ]);
  const reasonSel = el('select', { class: inputCls }, [
    el('option', { value: 'spoilage' }, 'Spoilage'),
    el('option', { value: 'expired' }, 'Expired'),
    el('option', { value: 'overcooked' }, 'Overcooked / Burnt'),
    el('option', { value: 'customer_return' }, 'Customer Return'),
    el('option', { value: 'staff_meal' }, 'Staff Meal'),
    el('option', { value: 'other' }, 'Other'),
  ]);
  const qtyIn = el('input', { type: 'number', step: '0.001', min: '0', placeholder: 'Quantity wasted', class: inputCls });
  const notesIn = el('input', { type: 'text', placeholder: 'Notes (optional)', class: inputCls });

  const actions = el('div', { class: 'grid grid-cols-2 gap-2 pt-1' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const ingId = ingSel.value;
        const qty = Number(qtyIn.value || 0);
        if (!ingId) { toast('Select ingredient', 'warn'); return; }
        if (!qty || qty <= 0) { toast('Enter valid quantity', 'warn'); return; }
        const ing = ingredients.find(i => i.id === ingId);
        const cost = qty * Number(ing.avg_cost || 0);
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Saving…';
        try {
          const { error: wErr } = await supabase.from('wastage_logs').insert({
            tenant_id: store.state.tenant.id,
            outlet_id: store.state.outlet.id,
            ingredient_id: ingId,
            quantity: qty,
            unit_id: ing.unit_id,
            cost: cost,
            reason: reasonSel.value,
            notes: notesIn.value.trim() || null,
            logged_by: store.state.member?.id || null,
          });
          if (wErr) throw wErr;

          const { error: mErr } = await supabase.from('stock_movements').insert({
            tenant_id: store.state.tenant.id,
            outlet_id: store.state.outlet.id,
            ingredient_id: ingId,
            movement_type: 'wastage',
            quantity: -qty,
            unit_cost: Number(ing.avg_cost || 0),
            total_cost: cost,
            reference_type: 'wastage',
            notes: `${reasonSel.value}: ${notesIn.value || ''}`.trim(),
            created_by: store.state.session?.user?.id || null,
          });
          if (mErr) throw mErr;

          toast('Wastage logged', 'success');
          overlay.remove();
          state.loaded = false;
          await renderStock(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Log Wastage';
        }
      },
    }, 'Log Wastage'),
  ]);

  card.appendChild(ingSel); card.appendChild(reasonSel); card.appendChild(qtyIn); card.appendChild(notesIn); card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => ingSel.focus(), 50);
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
