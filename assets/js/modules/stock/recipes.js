import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderRecipes() {
  const tenantId = store.state.tenant.id;
  
  // Fetch data safely without nested joins to avoid PostgREST bugs
  const [recRes, itemRes, varRes, rIngRes] = await Promise.all([
    supabase.from('recipes').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('computed_cost', { ascending: false }),
    supabase.from('menu_items').select('id, name, base_price').eq('tenant_id', tenantId),
    supabase.from('menu_item_variants').select('id, name, price, menu_item_id').eq('tenant_id', tenantId),
    supabase.from('recipe_ingredients').select('*').eq('tenant_id', tenantId)
  ]);

  const recipes = recRes.data || [];
  const items = itemRes.data || [];
  const vars = varRes.data || [];
  const r_ings = rIngRes.data || [];

  const itemMap = new Map(items.map(i => [i.id, i]));
  const varMap = new Map(vars.map(v => [v.id, v]));

  // Attach ingredients to recipes
  recipes.forEach(r => {
    r.recipe_ingredients = r_ings.filter(ri => ri.recipe_id === r.id).map(ri => ({
      ...ri,
      ingredient: state.ingredients.find(i => i.id === ri.ingredient_id)
    }));
  });

  const wrap = el('div', {});
  const totalCost = recipes.reduce((s, r) => s + Number(r.computed_cost || 0), 0);
  const avgCost = recipes.length ? totalCost / recipes.length : 0;

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-3 gap-3 mb-3' });
  summary.appendChild(kpi('Active Recipes', String(recipes.length), 'from-purple-500 to-purple-600', 'With BOM defined'));
  summary.appendChild(kpi('Avg Recipe Cost', fmtMoney(avgCost), 'from-slate-600 to-slate-700', 'Per unit'));
  summary.appendChild(kpi('Total BOM Cost', fmtMoney(totalCost), 'from-indigo-500 to-indigo-600', 'Sum of all recipes'));
  wrap.appendChild(summary);

  if (!recipes.length) {
    wrap.appendChild(el('div', { class: 'bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm' }, 'No recipes yet. Go to the "📖 Recipes" tab in the top menu to create one.'));
    return wrap;
  }

  const grid = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' });
  recipes.forEach(r => {
    const item = itemMap.get(r.menu_item_id);
    const variant = r.variant_id ? varMap.get(r.variant_id) : null;
    
    const itemName = item?.name || '—';
    const variantName = variant?.name ? ` (${variant.name})` : '';
    const sellPrice = Number(variant?.price ?? item?.base_price ?? 0);
    const cost = Number(r.computed_cost || 0);
    const margin = sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : 0;

    const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
    card.appendChild(el('div', { class: 'px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-2' }, [
      el('div', { class: 'min-w-0' }, [
        el('div', { class: 'font-semibold text-slate-800 text-sm truncate' }, itemName + variantName),
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
      const unit = ri.ingredient?.units?.abbreviation || '';
      const lineCost = qty * Number(ri.ingredient?.avg_cost || 0);
      ingList.appendChild(el('div', { class: 'flex items-center justify-between text-xs' }, [
        el('span', { class: 'text-slate-600 truncate flex-1 mr-2' }, ri.ingredient?.name || '—'),
        el('span', { class: 'text-slate-500 font-mono text-[10px] mr-2' }, formatQty(qty) + ' ' + unit),
        el('span', { class: 'text-slate-700 font-medium' }, fmtMoney(lineCost)),
      ]));
    });
    if (!r.recipe_ingredients?.length) {
      ingList.appendChild(el('div', { class: 'text-xs text-slate-400 italic text-center py-2' }, 'No ingredients linked'));
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
// ============================================================
// MODAL — WASTAGE
// ============================================================
