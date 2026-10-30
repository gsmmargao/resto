import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';

export async function renderProfitBook() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Profit Book...</div>';
  
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) return wrapper;

  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];

  try {
    // 1. Fetch Invoices (Detailed for Bill Table)
    const { data: invoices } = await supabase.from('invoices')
      .select('id, invoice_number, grand_total, created_at, payments(mode)')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .order('created_at', { ascending: false });

    // Filter out invoices that were settled via 'credit' or 'no_charge'
    const paidInvoices = (invoices || []).filter(inv => {
        const pays = inv.payments || [];
        if (pays.some(p => p.mode === 'no_charge')) return false;
        if (pays.some(p => p.mode === 'credit')) return false;
        return true;
    });

    // 2. Fetch Tips Collected (Detailed)
    const { data: tipsInData } = await supabase.from('payments')
      .select('id, tip_amount, mode, paid_at, reference_no, orders(order_number)')
      .eq('outlet_id', outletId)
      .eq('status', 'success')
      .gt('tip_amount', 0)
      .gte('paid_at', fromDate + 'T00:00:00')
      .lte('paid_at', toDate + 'T23:59:59');

    // 3. Fetch Tips Paid Out (Detailed)
    const { data: tipsOut } = await supabase.from('tip_payouts')
      .select('*')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59');

    // 4. Fetch Purchases
    const { data: periodQuick } = await supabase.from('purchases').select('*, suppliers(name)').eq('tenant_id', tenantId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59');
    const { data: periodPOs } = await supabase.from('purchase_orders').select('*, suppliers(name)').eq('tenant_id', tenantId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59');

    const noChargeOrderIds = new Set(
      (invoices || []).flatMap(inv => 
        (inv.payments || []).filter(p => p.mode === 'no_charge').map(p => inv.id)
      )
    );
    const validInvoices = (invoices || []).filter(inv => !noChargeOrderIds.has(inv.id)); // Kept for tables if needed
    
    const totalFoodRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
    const totalTipsIn = (tipsInData || []).reduce((sum, p) => sum + Number(p.tip_amount || 0), 0);
    const totalTipsOut = (tipsOut || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);
    
    const totalRevenue = totalFoodRevenue + totalTipsIn;
    
    const totalQuick = (periodQuick || []).reduce((sum, p) => sum + Number(p.total || 0), 0);
    const totalPOs = (periodPOs || []).reduce((sum, p) => sum + Number(p.grand_total || 0), 0);
    const totalPurchases = totalQuick + totalPOs;
    
    const grossProfit = totalRevenue - totalPurchases - totalTipsOut;

    // Builders for Tables
    const buildInvoiceRows = () => {
      if (!validInvoices.length) return '<tr><td colspan="4" class="text-center py-8 text-slate-400 text-sm font-medium">No bills in this period.</td></tr>';
      return validInvoices.map(inv => {
        let mode = 'UNKNOWN';
        if (inv.payments && inv.payments.length > 0) {
            mode = inv.payments.map(p => p.mode.toUpperCase()).join(', ');
        }
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
            <td class="px-5 py-4 text-sm text-slate-500">${new Date(inv.created_at).toLocaleDateString('en-GB')}</td>
            <td class="px-5 py-4 text-sm font-semibold text-slate-800">${inv.invoice_number || 'N/A'}</td>
            <td class="px-5 py-4 text-sm text-center"><span class="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">${mode}</span></td>
            <td class="px-5 py-4 text-sm text-right font-bold text-slate-800">₹${Number(inv.grand_total || 0).toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    };

    const buildPurchaseRows = () => {
      const poDetails = (periodPOs || []).map(p => ({ date: p.created_at, ref: p.po_number || 'PO', supplier: p.suppliers?.name || 'Unknown', mode: (p.payment_status === 'credit' || p.payment_mode === 'credit') ? 'CREDIT' : (p.payment_mode || 'CASH').toUpperCase(), amount: Number(p.grand_total || 0) }));
      const quickDetails = (periodQuick || []).map(p => ({ date: p.created_at, ref: p.notes || 'Quick Purchase', supplier: p.suppliers?.name || 'Unknown', mode: (p.payment_mode === 'credit') ? 'CREDIT' : (p.payment_mode || 'CASH').toUpperCase(), amount: Number(p.total || 0) }));
      const allPurchasesList = [...poDetails, ...quickDetails].sort((a,b) => new Date(b.date) - new Date(a.date));

      if (!allPurchasesList.length) return '<tr><td colspan="5" class="text-center py-8 text-slate-400 text-sm font-medium">No purchases in this period.</td></tr>';
      return allPurchasesList.map(p => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="px-5 py-4 text-sm text-slate-500">${new Date(p.date).toLocaleDateString('en-GB')}</td>
          <td class="px-5 py-4 text-sm font-semibold text-slate-800">${p.ref}</td>
          <td class="px-5 py-4 text-sm text-slate-700">${p.supplier}</td>
          <td class="px-5 py-4 text-sm text-center"><span class="px-2 py-1 rounded text-[10px] font-bold ${p.mode === 'CREDIT' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${p.mode}</span></td>
          <td class="px-5 py-4 text-sm text-right font-bold text-slate-800">₹${p.amount.toFixed(2)}</td>
        </tr>
      `).join('');
    };

    const buildTipsInRows = () => {
      if (!tipsInData || !tipsInData.length) return '<tr><td colspan="4" class="text-center py-8 text-slate-400 text-sm font-medium">No tips collected in this period.</td></tr>';
      return tipsInData.sort((a,b) => new Date(b.paid_at) - new Date(a.paid_at)).map(t => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="px-5 py-4 text-sm text-slate-500">${new Date(t.paid_at).toLocaleDateString('en-GB')}</td>
          <td class="px-5 py-4 text-sm font-semibold text-slate-800">${t.orders?.order_number ? 'Order #' + t.orders.order_number : (t.reference_no || 'Manual Tip')}</td>
          <td class="px-5 py-4 text-sm"><span class="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">${t.mode}</span></td>
          <td class="px-5 py-4 text-sm text-right font-bold text-emerald-600">+₹${Number(t.tip_amount).toFixed(2)}</td>
        </tr>
      `).join('');
    };

    const buildTipsOutRows = () => {
      if (!tipsOut || !tipsOut.length) return '<tr><td colspan="4" class="text-center py-8 text-slate-400 text-sm font-medium">No tip payouts in this period.</td></tr>';
      return tipsOut.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(t => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="px-5 py-4 text-sm text-slate-500">${new Date(t.created_at).toLocaleDateString('en-GB')}</td>
          <td class="px-5 py-4 text-sm font-semibold text-slate-800">${t.staff_name || 'Staff'}</td>
          <td class="px-5 py-4 text-sm"><span class="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">${t.payment_mode}</span></td>
          <td class="px-5 py-4 text-sm text-right font-bold text-red-600">-₹${Number(t.amount).toFixed(2)}</td>
        </tr>
      `).join('');
    };

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        
        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Revenue (Inc. Tips)</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${totalRevenue.toFixed(2)}</div>
            <div class="text-xs text-slate-400 mt-2">Food: ₹${totalFoodRevenue.toFixed(0)} + Tips: ₹${totalTipsIn.toFixed(0)}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Purchases</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${totalPurchases.toFixed(2)}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Tips Paid Out</div>
            <div class="text-3xl font-bold text-red-600 mt-1">₹${totalTipsOut.toFixed(2)}</div>
          </div>
          <div class="bg-slate-900 rounded-xl p-5 shadow-sm">
            <div class="text-slate-400 text-xs uppercase tracking-widest font-bold">Net Profit</div>
            <div class="text-3xl font-bold ${grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} mt-1">₹${grossProfit.toFixed(2)}</div>
          </div>
        </div>

        <!-- Bill Details Table (NEW) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Bill Details (Selected Period)</h3>
            <span class="text-xs font-bold text-slate-600 bg-white px-2 py-1 rounded shadow-sm">Total: ₹${totalFoodRevenue.toFixed(2)}</span>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr><th class="text-left px-5 py-3 font-semibold">Date</th><th class="text-left px-5 py-3 font-semibold">Bill #</th><th class="text-center px-5 py-3 font-semibold">Mode</th><th class="text-right px-5 py-3 font-semibold">Amount</th></tr>
            </thead>
            <tbody>${buildInvoiceRows()}</tbody>
          </table>
        </div>

        <!-- Tips Tables -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div class="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
                <h3 class="font-bold text-emerald-800 text-sm">Tips Collected</h3>
                <span class="text-xs font-bold text-emerald-600 bg-white px-2 py-1 rounded shadow-sm">Total: ₹${totalTipsIn.toFixed(2)}</span>
              </div>
              <table class="w-full">
                <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-100">
                  <tr><th class="text-left px-5 py-3 font-semibold">Date</th><th class="text-left px-5 py-3 font-semibold">Source</th><th class="text-left px-5 py-3 font-semibold">Mode</th><th class="text-right px-5 py-3 font-semibold">Amount</th></tr>
                </thead>
                <tbody>${buildTipsInRows()}</tbody>
              </table>
            </div>

            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div class="px-5 py-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                <h3 class="font-bold text-red-800 text-sm">Tips Paid Out</h3>
                <span class="text-xs font-bold text-red-600 bg-white px-2 py-1 rounded shadow-sm">Total: ₹${totalTipsOut.toFixed(2)}</span>
              </div>
              <table class="w-full">
                <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-100">
                  <tr><th class="text-left px-5 py-3 font-semibold">Date</th><th class="text-left px-5 py-3 font-semibold">Staff Name</th><th class="text-left px-5 py-3 font-semibold">Mode</th><th class="text-right px-5 py-3 font-semibold">Amount</th></tr>
                </thead>
                <tbody>${buildTipsOutRows()}</tbody>
              </table>
            </div>
        </div>

        <!-- Purchases Table -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
            <h3 class="font-bold text-slate-800 text-sm">Purchase Details (Selected Period)</h3>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest">
              <tr><th class="text-left px-5 py-3 font-semibold">Date</th><th class="text-left px-5 py-3 font-semibold">Ref / PO</th><th class="text-left px-5 py-3 font-semibold">Supplier</th><th class="text-center px-5 py-3 font-semibold">Mode</th><th class="text-right px-5 py-3 font-semibold">Amount</th></tr>
            </thead>
            <tbody>${buildPurchaseRows()}</tbody>
          </table>
        </div>

      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading Profit Book: ${err.message}</div>`;
  }
  return wrapper;
}

