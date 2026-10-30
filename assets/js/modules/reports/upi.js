import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';

export async function renderUPI() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading UPI Book...</div>';
  
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) return wrapper;

  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];

  try {
    // 1. Fetch Digital Sales (UPI/Card)
    const { data: payments } = await supabase.from('payments')
      .select('amount, tip_amount, mode, paid_at')
      .eq('outlet_id', outletId)
      .in('mode', ['upi', 'card'])
      .eq('status', 'success')
      .gte('paid_at', fromDate + 'T00:00:00')
      .lte('paid_at', toDate + 'T23:59:59');

    // 2. Fetch Digital Purchases (UPI/Card)
    const { data: periodQuick } = await supabase.from('purchases')
      .select('total, created_at')
      .eq('tenant_id', tenantId)
      .in('payment_mode', ['upi', 'card'])
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    const { data: periodPOs } = await supabase.from('purchase_orders')
      .select('grand_total, created_at, po_number')
      .eq('tenant_id', tenantId)
      .in('payment_mode', ['upi', 'card'])
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    // 3. Fetch Digital Supplier Payments (UPI/Card)
    const { data: supplierPays } = await supabase.from('supplier_payments')
      .select('*, suppliers(name)')
      .eq('tenant_id', tenantId)
      .in('payment_mode', ['upi', 'card'])
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    // 4. Fetch Digital Tip Payouts (UPI/Card)
    const { data: tipPayouts } = await supabase.from('tip_payouts')
      .select('*')
      .eq('outlet_id', outletId)
      .in('payment_mode', ['upi', 'card'])
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    let totalSales = 0;
    let totalTips = 0;
    let totalOut = 0;
    
    const ledgerIn = [];
    const ledgerOut = [];

    (payments || []).forEach(p => {
      const amt = Number(p.amount || 0);
      const tip = Number(p.tip_amount || 0);
      
      totalSales += amt;
      totalTips += tip;

      if (amt > 0) {
        ledgerIn.push({
          time: p.paid_at,
          desc: `Digital Sale (${p.mode.toUpperCase()})`,
          amount: amt
        });
      }
      if (tip > 0) {
        ledgerIn.push({
          time: p.paid_at,
          desc: `Digital Tip (${p.mode.toUpperCase()})`,
          amount: tip
        });
      }
    });

    (periodQuick || []).forEach(p => {
        totalOut += Number(p.total || 0);
        ledgerOut.push({ time: p.created_at, desc: 'Quick Purchase', amount: Number(p.total || 0) });
    });
    
    (periodPOs || []).forEach(p => {
        totalOut += Number(p.grand_total || 0);
        ledgerOut.push({ time: p.created_at, desc: `PO: ${p.po_number || 'N/A'}`, amount: Number(p.grand_total || 0) });
    });

    (supplierPays || []).forEach(p => {
      const amt = Number(p.amount);
      totalOut += amt;
      ledgerOut.push({
        time: p.created_at,
        desc: `Supplier Payment - ${p.suppliers?.name || 'Supplier'}`,
        amount: amt
      });
    });

    (tipPayouts || []).forEach(t => {
      const amt = Number(t.amount);
      totalOut += amt;
      ledgerOut.push({
        time: t.created_at,
        desc: `Tip Payout (${t.staff_name || 'Staff'})`,
        amount: amt
      });
    });

    ledgerIn.sort((a,b) => new Date(b.time) - new Date(a.time));
    ledgerOut.sort((a,b) => new Date(b.time) - new Date(a.time));

    const totalIn = totalSales + totalTips;
    const netBalance = totalIn - totalOut;

    const buildRows = (arr, isIn) => {
      if (!arr.length) return '<tr><td colspan="3" class="text-center py-6 text-slate-400 text-sm">No entries found</td></tr>';
      return arr.map(l => {
        const isTip = l.desc.includes('Tip');
        const textColor = isTip ? 'text-purple-600' : (isIn ? 'text-emerald-600' : 'text-red-600');
        return `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
          <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(l.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
          <td class="px-4 py-3 text-sm ${isTip ? 'text-purple-600 font-medium' : 'text-slate-700'}">${l.desc}</td>
          <td class="px-4 py-3 text-sm font-semibold text-right ${textColor}">
            ${isIn ? '+' : '-'}₹${l.amount.toFixed(2)}
          </td>
        </tr>
      `}).join('');
    };

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        
        <!-- 4 KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-5 shadow-sm">
            <div class="text-indigo-800 text-xs uppercase tracking-widest font-bold">Net Digital Balance</div>
            <div class="text-3xl font-bold text-indigo-600 mt-1">₹${netBalance.toFixed(2)}</div>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
            <div class="text-emerald-800 text-xs uppercase tracking-widest font-bold">Digital Sales</div>
            <div class="text-3xl font-bold text-emerald-600 mt-1">₹${totalSales.toFixed(2)}</div>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-xl p-5 shadow-sm">
            <div class="text-purple-800 text-xs uppercase tracking-widest font-bold">Digital Tips</div>
            <div class="text-3xl font-bold text-purple-600 mt-1">₹${totalTips.toFixed(2)}</div>
          </div>
          <div class="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
            <div class="text-red-800 text-xs uppercase tracking-widest font-bold">Total Out (Purchases)</div>
            <div class="text-3xl font-bold text-red-600 mt-1">₹${totalOut.toFixed(2)}</div>
          </div>
        </div>

        <!-- Ledgers -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 class="font-bold text-slate-700 text-sm">Money In (Digital Sales & Tips)</h3></div>
            <table class="w-full">
              <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-wide">
                <tr><th class="text-left px-4 py-2">Time</th><th class="text-left px-4 py-2">Desc</th><th class="text-right px-4 py-2">Amount</th></tr>
              </thead>
              <tbody>${buildRows(ledgerIn, true)}</tbody>
            </table>
          </div>
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 class="font-bold text-slate-700 text-sm">Money Out (Purchases & Payments)</h3></div>
            <table class="w-full">
              <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-wide">
                <tr><th class="text-left px-4 py-2">Time</th><th class="text-left px-4 py-2">Desc</th><th class="text-right px-4 py-2">Amount</th></tr>
              </thead>
              <tbody>${buildRows(ledgerOut, false)}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading UPI Book: ${err.message}</div>`;
  }
  return wrapper;
}

