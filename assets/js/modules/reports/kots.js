import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el } from '../../utils.js';

export async function renderKOTs() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading KOTs...</div>';

  const outletId = store.state.outlet?.id;
  if (!outletId) {
    wrapper.innerHTML = '<div class="text-red-500 p-4">No outlet selected</div>';
    return wrapper;
  }

  try {
    const fromDate = (window.state && window.state.startDate) || new Date().toISOString().split('T')[0];
    const toDate = (window.state && window.state.endDate) || new Date().toISOString().split('T')[0];

    let query = supabase.from('kots')
      .select('*, orders(table_name_snapshot)')
      .eq('outlet_id', outletId)
      .order('created_at', { ascending: false });

    if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString());
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      query = query.lte('created_at', to.toISOString());
    }

    const { data: kots, error } = await query;
    if (error) throw error;

    if (!kots || kots.length === 0) {
      wrapper.innerHTML = '<div class="text-center py-10 text-slate-500">No KOTs found for this period.</div>';
      return wrapper;
    }

    // Build card
    const card = el('div', { class: 'bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mt-4' });
    card.appendChild(el('div', { class: 'px-4 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 flex justify-between items-center' }, [
      el('span', {}, 'Recent KOTs'),
      el('span', { class: 'text-xs font-normal text-slate-500' }, kots.length + ' KOTs')
    ]));

    const table = el('table', { class: 'w-full text-sm text-left text-slate-600' });
    table.innerHTML = '<thead class="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th class="px-4 py-3">Time</th><th class="px-4 py-3">KOT #</th><th class="px-4 py-3">Table</th><th class="px-4 py-3">Status</th><th class="px-4 py-3 text-right">Action</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');

    kots.forEach(k => {
      const tr = el('tr', { class: 'border-b border-slate-100 hover:bg-slate-50' });
      const timeStr = new Date(k.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(k.created_at).toLocaleDateString('en-GB');
      const tableNameRaw = (k.orders && k.orders.table_name_snapshot) || 'Take-away';
      const tableName = tableNameRaw.split(' - ')[0];

      tr.innerHTML = '<td class="px-4 py-3"><div class="font-medium">' + dateStr + '</div><div class="text-xs text-slate-400">' + timeStr + '</div></td>' +
        '<td class="px-4 py-3 font-semibold text-slate-800">KOT-' + k.kot_number + '</td>' +
        '<td class="px-4 py-3 font-medium">' + tableName + '</td>' +
        '<td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-semibold bg-' + (k.status === 'ready' ? 'emerald' : 'amber') + '-100 text-' + (k.status === 'ready' ? 'emerald' : 'amber') + '-700">' + k.status.toUpperCase() + '</span></td>' +
        '<td class="px-4 py-3 text-right"><button class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-semibold border border-blue-200 transition">Print</button></td>';

      tr.querySelector('button').onclick = async (e) => {
        const btn = e.currentTarget;
        const orig = btn.innerHTML;
        btn.innerHTML = 'Printing...';
        btn.disabled = true;
        try {
          const { data: items } = await supabase.from('kot_items').select('*').eq('kot_id', k.id);
          const payload = {
            kot: k.kot_number,
            items: (items || []).map(it => ({ quantity: it.quantity, name: it.name_snapshot, variant: it.variant_name, notes: it.notes })),
            tableName: tableName,
            waiterName: 'admin'
          };
          await fetch('https://192.168.100.19:3000/api/print-kot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (window.toast) window.toast('KOT printed successfully', 'success');
        } catch (err) {
          console.error(err);
          if (window.toast) window.toast('Failed to print KOT', 'error');
        }
        btn.innerHTML = orig;
        btn.disabled = false;
      };

      tbody.appendChild(tr);
    });

    card.appendChild(table);
    wrapper.innerHTML = '';
    wrapper.appendChild(card);
    return wrapper;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = '<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading KOTs: ' + err.message + '</div>';
    return wrapper;
  }
}
