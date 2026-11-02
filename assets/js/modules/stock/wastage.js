import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderWastage(root) {
  const { data } = await supabase.from('wastage_logs')
    .select('*')
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
    const ing = state.ingredients.find(i => i.id === w.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(w.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, ing?.name || '—'),
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
