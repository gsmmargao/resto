import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';
import { openPersonLedgerModal } from './modals.js';

export async function renderCashbookDetailed() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Cashbook...</div>';
  
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) return wrapper;

  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];

  try {
    // Fetch Sales (In)
    const { data: payments } = await supabase.from('payments')
      .select('amount, tip_amount, mode, paid_at')
      .eq('outlet_id', outletId)
      .gte('paid_at', fromDate + 'T00:00:00')
      .lte('paid_at', toDate + 'T23:59:59')
      .eq('status', 'success')
      .in('mode', ['cash', 'upi']);

    // Fetch Supplier Payments (Out)
    const { data: supplierPays } = await supabase.from('supplier_payments')
      .select('*, suppliers(name)')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .in('payment_mode', ['cash', 'upi']);

    // Fetch Cash Movements (Drawer)
    const { data: cashMovements } = await supabase.from('cash_movements')
      .select('*')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    // Fetch Tip Payouts (Out) - This is the missing piece!
    const { data: tipPayouts } = await supabase.from('tip_payouts')
      .select('*')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledger = [];
    const personMap = new Map();

    // 1. Process Sales
    (payments || []).forEach(p => {
      const amt = Number(p.amount || 0);
      const tip = Number(p.tip_amount || 0);
      if (p.mode === 'cash') cashIn += (amt + tip);
      if (p.mode === 'upi') upiIn += (amt + tip);
      
      if (amt > 0) ledger.push({ time: p.paid_at, type: 'sales', desc: `Bill Payment`, mode: p.mode, in: amt, out: 0 });
      if (tip > 0) ledger.push({ time: p.paid_at, type: 'tip', desc: `Tip Collected`, mode: p.mode, in: tip, out: 0 });
    });

    // 2. Process Supplier Payments
    (supplierPays || []).forEach(p => {
      const amt = Number(p.amount);
      if (p.payment_mode === 'cash') cashOut += amt;
      if (p.payment_mode === 'upi') upiOut += amt;
      ledger.push({ time: p.created_at, type: 'payment', desc: `Supplier Payment - ${p.suppliers?.name || 'Supplier'}`, mode: p.payment_mode, in: 0, out: amt });
    });

    // 3. Process Cash Movements (Drawer Withdrawals/Deposits)
    const validCashMovements = (cashMovements || []).filter(m => {
        const typeStr = (m.movement_type || '').toLowerCase();
        // Skip supplier and tip_payout here, because we handle them above
        if (typeStr.includes('tip_payout')) return false; 
        const isSupplier = (m.person_name && m.person_name.toLowerCase() === 'supplier') ||
                           (m.reason && (m.reason.toLowerCase().includes('supplier') || m.reason.toLowerCase().includes('purchase po')));
        return !isSupplier;
    });

    validCashMovements.forEach(p => {
      const amt = Number(p.amount || 0);
      const typeStr = (p.movement_type || '').toLowerCase();
      const isIn = typeStr.includes('in') || typeStr.includes('deposit');
      const isOut = typeStr.includes('out') || typeStr.includes('withdraw');
      
      if (isIn) cashIn += amt;
      if (isOut) cashOut += amt;

      if (p.person_name) {
        if (isOut) personMap.set(p.person_name, (personMap.get(p.person_name) || 0) + amt);
        else if (isIn) personMap.set(p.person_name, (personMap.get(p.person_name) || 0) - amt);
      }
      
      let desc = `Drawer ${isIn ? 'Deposit' : 'Withdrawal'}`;
      if (p.person_name) desc += ` (${p.person_name})`;
      if (p.reason && p.reason !== p.person_name) desc += ` - ${p.reason}`;

      ledger.push({ time: p.created_at, type: 'drawer', desc: desc, mode: 'cash', in: isIn ? amt : 0, out: isOut ? amt : 0 });
    });

    // 4. Process Tip Payouts
    (tipPayouts || []).forEach(t => {
      const amt = Number(t.amount || 0);
      if (t.payment_mode === 'cash') cashOut += amt;
      if (t.payment_mode === 'upi') upiOut += amt;
      
      ledger.push({ 
        time: t.created_at, 
        type: 'tip_payout', 
        desc: `Tip Payout to ${t.staff_name || 'Staff'}`, 
        mode: t.payment_mode, 
        in: 0, 
        out: amt 
      });
    });

    ledger.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    let rowsHtml = '';
    if (ledger.length === 0) {
      rowsHtml = '<tr><td colspan="6" class="text-center py-8 text-slate-400 text-sm">No transactions</td></tr>';
    } else {
      rowsHtml = ledger.map(l => {
        const inStr = l.in > 0 ? `+₹${l.in.toFixed(2)}` : (l.in === 0 ? '₹0.00' : '-');
        const outStr = l.out > 0 ? `-₹${l.out.toFixed(2)}` : (l.out === 0 ? '₹0.00' : '-');
        const modeClass = l.mode.toLowerCase() === 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700';
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(l.time).toLocaleString('en-GB', {dateStyle:'short', timeStyle:'short'})}</td>
            <td class="px-4 py-3 text-sm text-slate-700 capitalize">${l.type.replace('_', ' ')}</td>
            <td class="px-4 py-3 text-sm text-slate-600">${l.desc}</td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded text-[10px] font-bold ${modeClass}">${l.mode.toUpperCase()}</span></td>
            <td class="px-4 py-3 text-sm text-right text-emerald-600 font-medium">${inStr}</td>
            <td class="px-4 py-3 text-sm text-right text-red-600 font-medium">${outStr}</td>
          </tr>
        `;
      }).join('');
    }

    let personRowsHtml = '';
    personMap.forEach((balance, name) => {
      if (balance > 0) {
        personRowsHtml += `
          <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition person-row" data-person="${name}">
            <td class="px-4 py-3 font-bold text-indigo-600 underline">${name}</td>
            <td class="px-4 py-3 text-right font-bold text-indigo-600">₹${balance.toFixed(2)}</td>
          </tr>
        `;
      }
    });
    if (!personRowsHtml) {
      personRowsHtml = '<tr><td colspan="2" class="text-center py-4 text-slate-400 text-sm">No cash currently held by staff</td></tr>';
    }

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
            <h3 class="font-bold text-slate-800 text-sm">Cash & UPI Ledger</h3>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th class="text-left px-4 py-3 font-semibold">When</th>
                <th class="text-left px-4 py-3 font-semibold">Type</th>
                <th class="text-left px-4 py-3 font-semibold">Reference</th>
                <th class="text-center px-4 py-3 font-semibold">Mode</th>
                <th class="text-right px-4 py-3 font-semibold">In (₹)</th>
                <th class="text-right px-4 py-3 font-semibold">Out (₹)</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
            <h3 class="font-bold text-slate-800 text-sm">Summary by payment mode</h3>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th class="text-left px-4 py-3 font-semibold">Mode</th>
                <th class="text-right px-4 py-3 font-semibold">Total In</th>
                <th class="text-right px-4 py-3 font-semibold">Total Out</th>
                <th class="text-right px-4 py-3 font-semibold">Net Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-slate-100">
                <td class="px-4 py-3 font-bold text-slate-700">Cash</td>
                <td class="px-4 py-3 text-right text-emerald-600 font-medium">₹${cashIn.toFixed(2)}</td>
                <td class="px-4 py-3 text-right text-red-600 font-medium">₹${cashOut.toFixed(2)}</td>
                <td class="px-4 py-3 text-right font-bold text-slate-800">₹${(cashIn - cashOut).toFixed(2)}</td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-bold text-slate-700">UPI</td>
                <td class="px-4 py-3 text-right text-emerald-600 font-medium">₹${upiIn.toFixed(2)}</td>
                <td class="px-4 py-3 text-right text-red-600 font-medium">₹${upiOut.toFixed(2)}</td>
                <td class="px-4 py-3 text-right font-bold text-slate-800">₹${(upiIn - upiOut).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-indigo-50 border-b border-indigo-100">
            <h3 class="font-bold text-indigo-800 text-sm">Cash Held by Person (Drawer Withdrawals)</h3>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th class="text-left px-4 py-3 font-semibold">Person Name</th>
                <th class="text-right px-4 py-3 font-semibold">Amount Held</th>
              </tr>
            </thead>
            <tbody>${personRowsHtml}</tbody>
          </table>
        </div>

      </div>
    `;

    wrapper.querySelectorAll('.person-row').forEach(row => {
      row.onclick = () => {
        const pName = row.getAttribute('data-person');
        const pMovements = validCashMovements.filter(m => m.person_name === pName);
        openPersonLedgerModal(pName, pMovements);
      };
    });

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading cashbook: ${err.message}</div>`;
  }
  return wrapper;
}

