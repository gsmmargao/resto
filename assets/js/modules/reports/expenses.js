import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, rangeStart, rangeEnd } from './helpers.js';

export async function renderExpenses() {
  const wrapper = el('div', { class: 'w-full space-y-6' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Expense Book...</div>';
  
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

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
          <button id="btn-general-ledger" class="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition shadow-sm text-sm">General Ledger</button>
          <button id="btn-staff-ledger" class="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition shadow-sm text-sm">Staff Ledger</button>
          <button id="btn-add-expense" class="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm text-sm">+ Add Expense</button>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 class="font-bold text-slate-800 text-sm">Expense Details</h3>
          <span class="text-xs font-semibold text-slate-500">${expenses ? expenses.length : 0} entries</span>
        </div>
        <table class="w-full text-left">
          <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
            <tr>
              <th class="px-5 py-3">Date</th>
              <th class="px-5 py-3">Category / Name</th>
              <th class="px-5 py-3">Notes</th>
              <th class="px-5 py-3 text-center">Mode</th>
              <th class="px-5 py-3 text-center">Type</th>
              <th class="px-5 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${(!expenses || expenses.length === 0) ? '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">No expenses in this period.</td></tr>' : 
              expenses.map(e => `
                <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                  <td class="px-5 py-3 text-sm text-slate-600">${new Date(e.created_at).toLocaleDateString('en-GB')}</td>
                  <td class="px-5 py-3 text-sm font-semibold text-slate-800">
                    <button class="text-indigo-600 hover:underline category-link" data-category="${e.category}">${e.category}</button>
                    ${e.staff_name ? `<button class="text-amber-600 hover:underline ml-1 staff-link" data-staff="${e.staff_name}">(${e.staff_name})</button>` : ''}
                  </td>
                  <td class="px-5 py-3 text-sm text-slate-500">${e.custom_category ? e.custom_category + ' - ' : ''}${e.notes || '—'}</td>
                  <td class="px-5 py-3 text-center"><span class="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${e.payment_mode.toUpperCase()}</span></td>
                  <td class="px-5 py-3 text-center">
                      <span class="px-2 py-1 ${e.expense_type === 'recurring' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'} rounded text-[10px] font-bold uppercase">${e.expense_type || 'general'}</span>
                  </td>
                  <td class="px-5 py-3 text-sm font-bold text-red-600 text-right">-₹${Number(e.amount).toFixed(2)}</td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>
    `;

    // Attach Event Listeners
    wrapper.querySelector('#btn-add-expense').onclick = () => openAddExpenseModal(() => renderExpenses().then(html => wrapper.replaceWith(html)));
    wrapper.querySelector('#btn-staff-ledger').onclick = () => openStaffLedgerModal(expenses || []);
    wrapper.querySelector('#btn-general-ledger').onclick = () => openCategoryDetailModal('General', expenses.filter(e => e.expense_type === 'general' || !e.expense_type), true);
    
    // Make categories and staff names in the main table clickable
    wrapper.querySelectorAll('.category-link').forEach(btn => {
        btn.onclick = () => openCategoryDetailModal(btn.dataset.category, expenses.filter(e => e.category === btn.dataset.category));
    });
    wrapper.querySelectorAll('.staff-link').forEach(btn => {
        btn.onclick = () => openCategoryDetailModal('Staff: ' + btn.dataset.staff, expenses.filter(e => e.staff_name === btn.dataset.staff));
    });

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading expenses: ${err.message}</div>`;
  }

  return wrapper;
}

async function openAddExpenseModal(onSuccess) {
  const { data: staff } = await supabase.from('tenant_members').select('*').eq('tenant_id', store.state.tenant.id);
  
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Add Expense'));

  const typeIn = el('select', { class: 'w-full p-2 border border-slate-300 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50' }, [
    el('option', { value: 'general' }, 'General Expense'),
    el('option', { value: 'recurring' }, 'Recurring Expense (Rent, Electricity)')
  ]);

  const categoryIn = el('select', { class: 'w-full p-2 border border-slate-300 rounded-lg text-sm mt-2' }, [
    el('option', { value: 'Rent' }, 'Rent'),
    el('option', { value: 'Room Rent' }, 'Room Rent'),
    el('option', { value: 'Electricity' }, 'Electricity'),
    el('option', { value: 'Waterbill' }, 'Waterbill'),
    el('option', { value: 'Staff Salary' }, 'Staff Salary'),
    el('option', { value: 'Others' }, 'Others')
  ]);

  const customCatIn = el('input', { type: 'text', placeholder: 'Specify details (e.g. Mop, liquid)', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm hidden mt-2' });
  
  const staffIn = el('input', { 
    type: 'text', placeholder: 'Enter Staff Name', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm hidden mt-2',
    list: 'staff_names_datalist', autocomplete: 'off'
  });
  
  const staffDatalist = document.createElement('datalist');
  staffDatalist.id = 'staff_names_datalist';
  (staff || []).forEach(s => {
      const name = s.name || s.full_name || s.email;
      if (name) {
          const opt = document.createElement('option');
          opt.value = name;
          staffDatalist.appendChild(opt);
      }
  });

  categoryIn.onchange = (e) => {
    if (e.target.value === 'Others') customCatIn.classList.remove('hidden');
    else customCatIn.classList.add('hidden');

    if (e.target.value === 'Staff Salary') staffIn.classList.remove('hidden');
    else staffIn.classList.add('hidden');
  };

  const amountIn = el('input', { type: 'number', step: '0.01', placeholder: 'Amount (₹)', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm' });
  
  const modeIn = el('select', { class: 'w-full p-2 border border-slate-300 rounded-lg text-sm' }, [
    el('option', { value: 'cash' }, 'Cash'),
    el('option', { value: 'upi' }, 'UPI')
  ]);

  const notesIn = el('input', { type: 'text', placeholder: 'Notes / Reference', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm' });

  const saveBtn = el('button', { class: 'w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm mt-2' }, 'Save Expense');
  saveBtn.onclick = async () => {
    const amt = Number(amountIn.value);
    if (!amt || amt <= 0) return toast('Enter a valid amount', 'warn');
    
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

    try {
      await supabase.from('expenses').insert({
        tenant_id: store.state.tenant.id,
        outlet_id: store.state.outlet.id,
        expense_type: typeIn.value,
        category: categoryIn.value,
        custom_category: categoryIn.value === 'Others' ? customCatIn.value : null,
        amount: amt,
        payment_mode: modeIn.value,
        notes: notesIn.value,
        staff_id: null,
        staff_name: categoryIn.value === 'Staff Salary' ? staffIn.value.trim() : null,
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

  card.append(typeIn, categoryIn, customCatIn, staffIn, staffDatalist, amountIn, modeIn, notesIn, saveBtn);
  card.appendChild(el('button', { class: 'w-full py-2 text-slate-500 text-sm', onclick: () => overlay.remove() }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function openStaffLedgerModal(expenses) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800 mb-4' }, 'Staff Salary Summary'));

  const salaryExpenses = expenses.filter(e => e.category === 'Staff Salary' && e.staff_name);
  
  if (salaryExpenses.length === 0) {
    card.appendChild(el('div', { class: 'text-center py-8 text-slate-400 text-sm' }, 'No staff salary payments found in this period.'));
  } else {
    const grouped = {};
    salaryExpenses.forEach(e => {
      if (!grouped[e.staff_name]) grouped[e.staff_name] = { total: 0, entries: [] };
      grouped[e.staff_name].total += Number(e.amount);
      grouped[e.staff_name].entries.push(e);
    });

    const table = el('table', { class: 'w-full text-left' }, [
      el('thead', { class: 'bg-slate-50 text-[10px] uppercase text-slate-500' }, [
        el('tr', {}, [
          el('th', { class: 'p-3' }, 'Staff Name'), el('th', { class: 'p-3 text-right' }, 'Total Paid'), el('th', { class: 'p-3 text-center' }, 'Action')
        ])
      ]),
      el('tbody', {}, Object.entries(grouped).map(([name, data]) => el('tr', { class: 'border-b border-slate-100 text-sm' }, [
        el('td', { class: 'p-3 font-semibold text-slate-800' }, name),
        el('td', { class: 'p-3 text-right font-bold text-red-600' }, `-₹${data.total.toFixed(2)}`),
        el('td', { class: 'p-3 text-center' }, [
            el('button', { class: 'px-3 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-bold hover:bg-indigo-100 transition', onclick: () => { overlay.remove(); openCategoryDetailModal('Staff: ' + name, data.entries); } }, 'View Ledger')
        ])
      ])))
    ]);
    card.appendChild(table);
  }

  card.appendChild(el('button', { class: 'w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium mt-4', onclick: () => overlay.remove() }, 'Close'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function openCategoryDetailModal(title, filteredExpenses, isGeneral = false) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto' });

  card.appendChild(el('div', { class: 'flex justify-between items-center mb-4 border-b pb-3' }, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, `${title} Ledger`),
      el('button', { class: 'text-slate-400 hover:text-slate-800 text-2xl leading-none', onclick: () => overlay.remove() }, '×')
  ]));
  
  if (!filteredExpenses || filteredExpenses.length === 0) {
    card.appendChild(el('div', { class: 'text-center py-8 text-slate-400 text-sm' }, 'No entries found.'));
  } else {
    const sorted = [...filteredExpenses].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const total = sorted.reduce((s, e) => s + Number(e.amount), 0);

    const table = el('table', { class: 'w-full text-left' }, [
      el('thead', { class: 'bg-slate-50 text-[10px] uppercase text-slate-500 border-b' }, [
        el('tr', {}, [
          el('th', { class: 'p-3' }, 'Date'), 
          el('th', { class: 'p-3' }, 'Category'),
          el('th', { class: 'p-3' }, 'Mode'), 
          el('th', { class: 'p-3' }, 'Notes'), 
          el('th', { class: 'p-3 text-right' }, 'Amount')
        ])
      ]),
      el('tbody', {}, sorted.map(e => el('tr', { class: 'border-b border-slate-100 text-sm hover:bg-slate-50' }, [
        el('td', { class: 'p-3 text-slate-600' }, new Date(e.created_at).toLocaleDateString('en-GB')),
        el('td', { class: 'p-3 font-semibold' }, e.category + (e.staff_name ? ' (' + e.staff_name + ')' : '')),
        el('td', { class: 'p-3' }, [el('span', { class: 'px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold' }, e.payment_mode.toUpperCase())]),
        el('td', { class: 'p-3 text-slate-500' }, e.custom_category ? e.custom_category + ' - ' + e.notes : (e.notes || '—')),
        el('td', { class: 'p-3 text-right font-bold text-red-600' }, `-₹${Number(e.amount).toFixed(2)}`)
      ]))),
      el('tfoot', { class: 'bg-slate-50 border-t' }, [
          el('tr', {}, [
              el('td', { class: 'p-3 font-bold text-slate-700', colspan: 4 }, 'Total'),
              el('td', { class: 'p-3 text-right font-bold text-red-600' }, `-₹${total.toFixed(2)}`)
          ])
      ])
    ]);
    card.appendChild(table);
  }

  card.appendChild(el('button', { class: 'w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium mt-4', onclick: () => overlay.remove() }, 'Close'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
