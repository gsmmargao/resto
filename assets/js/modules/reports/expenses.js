import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state } from './helpers.js';

export async function renderExpenses() {
  const wrapper = el('div', { class: 'w-full space-y-6' });
  const isAdmin = ['admin', 'owner', 'super-admin'].includes(store.state.member?.role);
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Expense Book...</div>';
  
  const outletId = store.state.outlet.id;
  const from = state.startDate + 'T00:00:00';
  const to = state.endDate + 'T23:59:59';

  try {
    const { data: expenses, error } = await supabase.from('expenses')
      .select('*')
      .eq('outlet_id', outletId)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);

    wrapper.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex-1 mr-4">
          <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Expenses (Selected Period)</div>
          <div class="text-3xl font-bold text-red-600 mt-1">₹${totalExpenses.toFixed(2)}</div>
        </div>
        <div class="flex gap-2">
          <button id="btn-view-ledger" class="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition shadow-sm text-sm">View Ledger</button>
          <button id="btn-add-expense" class="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm text-sm">+ Add Expense</button>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 class="font-bold text-slate-800 text-sm">Recent Expenses</h3>
          <span class="text-xs font-semibold text-slate-500">${expenses ? expenses.length : 0} entries</span>
        </div>
        <table class="w-full text-left">
          <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
            <tr>
              <th class="px-5 py-3">Date</th>
              <th class="px-5 py-3">Name / Description</th>
              <th class="px-5 py-3">Notes</th>
              <th class="px-5 py-3 text-center">Mode</th>
              <th class="px-5 py-3 text-right">Amount</th>
              ${isAdmin ? '<th class="px-5 py-3 text-right">Action</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${(!expenses || expenses.length === 0) ? '<tr><td colspan="${isAdmin ? 6 : 5}" class="text-center py-8 text-slate-400 text-sm">No expenses in this period.</td></tr>' : 
              expenses.map(e => {
                const displayName = e.staff_name || e.custom_category || e.category;
                return `
                <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                  <td class="px-5 py-3 text-sm text-slate-600">${new Date(e.created_at).toLocaleDateString('en-GB')}</td>
                  <td class="px-5 py-3 text-sm font-semibold text-slate-800">${displayName}</td>
                  <td class="px-5 py-3 text-sm text-slate-500">${e.notes || '—'}</td>
                  <td class="px-5 py-3 text-center">
                  ${isAdmin ? `
                      <select class="mode-select px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold border border-slate-200 outline-none cursor-pointer hover:bg-slate-200 transition" data-id="${e.id}" data-old="${e.payment_mode}">
                          <option value="cash" ${e.payment_mode === 'cash' ? 'selected' : ''}>CASH</option>
                          <option value="upi" ${e.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                          <option value="card" ${e.payment_mode === 'card' ? 'selected' : ''}>CARD</option>
                      </select>
                  ` : `<span class="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${e.payment_mode.toUpperCase()}</span>`}
                  </td>
                  <td class="px-5 py-3 text-sm font-bold text-red-600 text-right">-₹${Number(e.amount).toFixed(2)}</td>
                  ${isAdmin ? `<td class="px-5 py-3 text-right">
                      <button class="btn-delete-exp text-red-500 hover:text-red-700 transition p-1" data-id="${e.id}" title="Delete Expense">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                  </td>` : ''}
                </tr>
              `}).join('')
            }
          </tbody>
        </table>
      </div>
    `;

    
    if (isAdmin) {
        wrapper.querySelectorAll('.mode-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                const newMode = e.target.value;
                const id = e.target.dataset.id;
                const oldMode = e.target.dataset.old;
                e.target.disabled = true;
                e.target.style.opacity = '0.5';
                
                const { error } = await supabase.from('expenses').update({ payment_mode: newMode }).eq('id', id);
                e.target.disabled = false;
                e.target.style.opacity = '1';
                
                if (error) {
                    toast('Failed: ' + error.message, 'error');
                    e.target.value = oldMode;
                } else {
                    toast('Payment mode updated', 'success');
                    e.target.dataset.old = newMode;
                }
            });
        });

        wrapper.querySelectorAll('.btn-delete-exp').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm('Are you sure you want to delete this expense permanently?')) return;
                const id = btn.dataset.id;
                btn.disabled = true;
                btn.innerHTML = '<div class="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>';
                
                const { error } = await supabase.from('expenses').delete().eq('id', id);
                if (error) {
                    toast('Failed: ' + error.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
                } else {
                    toast('Expense deleted', 'success');
                    const newHtml = await renderExpenses();
                    wrapper.replaceWith(newHtml);
                }
            });
        });
    }
    
    wrapper.querySelector('#btn-add-expense').onclick = () => openAddExpenseModal(() => renderExpenses().then(html => wrapper.replaceWith(html)));
    wrapper.querySelector('#btn-view-ledger').onclick = () => openFullLedgerPage();

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading expenses: ${err.message}</div>`;
  }

  return wrapper;
}

async function openAddExpenseModal(onSuccess) {
  const { data: pastExpenses } = await supabase.from('expenses')
      .select('staff_name, custom_category, category')
      .eq('outlet_id', store.state.outlet.id);
  
  const pastNames = new Set();
  (pastExpenses || []).forEach(e => {
      if (e.staff_name) pastNames.add(e.staff_name);
      if (e.custom_category) pastNames.add(e.custom_category);
      if (e.category && e.category !== 'General' && e.category !== 'Others') pastNames.add(e.category);
  });

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Add Expense'));

  const nameIn = el('input', { 
    type: 'text', placeholder: 'Enter Name (e.g. Rent, Mukesh)', class: 'w-full p-2.5 border border-slate-300 rounded-lg text-sm',
    list: 'expense_names_datalist', autocomplete: 'off'
  });

  const datalist = document.createElement('datalist');
  datalist.id = 'expense_names_datalist';
  Array.from(pastNames).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
  });

  const amountIn = el('input', { type: 'number', step: '0.01', placeholder: 'Amount (₹)', class: 'w-full p-2.5 border border-slate-300 rounded-lg text-sm' });
  const modeIn = el('select', { class: 'w-full p-2.5 border border-slate-300 rounded-lg text-sm' }, [
    el('option', { value: 'cash' }, 'Cash'),
    el('option', { value: 'upi' }, 'UPI')
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes / Reference (Optional)', class: 'w-full p-2.5 border border-slate-300 rounded-lg text-sm' });

  const saveBtn = el('button', { class: 'w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm mt-2' }, 'Save Expense');
  saveBtn.onclick = async () => {
    const name = nameIn.value.trim();
    const amt = Number(amountIn.value);
    if (!name) return toast('Please enter a name', 'warn');
    if (!amt || amt <= 0) return toast('Enter a valid amount', 'warn');
    
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

    try {
      await supabase.from('expenses').insert({
        tenant_id: store.state.tenant.id,
        outlet_id: store.state.outlet.id,
        expense_type: 'general', 
        category: 'General', 
        custom_category: name,
        amount: amt,
        payment_mode: modeIn.value,
        notes: notesIn.value,
        staff_name: null,
        created_by: store.state.session?.user?.id
      });
      toast('Expense recorded', 'success');
      overlay.remove();
      if (onSuccess) onSuccess();
    } catch (err) {
      toast('Failed: ' + err.message, 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Save Expense';
    }
  };

  card.append(nameIn, datalist, amountIn, modeIn, notesIn, saveBtn);
  card.appendChild(el('button', { class: 'w-full py-2 text-slate-500 text-sm', onclick: () => overlay.remove() }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function openFullLedgerPage() {
  const overlay = el('div', { class: 'fixed inset-0 bg-slate-50 z-[100] flex flex-col overflow-hidden' });
  
  const header = el('div', { class: 'bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm' }, [
      el('div', {}, [
          el('h2', { class: 'text-xl font-bold text-slate-800' }, 'Complete Expense Ledger'),
          el('p', { class: 'text-sm text-slate-500' }, 'All-time summary by name')
      ]),
      el('button', { class: 'px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-sm transition', onclick: () => overlay.remove() }, '← Back')
  ]);
  overlay.appendChild(header);

  const searchWrap = el('div', { class: 'px-6 py-3 bg-white border-b border-slate-200 shrink-0' }, [
      el('input', { 
          type: 'text', 
          id: 'ledger-search',
          placeholder: 'Search by name...', 
          class: 'w-full max-w-md p-2 border border-slate-300 rounded-lg text-sm',
          oninput: (e) => window.filterLedgerSummary(e.target.value.toLowerCase())
      })
  ]);
  overlay.appendChild(searchWrap);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-6' });
  body.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading all data...</div>';
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  try {
      const { data: expenses } = await supabase.from('expenses')
          .select('*')
          .eq('outlet_id', store.state.outlet.id)
          .order('created_at', { ascending: false });

      if (!expenses || expenses.length === 0) {
          body.innerHTML = '<div class="text-center py-10 text-slate-400">No expenses recorded yet.</div>';
          return;
      }

      // Group by Name
      const grouped = {};
      expenses.forEach(e => {
          const name = e.staff_name || e.custom_category || e.category || 'Unknown';
          if (!grouped[name]) grouped[name] = { total: 0, entries: [] };
          grouped[name].total += Number(e.amount);
          grouped[name].entries.push(e);
      });

      const uniqueNames = Object.keys(grouped).sort();
      const grandTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);

      const tableWrap = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm max-w-6xl mx-auto' });
      const table = el('table', { class: 'w-full text-left' }, [
          el('thead', { class: 'bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200 sticky top-0' }, [
              el('tr', {}, [
                  el('th', { class: 'p-4' }, 'Name / Description'), 
                  el('th', { class: 'p-4 text-right' }, 'Total Amount')
              ])
          ]),
          el('tbody', { id: 'ledger-tbody' }),
          el('tfoot', { class: 'bg-slate-50 border-t border-slate-200 sticky bottom-0' }, [
              el('tr', {}, [
                  el('td', { class: 'p-4 font-bold text-slate-700' }, 'GRAND TOTAL'),
                  el('td', { class: 'p-4 text-right font-bold text-red-600 text-lg' }, `-₹${grandTotal.toFixed(2)}`)
              ])
          ])
      ]);
      
      tableWrap.appendChild(table);
      body.innerHTML = '';
      body.appendChild(tableWrap);

      // Render Summary Rows
      window.renderSummaryRows = (filterText = '') => {
          const tbody = document.getElementById('ledger-tbody');
          if (!tbody) return;
          
          tbody.innerHTML = '';
          uniqueNames
              .filter(name => name.toLowerCase().includes(filterText))
              .forEach(name => {
                  const data = grouped[name];
                  const row = el('tr', { class: 'border-b border-slate-100 text-sm hover:bg-slate-50' });
                  
                  const nameCell = el('td', { class: 'p-4 font-semibold text-indigo-600 cursor-pointer hover:underline' }, name);
                  nameCell.onclick = () => openIndividualLedgerPage(name, data.entries);
                  
                  row.appendChild(nameCell);
                  row.appendChild(el('td', { class: 'p-4 text-right font-bold text-red-600' }, `-₹${data.total.toFixed(2)}`));
                  tbody.appendChild(row);
              });
      };

      window.filterLedgerSummary = (term) => window.renderSummaryRows(term);

      // Initial render
      window.renderSummaryRows();

  } catch (err) {
      body.innerHTML = `<div class="text-red-500 p-4">Error: ${err.message}</div>`;
  }
}

function openIndividualLedgerPage(personName, entries) {
  const overlay = el('div', { class: 'fixed inset-0 bg-slate-50 z-[110] flex flex-col overflow-hidden' });
  
  const total = entries.reduce((s, e) => s + Number(e.amount), 0);

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm' }, [
      el('div', {}, [
          el('h2', { class: 'text-xl font-bold text-slate-800' }, `${personName} Ledger`),
          el('p', { class: 'text-sm text-slate-500' }, `Total: ₹${total.toFixed(2)} • ${entries.length} transactions`)
      ]),
      el('button', { class: 'px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-sm transition', onclick: () => overlay.remove() }, '← Back to Summary')
  ]);
  overlay.appendChild(header);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-6' });
  
  const tableWrap = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm max-w-6xl mx-auto' });
  const table = el('table', { class: 'w-full text-left' }, [
      el('thead', { class: 'bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200 sticky top-0' }, [
          el('tr', {}, [
              el('th', { class: 'p-4' }, 'Date'), 
              el('th', { class: 'p-4' }, 'Mode'), 
              el('th', { class: 'p-4' }, 'Notes'), 
              el('th', { class: 'p-4 text-right' }, 'Amount')
          ])
      ]),
      el('tbody', {}, entries.map(e => el('tr', { class: 'border-b border-slate-100 text-sm hover:bg-slate-50' }, [
          el('td', { class: 'p-4 text-slate-600 whitespace-nowrap' }, new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })),
          el('td', { class: 'p-4' }, [el('span', { class: 'px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold' }, e.payment_mode.toUpperCase())]),
          el('td', { class: 'p-4 text-slate-500' }, e.notes || '—'),
          el('td', { class: 'p-4 text-right font-bold text-red-600' }, `-₹${Number(e.amount).toFixed(2)}`)
      ])))
  ]);
  
  tableWrap.appendChild(table);
  body.appendChild(tableWrap);
  overlay.appendChild(body);
  document.body.appendChild(overlay);
}
