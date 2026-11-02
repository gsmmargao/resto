import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, inputCls, field, isLow, formatQty, kpi, badgeClass, labelType, copyReorderSheet, openAdjustModal, openWastageModal } from './helpers.js';

export async function renderLevels(root) {
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

// ============================================================
// MOVEMENTS
// ============================================================
