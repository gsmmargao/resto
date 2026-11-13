import { openPersonLedgerModal } from "./modals.js";
import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney } from '../../utils.js';
import { state, rangeStart, rangeEnd } from './helpers.js';

export async function renderCashbookDetailed() {
  const wrapper = el('div', { class: 'w-full space-y-6' });
  const outletId = store.state.outlet.id;

  try {
    // 1. Fetch ALL Data (No date filters in DB query)
    const [payRes, expRes, cashRes, supRes, quickRes, tipRes] = await Promise.all([
      supabase.from('payments')
        .select('amount, tip_amount, mode, paid_at, reference_no')
        .eq('outlet_id', outletId)
        .eq('status', 'success')
        .in('mode', ['cash', 'upi', 'card']),
      supabase.from('expenses').select('*').eq('outlet_id', outletId),
      supabase.from('cash_movements')
        .select('person_name, movement_type, amount, created_at, reason')
        .eq('outlet_id', outletId),
      supabase.from('supplier_payments').select('*').eq('tenant_id', store.state.tenant.id),
      supabase.from('purchases').select('*').eq('tenant_id', store.state.tenant.id),
      supabase.from('tip_payouts').select('*').eq('outlet_id', outletId)
    ]);

    if (payRes.error) throw payRes.error;
    if (expRes.error) throw expRes.error;
    if (cashRes.error) throw cashRes.error;
    if (supRes.error) throw supRes.error;
    if (quickRes.error) throw quickRes.error;
    if (tipRes.error) throw tipRes.error;

    const payments = payRes.data || [];
    const expenses = expRes.data || [];
    const cashMovements = cashRes.data || [];
    const supplierPayments = supRes.data || [];
    const quickPurchases = quickRes.data || [];
    const tipPayouts = tipRes.data || [];

    const rStart = rangeStart().getTime();
    const rEnd = rangeEnd().getTime();

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledger = [];
    const personMap = new Map();

    // 2. Process Payments
    payments.forEach(p => {
      const amt = Number(p.amount || 0);
      const tip = Number(p.tip_amount || 0);
      const baseAmt = Math.max(0, amt - tip);
      
      if (p.mode === 'cash') cashIn += (baseAmt + tip);
      if (p.mode === 'upi' || p.mode === 'card') upiIn += (baseAmt + tip);
      
      const pTime = new Date(p.paid_at).getTime();
      if (pTime >= rStart && pTime <= rEnd) {
        const isDues = p.reference_no && (p.reference_no.toLowerCase().includes('settle') || p.reference_no.toLowerCase().includes('credit'));
        ledger.push({ time: p.paid_at, type: isDues ? 'Dues Paid' : 'Sales', desc: isDues ? `Dues Settlement` : `Bill Payment`, mode: p.mode.toUpperCase(), in: isDues ? amt : baseAmt, out: 0 });
        if (tip > 0) ledger.push({ time: p.paid_at, type: 'Sales', desc: 'Digital Tip', mode: p.mode.toUpperCase(), in: tip, out: 0 });
      }
    });

    // 3. Process Expenses
    expenses.forEach(e => {
      const amt = Number(e.amount || 0);
      if (e.payment_mode === 'cash') cashOut += amt;
      if (e.payment_mode === 'upi' || e.payment_mode === 'card') upiOut += amt;
      
      const eTime = new Date(e.created_at).getTime();
      if (eTime >= rStart && eTime <= rEnd) {
        ledger.push({ time: e.created_at, type: 'Expense', desc: e.staff_name || e.custom_category || e.category || e.reason || 'Expense', mode: e.payment_mode.toUpperCase(), in: 0, out: amt });
      }
    });

    // 4. Process Supplier Payments
    (supplierPayments || []).forEach(sp => {
      const amt = Number(sp.amount || 0);
      const mode = String(sp.payment_mode || '').toLowerCase();
      const time = new Date(sp.created_at).getTime();
      if (mode === 'cash') cashOut += amt;
      if (mode === 'upi' || mode === 'card') upiOut += amt;
      if (time >= rStart && time <= rEnd) {
        ledger.push({ time: sp.created_at, type: 'Expense', desc: sp.notes || 'Paid to supplier', mode: mode.toUpperCase(), in: 0, out: amt });
      }
    });

    // 5. Process Quick Purchases
    (quickPurchases || []).forEach(p => {
      const amt = Number(p.total || 0);
      const mode = String(p.payment_mode || '').toLowerCase();
      const time = new Date(p.created_at).getTime();
      if (mode === 'cash') cashOut += amt;
      if (mode === 'upi' || mode === 'card') upiOut += amt;
      if (time >= rStart && time <= rEnd) {
        ledger.push({ time: p.created_at, type: 'Purchase', desc: 'Quick Purchase', mode: mode.toUpperCase(), in: 0, out: amt });
      }
    });

    // 6. Process Cash Movements (Person Ledger only)
    cashMovements.forEach(m => {
      const amt = Number(m.amount || 0);
      if (m.movement_type === 'tip_payout' || (m.reason && m.reason.toLowerCase().includes('tip payout'))) {
        return; // Skip here, we will process from tip_payouts table
      }
      if (!m.person_name) return;
      const name = m.person_name.trim();
      if (!personMap.has(name)) personMap.set(name, 0);
      if (m.movement_type === 'cash_out') personMap.set(name, personMap.get(name) + amt);
      else if (m.movement_type === 'cash_in') personMap.set(name, personMap.get(name) - amt);
    });

    // 7. Process Tip Payouts directly
    (tipPayouts || []).forEach(t => {
      if (t.payment_mode !== 'cash') return;
      const amt = Number(t.amount || 0);
      cashOut += amt;
      const pTime = t.created_at ? new Date(t.created_at).getTime() : Date.now();
      if (pTime >= rStart && pTime <= rEnd) {
        ledger.push({ time: t.created_at || new Date().toISOString(), type: 'Expense', desc: `Tip Payout: ${t.staff_name || 'Staff'}`, mode: 'CASH', in: 0, out: amt });
      }
    });

    const personLedger = Array.from(personMap.entries())
      .filter(([name, balance]) => balance !== 0)
      .sort((a,b) => b[1] - a[1]);

    ledger.sort((a,b) => new Date(b.time) - new Date(a.time));

    // RENDER UI
    wrapper.innerHTML = `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Cash Ledger (In & Out)</h3>
            <span class="text-xs font-semibold text-slate-500">${ledger.length} entries</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th class="px-4 py-3">When</th>
                <th class="px-4 py-3">Type</th>
                <th class="px-4 py-3">Reference</th>
                <th class="px-4 py-3 text-center">Mode</th>
                <th class="px-4 py-3 text-right">In (₹)</th>
                <th class="px-4 py-3 text-right">Out (₹)</th>
              </tr>
            </thead>
            <tbody id="ledger-tbody"></tbody>
          </table>
        </div>
        <div class="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center" id="pagination-controls"></div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
          <h3 class="font-bold text-slate-800 text-sm">Summary by payment mode (All-Time)</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th class="px-4 py-3">Mode</th>
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
              <tr class="bg-slate-100 border-t-2 border-slate-300">
                <td class="px-4 py-3 font-black text-slate-900 uppercase">Total (Cash + UPI)</td>
                <td class="px-4 py-3 text-right text-emerald-700 font-bold">₹${(cashIn + upiIn).toFixed(2)}</td>
                <td class="px-4 py-3 text-right text-red-700 font-bold">₹${(cashOut + upiOut).toFixed(2)}</td>
                <td class="px-4 py-3 text-right font-black text-indigo-800">₹${((cashIn - cashOut) + (upiIn - upiOut)).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      ${personLedger.length > 0 ? `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
          <h3 class="font-bold text-slate-800 text-sm">Cash Held by Person (All-Time)</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th class="px-4 py-3">Person Name</th>
                <th class="px-4 py-3 text-right">Amount Held</th>
              </tr>
            </thead>
            <tbody>
              ${personLedger.map(([name, balance]) => `
                <tr class="border-b border-slate-50 hover:bg-slate-50 cursor-pointer ledger-row" data-name="${name}">
                  <td class="px-4 py-3 font-bold text-indigo-600 underline">${name}</td>
                  <td class="px-4 py-3 text-right font-bold text-indigo-600">₹${balance.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
    `;

    wrapper.querySelectorAll(".ledger-row").forEach(tr => {
        tr.addEventListener("click", () => {
            openPersonLedgerModal(tr.dataset.name, cashMovements);
        });
    });

    // PAGINATION LOGIC
    const cashLedger = ledger.filter(l => String(l.mode || '').trim().toUpperCase().includes('CASH'));
    let currentPage = 1;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(cashLedger.length / pageSize));

    const updateTable = (page) => {
        currentPage = page;
        const start = (currentPage - 1) * pageSize;
        const paginated = cashLedger.slice(start, start + pageSize);

        const tbody = wrapper.querySelector('#ledger-tbody');
        if (!tbody) return;

        tbody.innerHTML = paginated.length === 0 
            ? '<tr><td colspan="6" class="text-center py-6 text-slate-400 text-sm">No transactions in this period</td></tr>' 
            : paginated.map(l => `
                <tr class="border-b border-slate-50 hover:bg-slate-50">
                  <td class="px-4 py-3 text-xs text-slate-500">${l.time ? new Date(l.time).toLocaleString('en-GB') : '—'}</td>
                  <td class="px-4 py-3 text-sm font-medium ${l.type === 'Dues Paid' ? 'text-amber-600' : l.type === 'Expense' ? 'text-red-600' : 'text-slate-700'}">${l.type}</td>
                  <td class="px-4 py-3 text-sm text-slate-600">${l.desc}</td>
                  <td class="px-4 py-3 text-center"><span class="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${l.mode}</span></td>
                  <td class="px-4 py-3 text-right text-emerald-600 font-medium">${Number(l.in || 0) > 0 ? '+₹' + Number(l.in).toFixed(2) : '₹0.00'}</td>
                  <td class="px-4 py-3 text-right text-red-600 font-medium">${Number(l.out || 0) > 0 ? '-₹' + Number(l.out).toFixed(2) : '₹0.00'}</td>
                </tr>
            `).join('');

        const prevDisabled = currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200 cursor-pointer';
        const nextDisabled = currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200 cursor-pointer';

        const paginationControls = wrapper.querySelector('#pagination-controls');
        if (paginationControls) {
            paginationControls.innerHTML = `
                <span class="text-xs text-slate-500">Showing ${cashLedger.length === 0 ? 0 : start + 1} to ${Math.min(start + pageSize, cashLedger.length)} of ${cashLedger.length} entries</span>
                <div class="flex items-center gap-2">
                    <button id="btn-prev" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 ${prevDisabled} transition">Prev</button>
                    <span class="text-xs font-bold text-slate-700">Page ${currentPage} of ${totalPages}</span>
                    <button id="btn-next" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 ${nextDisabled} transition">Next</button>
                </div>
            `;

            if (currentPage > 1) paginationControls.querySelector('#btn-prev').onclick = () => updateTable(currentPage - 1);
            if (currentPage < totalPages) paginationControls.querySelector('#btn-next').onclick = () => updateTable(currentPage + 1);
        }
    };

    updateTable(1);

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading cashbook: ${err.message}</div>`;
  }

  return wrapper;
}
