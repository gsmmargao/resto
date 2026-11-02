import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderMovements() {
  const { data: movs, error } = await supabase.from('stock_movements')
    .select('*')
    .eq('outlet_id', store.state.outlet.id)
    .order('created_at', { ascending: false }).limit(100);

  if (error) console.error(error);

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
    const ing = state.ingredients.find(i => i.id === m.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2' }, [
        el('div', { class: 'text-sm text-slate-800 truncate max-w-[180px]' }, ing?.name || '—'),
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
// ============================================================
// WASTAGE
// ============================================================
