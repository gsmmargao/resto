import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderStockReport() {
  const { data, error } = await supabase.from('stock_count_items')
    .select(`
      id, counted_qty, system_qty, variance_qty, ingredient_id, created_at,
      stock_counts!inner(count_number, completed_at)
    `)
    .eq('tenant_id', store.state.tenant.id)
    .order('created_at', { ascending: false });

  if (error) console.error(error);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Physical Stock Count Report'),
  ]));

  if (!data?.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No physical stock counts recorded yet'));
    return card;
  }

  const tbody = el('tbody');
  data.forEach(item => {
    const ing = state.ingredients.find(i => i.id === item.ingredient_id);
    const variance = Number(item.variance_qty);
    const isMatch = variance === 0;
    const isSurplus = variance > 0;
    
    let varColor = 'text-slate-400';
    let varText = 'Matches';
    if (!isMatch) {
      varColor = isSurplus ? 'text-emerald-600' : 'text-red-600';
      varText = (isSurplus ? '+' : '') + variance.toFixed(2);
    }

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, 
        new Date(item.stock_counts.completed_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 font-mono' }, item.stock_counts.count_number),
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, ing?.name || '—'),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-500' }, Number(item.system_qty).toFixed(2)),
      el('td', { class: 'px-4 py-2 text-right text-sm font-semibold text-slate-800' }, Number(item.counted_qty).toFixed(2)),
      el('td', { class: `px-4 py-2 text-right font-bold ${varColor}` }, varText),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Count #'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'System Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Counted Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Variance'),
      ]),
    ]),
    tbody,
  ]));
  return card;
}
