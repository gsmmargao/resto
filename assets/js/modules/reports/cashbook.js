import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney } from '../../utils.js';
import { state, rangeStart, rangeEnd } from './helpers.js';

export async function renderCashbookDetailed() {
  const wrapper = el('div', { class: 'w-full space-y-6' });
  const outletId = store.state.outlet.id;
  const fromDate = state.startDate;
  const toDate = state.endDate;

  try {
    const { data: payments } = await supabase.from('payments')
      .select('amount, tip_amount, mode, paid_at, reference_no')
      .eq('outlet_id', outletId)
      .gte('paid_at', rangeStart().toISOString())
      .lte('paid_at', rangeEnd().toISOString())
      .eq('status', 'success')
      .in('mode', ['cash', 'upi', 'card']);

    const { data: expenses } = await supabase.from('expenses')
      .select('*')
      .eq('outlet_id', outletId)
      .gte('created_at', rangeStart().toISOString())
      .lte('created_at', rangeEnd().toISOString());

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledger = [];

    (payments || []).forEach(p => {
      const amt = Number(p.amount || 0);
      const tip = Number(p.tip_amount || 0);
      
      if (p.mode === 'cash') cashIn += (amt + tip);
      if (p.mode === 'upi' || p.mode === 'card') upiIn += (amt + tip);
      
      if (amt > 0) {
        const isDues = p.reference_no && (p.reference_no.toLowerCase().includes('settle') || p.reference_no.toLowerCase().includes('credit'));
        ledger.push({ 
            time: p.paid_at, 
            type: isDues ? 'Dues Paid' : 'Sales', 
            desc: isDues ? `Dues Settlement` : `Bill Payment`, 
            mode: p.mode.toUpperCase(), 
            in: amt, 
            out: 0 
        });
      }
    });

    (expenses || []).forEach(e => {
        const amt = Number(e.amount);
        if (e.payment_mode === 'cash') cashOut += amt;
        if (e.payment_mode === 'upi' || e.payment_mode === 'card') upiOut += amt;
        ledger.push({
            time: e.created_at,
            type: 'Expense',
            desc: `${e.category} ${e.staff_name ? '(' + e.staff_name + ')' : ''} ${e.custom_category ? '- ' + e.custom_category : ''}`,
            mode: e.payment_mode.toUpperCase(),
            in: 0,
            out: amt
        });
    });

    ledger.sort((a,b) => new Date(b.time) - new Date(a.time));

    // --- LEDGER & PAGINATION SETUP ---
    let currentPage = 1;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(ledger.length / pageSize));

    const ledgerCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6' });
    ledgerCard.innerHTML = `
      <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
        <h3 class="font-bold text-slate-800 text-sm">Cash & UPI / Card Ledger</h3>
      </div>
      <table class="w-full">
        <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
          <tr>
            <th class="px-4 py-3 text-left">When</th>
            <th class="px-4 py-3 text-left">Type</th>
            <th class="px-4 py-3 text-left">Reference</th>
            <th class="px-4 py-3 text-center">Mode</th>
            <th class="px-4 py-3 text-right">In (₹)</th>
            <th class="px-4 py-3 text-right">Out (₹)</th>
          </tr>
        </thead>
        <tbody id="ledger-tbody"></tbody>
      </table>
      <div class="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center" id="pagination-controls"></div>
    `;

    const tbody = ledgerCard.querySelector('#ledger-tbody');
    const paginationControls = ledgerCard.querySelector('#pagination-controls');

    const updateTable = (page) => {
        currentPage = page;
        const start = (currentPage - 1) * pageSize;
        const paginated = ledger.slice(start, start + pageSize);

        tbody.innerHTML = paginated.length === 0 
            ? '<tr><td colspan="6" class="text-center py-6 text-slate-400 text-sm">No transactions</td></tr>' 
            : paginated.map(l => `
                <tr class="border-b border-slate-50 hover:bg-slate-50">
                  <td class="px-4 py-3 text-xs text-slate-500">${new Date(l.time).toLocaleString('en-GB')}</td>
                  <td class="px-4 py-3 text-sm font-medium ${l.type === 'Dues Paid' ? 'text-amber-600' : l.type === 'Expense' ? 'text-red-600' : 'text-slate-700'}">${l.type}</td>
                  <td class="px-4 py-3 text-sm text-slate-600">${l.desc}</td>
                  <td class="px-4 py-3 text-center"><span class="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${l.mode}</span></td>
                  <td class="px-4 py-3 text-right text-emerald-600 font-medium">${l.in > 0 ? '+₹' + l.in.toFixed(2) : '₹0.00'}</td>
                  <td class="px-4 py-3 text-right text-red-600 font-medium">${l.out > 0 ? '-₹' + l.out.toFixed(2) : '₹0.00'}</td>
                </tr>
            `).join('');

        const prevDisabled = currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200 cursor-pointer';
        const nextDisabled = currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200 cursor-pointer';

        paginationControls.innerHTML = `
            <span class="text-xs text-slate-500">Showing ${ledger.length === 0 ? 0 : start + 1} to ${Math.min(start + pageSize, ledger.length)} of ${ledger.length} entries</span>
            <div class="flex items-center gap-2">
                <button id="btn-prev" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 ${prevDisabled} transition">Prev</button>
                <span class="text-xs font-bold text-slate-700">Page ${currentPage} of ${totalPages}</span>
                <button id="btn-next" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 ${nextDisabled} transition">Next</button>
            </div>
        `;

        if (currentPage > 1) {
            paginationControls.querySelector('#btn-prev').onclick = () => updateTable(currentPage - 1);
        }
        if (currentPage < totalPages) {
            paginationControls.querySelector('#btn-next').onclick = () => updateTable(currentPage + 1);
        }
    };

    updateTable(1); // Initialize first page

    wrapper.appendChild(ledgerCard);

    // --- SUMMARY SECTION ---
    const summaryCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden' });
    summaryCard.innerHTML = `
      <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
        <h3 class="font-bold text-slate-800 text-sm">Summary by payment mode</h3>
      </div>
      <table class="w-full">
        <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
          <tr>
            <th class="px-4 py-3 text-left">Mode</th>
            <th class="px-4 py-3 text-right">Total In</th>
            <th class="px-4 py-3 text-right">Total Out</th>
            <th class="px-4 py-3 text-right">Net Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-slate-50">
            <td class="px-4 py-3 font-bold text-slate-700">Cash</td>
            <td class="px-4 py-3 text-right text-emerald-600 font-medium">₹${cashIn.toFixed(2)}</td>
            <td class="px-4 py-3 text-right text-red-600 font-medium">₹${cashOut.toFixed(2)}</td>
            <td class="px-4 py-3 text-right font-bold text-slate-800">₹${(cashIn - cashOut).toFixed(2)}</td>
          </tr>
          <tr class="border-b border-slate-50">
            <td class="px-4 py-3 font-bold text-slate-700">UPI / Card</td>
            <td class="px-4 py-3 text-right text-emerald-600 font-medium">₹${upiIn.toFixed(2)}</td>
            <td class="px-4 py-3 text-right text-red-600 font-medium">₹${upiOut.toFixed(2)}</td>
            <td class="px-4 py-3 text-right font-bold text-slate-800">₹${(upiIn - upiOut).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    `;

    wrapper.appendChild(summaryCard);

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading cashbook: ${err.message}</div>`;
  }

  return wrapper;
}
