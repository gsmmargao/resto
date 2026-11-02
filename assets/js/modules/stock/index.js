import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

import { renderLevels } from './levels.js';
import { renderMovements } from './movements.js';
import { renderWastage } from './wastage.js';
import { renderReorder } from './reorder.js';
import { renderRecipes } from './recipes.js';
import { renderStockReport } from './report.js';

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
  const tenantId = store.state.tenant?.id;
  const outletId = store.state.outlet?.id;
  console.log('[stock] loadBase START -> tenantId:', tenantId, '| outletId:', outletId);
  if (!tenantId || !outletId) {
    console.error('[stock] ABORT: tenant or outlet missing from store.state');
    return;
  }

  const [ingRes, catRes, lvlRes, unitRes] = await Promise.all([
    supabase.from('ingredients')
      .select('*')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('ingredient_categories').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('stock_levels').select('*').eq('outlet_id', outletId),
    supabase.from('units').select('id, name, abbreviation').eq('tenant_id', tenantId)
  ]);

  if (ingRes.error) console.error('[stock] ingredients error:', ingRes.error, 'status:', ingRes.status);
  console.log('[stock] loaded ingredients:', (ingRes.data || []).length, 'items');

  const unitMap = new Map((unitRes.data || []).map(u => [u.id, u]));
  state.ingredients = (ingRes.data || []).map(i => ({
    ...i,
    units: unitMap.get(i.unit_id) || null
  }));

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
    [['levels', 'Stock Levels'], ['movements', 'Movements'], ['wastage', 'Wastage'], ['reorder', 'Reorder'], ['recipes', 'Recipes'], ['report', 'Stock Report']]
      .map(([key, label]) =>
        el('button', {
          class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
          onclick: async () => { state.tab = key; await renderStock(root); },
        }, label)));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto' });

  const panels = { levels: renderLevels, movements: renderMovements, wastage: renderWastage, reorder: renderReorder, recipes: renderRecipes, report: renderStockReport };
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
