import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast } from '../utils.js';

export async function renderStoreKeeper(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading inventory…'));

  const tenantId = store.state.tenant.id;
  const outletId = store.state.outlet.id;

  const [ingRes, lvlRes] = await Promise.all([
    supabase.from('ingredients').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('stock_levels').select('ingredient_id, quantity_on_hand').eq('outlet_id', outletId)
  ]);

  const levels = new Map((lvlRes.data || []).map(l => [l.ingredient_id, l.quantity_on_hand]));
  const ingredients = ingRes.data || [];

  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });
  const header = el('div', { class: 'bg-white border-b border-slate-200 px-6 py-4' }, [
    el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Record Physical Stock'),
    el('p', { class: 'text-xs text-slate-500' }, 'Enter the actual counted quantities. System stock will be adjusted automatically.'),
  ]);
  wrap.appendChild(header);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-6' });
  const card = el('div', { class: 'max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' });
  const tbody = el('tbody');
  
  const inputs = new Map();

  ingredients.forEach(ing => {
    const sysQty = levels.get(ing.id) || 0;
    const inp = el('input', {
      type: 'number', step: '0.001', placeholder: sysQty,
      class: 'w-24 px-2 py-1.5 rounded border border-slate-300 text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:outline-none'
    });
    inputs.set(ing.id, inp);

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-4 py-2.5 text-sm font-medium text-slate-800' }, ing.name),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-500' }, String(sysQty)),
      el('td', { class: 'px-4 py-2.5 text-right' }, [inp]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Item Name'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-24' }, 'System Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-32' }, 'Actual Count'),
      ]),
    ]),
    tbody,
  ]));
  
  const footer = el('div', { class: 'p-4 bg-slate-50 border-t border-slate-200 flex justify-end' }, [
    el('button', {
      class: 'px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Saving…';
        
        const items = [];
        inputs.forEach((inp, id) => {
          if (inp.value.trim() !== '') {
            items.push({ ingredient_id: id, actual_qty: Number(inp.value) });
          }
        });

        if (!items.length) { toast('Enter at least one count', 'warn'); btn.disabled = false; btn.textContent = 'Submit Count'; return; }

        try {
          const { error } = await supabase.rpc('submit_stock_count', { p_items: items });
          if (error) throw error;
          toast('Stock updated successfully!', 'success');
          renderStoreKeeper(root); // reload
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Submit Count';
        }
      }
    }, 'Submit Count')
  ]);
  card.appendChild(footer);

  body.appendChild(card);
  wrap.appendChild(body);
  root.appendChild(wrap);
}
