import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderReorder() {
  const { data, error } = await supabase.from('v_reorder_sheet')
    .select('*').eq('tenant_id', store.state.tenant.id)
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

// ============================================================
// RECIPES
// ============================================================
