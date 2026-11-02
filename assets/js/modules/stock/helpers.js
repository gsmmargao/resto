import { el, fmtMoney, toast } from '../../utils.js';
import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';

export const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
export const field = (label, input) => el('div', { class: 'mb-3' }, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    input
]);

export const state = {
    tab: 'levels',
    loaded: false,
    ingredients: [],
    categories: [],
    levels: [],
    search: '',
    categoryFilter: 'all',
    lowOnly: false
};


// === Auto-extracted helper functions (from original stock.js) ===

export function isLow(ing) { return Number(ing.quantity_on_hand) <= Number(ing.min_stock || 0); }

export function formatQty(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

export function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

export function badgeClass(t) {
  if (['purchase', 'opening', 'transfer_in', 'production_in', 'adjustment_in'].includes(t)) return 'bg-emerald-100 text-emerald-700';
  if (['sale_deduction', 'consumption'].includes(t)) return 'bg-indigo-100 text-indigo-700';
  if (['wastage', 'expiry'].includes(t)) return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
}

export function labelType(t) {
  return { opening: 'Opening', purchase: 'Purchase', sale_deduction: 'Sale', wastage: 'Wastage', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', adjustment_in: 'Adj +', adjustment_out: 'Adj −', return_to_supplier: 'Return', production_in: 'Production', consumption: 'Consumption', expiry: 'Expiry' }[t] || t;
}

export function copyReorderSheet(rows) {
  const text = rows.map(r => `${r.ingredient_name}\t${formatQty(r.suggested_order_qty)} ${r.unit || ''}\t~₹${Number(r.estimated_cost).toFixed(2)}`).join('\n');
  const header = `Reorder Sheet — ${new Date().toLocaleDateString('en-IN')}\n${'─'.repeat(40)}\n`;
  navigator.clipboard.writeText(header + text).then(() => toast('Reorder sheet copied', 'success')).catch(() => toast('Copy failed', 'error'));
}

export function openAdjustModal(root, preselected = null) {
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

export function openWastageModal(root) {
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
