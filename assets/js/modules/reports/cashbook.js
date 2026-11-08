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
    const [payRes, expRes, cashRes, supRes, quickRes] = await Promise.all([
      supabase.from('payments')
        .select('amount, tip_amount, mode, paid_at, reference_no')
        .eq('outlet_id', outletId)
        .eq('status', 'success')
        .in('mode', ['cash', 'upi', 'card']),
      supabase.from('expenses')
        .select('*')
        .eq('outlet_id', outletId),
      supabase.from('cash_movements')
        .select('person_name, movement_type, amount, created_at, reason')
        .eq('outlet_id', outletId)
        .not('person_name', 'is', null),
      supabase.from('supplier_payments').select('*').eq('tenant_id', store.state.tenant.id),
      supabase.from('purchases').select('*').eq('tenant_id', store.state.tenant.id)
    ]);

    if (payRes.error) throw payRes.error;
    if (expRes.error) throw expRes.error;
    if (cashRes.error) throw cashRes.error;
    if (supRes.error) throw supRes.error;
    if (quickRes.error) throw quickRes.error;

    const payments = payRes.data || [];
    const expenses = expRes.data || [];
    const cashMovements = cashRes.data || [];
    const supplierPayments = supRes.data || [];
    const quickPurchases = quickRes.data || [];

    const rStart = rangeStart().getTime();
    const rEnd = rangeEnd().getTime();

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledger = [];
    const personMap = new Map();

    // 2. Process Payments (All-Time for Summary, Date-Filtered for Ledger)
    payments.forEach(p => {
      const amt = Number(p.amount || 0);
      const tip = Number(p.tip_amount || 0);
      const baseAmt = Math.max(0, amt - tip); // FIX: Calculate actual base bill amount
      
      // Summary Totals (All Time)
      if (p.mode === 'cash') cashIn += (baseAmt + tip);
      if (p.mode === 'upi' || p.mode === 'card') upiIn += (baseAmt + tip);
      
      // Ledger List (Date Filtered)
      const pTime = new Date(p.paid_at).getTime();
      if (baseAmt > 0 && pTime >= rStart && pTime <= rEnd) {
        const isDues = p.reference_no && (p.reference_no.toLowerCase().includes('settle') || p.reference_no.toLowerCase().includes('credit'));
        ledger.push({ 
            time: p.paid_at, 
            type: isDues ? 'Dues Paid' : 'Sales', 
            desc: isDues ? `Dues Settlement` : `Bill Payment`, 
            mode: p.mode.toUpperCase(), 
            in: isDues ? amt : baseAmt, 
            out: 0 
        });
        if (tip > 0) {
            ledger.push({ 
                time: p.paid_at, 
                type: 'Sales', 
                desc: 'Digital Tip', 
                mode: p.mode.toUpperCase(), 
                in: tip, 
                out: 0 
            });
        }
      }
    });

    
    // 2b. Process All Outflows (Supplier Payments, Purchases, Expenses)
    const processOutflow = (amt, mode, time, type, desc) => {
        const safeMode = String(mode || '').trim().toLowerCase();
        
        // STRICT ALLOW-LIST: Only process if it is EXACTLY cash, upi, or card.
        if (!['cash', 'upi', 'card'].includes(safeMode)) return;
        
        const safeAmt = Number(amt || 0);
        
        // Summary Totals (All Time)
        if (safeMode === 'cash') cashOut += safeAmt;
        if (safeMode === 'upi' || safeMode === 'card') upiOut += safeAmt;
        
        // Ledger List (Date Filtered)
        if (time >= rStart && time <= rEnd) {
            ledger.push({
                time: time,
                type: type,
                desc: desc,
                mode: safeMode.toUpperCase(),
                in: 0,
                out: safeAmt
            });
        }
    };

    // A. Supplier Payments (Handles manual payments AND auto-payments for POs)
    (supplierPayments || []).forEach(sp => {
        processOutflow(sp.amount, sp.payment_mode || sp.mode, new Date(sp.created_at).getTime(), 'Expense', sp.notes || 'Paid to supplier');
    });

    // B. Quick Purchases (ONLY if paid. Credit purchases must be ignored)
    (quickPurchases || []).forEach(p => {
        if (p.status === 'pending' || p.payment_status === 'credit') return; // Skip credit
        processOutflow(p.total, p.payment_mode, new Date(p.created_at).getTime(), 'Purchase', 'Quick Purchase');
    });

    // C. Purchase Orders: DO NOT PROCESS HERE! 
    // If a PO is paid, it is already processed via 'supplier_payments' above.
    // If a PO is credit, it should not affect the cashbook.

    // D. General Expenses
    (expenses || []).forEach(e => {
        let desc = `${e.category || ''} ${e.staff_name ? '(' + e.staff_name + ')' : ''} ${e.custom_category ? '- ' + e.custom_category : ''}`.trim();
        if (!desc) desc = e.notes || 'Expense';
        processOutflow(e.amount, e.payment_mode, new Date(e.created_at).getTime(), 'Expense', desc);
    });

    // 4. Process Cash Movements (All-Time for Person Ledger)
    cashMovements.forEach(m => {
        if (!m.person_name) return;
        const name = m.person_name.trim();
        if (!personMap.has(name)) personMap.set(name, 0);
        
        if (m.movement_type === 'cash_out') {
            personMap.set(name, personMap.get(name) + Number(m.amount));
        } else if (m.movement_type === 'cash_in') {
            personMap.set(name, personMap.get(name) - Number(m.amount));
        }
    });
    
    const personLedger = Array.from(personMap.entries())
        .filter(([name, balance]) => balance !== 0)
        .sort((a,b) => b[1] - a[1]);

    ledger.sort((a,b) => new Date(b.time) - new Date(a.time));

    // --- RENDER UI ---
    wrapper.innerHTML = `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Cash Ledger (In & Out)</h3>
            <span class="text-xs font-semibold text-slate-500">${ledger.filter(l => String(l.mode || "").toUpperCase().includes("CASH")).length} entries</span>
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

    // Attach safe click listeners for Person Ledger
    wrapper.querySelectorAll(".ledger-row").forEach(tr => {
        tr.addEventListener("click", () => {
            window.openPersonLedger(tr.dataset.name, personLedger, cashMovements);
        });
    });

    // --- PAGINATION LOGIC ---
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
        }
    };

    updateTable(1);

    // Global function for opening the person ledger
    window.openPersonLedger = (personName, personLedger, cashMovements) => {
        // Strictly filter movements for THIS person only
        const movements = cashMovements.filter(m => m.person_name && m.person_name.trim().toLowerCase() === personName.trim().toLowerCase());
        
        // Calculate total held mathematically from the actual movements
        let calculatedTotal = 0;
        movements.forEach(m => {
            if (m.movement_type === 'cash_out') calculatedTotal += Number(m.amount || 0);
            if (m.movement_type === 'cash_in') calculatedTotal -= Number(m.amount || 0);
        });

        const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
        // Increased max-w to 2xl for a wider ledger view
        const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[85vh] flex flex-col' });
        
        card.appendChild(el('div', { class: 'flex justify-between items-center border-b pb-3 shrink-0' }, [
            el('div', {}, [
                el('h3', { class: 'font-bold text-lg text-slate-800' }, `${personName}'s Cash Ledger`),
                el('div', { class: 'text-sm text-slate-500 mt-1' }, 'Total Cash Held: ', el('span', { class: 'font-bold text-indigo-600 text-lg ml-1' }, fmtMoney(calculatedTotal)))
            ]),
            el('button', { class: 'text-slate-400 hover:text-slate-800 text-2xl leading-none', onclick: () => overlay.remove() }, '×')
        ]));

        const tableWrap = el('div', { class: 'overflow-y-auto flex-1 border rounded-lg' });
        const table = el('table', { class: 'w-full text-left' }, [
            el('thead', { class: 'bg-slate-100 text-[10px] uppercase text-slate-600 sticky top-0 shadow-sm' }, [
                el('tr', {}, [
                    el('th', { class: 'p-3 w-32' }, 'Date'),
                    el('th', { class: 'p-3' }, 'Reason'),
                    el('th', { class: 'p-3 text-right text-red-600 w-32' }, 'Debit (Cash Taken)'),
                    el('th', { class: 'p-3 text-right text-emerald-600 w-32' }, 'Credit (Returned)')
                ])
            ]),
            el('tbody', {}, movements.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(m => {
                const isOut = m.movement_type === 'cash_out';
                const dateStr = new Date(m.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
                const amountStr = Number(m.amount || 0).toFixed(2);
                
                return el('tr', { class: 'border-b border-slate-100 text-sm hover:bg-slate-50' }, [
                    el('td', { class: 'p-3 text-slate-600 whitespace-nowrap' }, dateStr),
                    el('td', { class: 'p-3 text-slate-700' }, m.reason || '—'),
                    el('td', { class: 'p-3 text-right font-bold text-red-600' }, isOut ? `₹${amountStr}` : ''),
                    el('td', { class: 'p-3 text-right font-bold text-emerald-600' }, !isOut ? `₹${amountStr}` : '')
                ]);
            })),
            el('tfoot', { class: 'bg-slate-50 border-t-2 border-slate-300' }, [
                el('tr', {}, [
                    el('td', { colspan: 2, class: 'p-3 font-bold text-slate-800 text-right' }, 'Net Balance:'),
                    el('td', { colspan: 2, class: 'p-3 font-black text-indigo-700 text-right text-lg' }, fmtMoney(calculatedTotal))
                ])
            ])
        ]);
        
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);
        card.appendChild(el('button', { class: 'w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium mt-2 shrink-0', onclick: () => overlay.remove() }, 'Close'));
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    };;;

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading cashbook: ${err.message}</div>`;
  }
  return wrapper;
}
