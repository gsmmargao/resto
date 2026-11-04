import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney } from '../../utils.js';
import { state, rangeStart, rangeEnd } from './helpers.js';

export async function renderProfitBook() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Profit Book...</div>';
  
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  try {
    // 1. Fetch actual payments (this is the true realized revenue)
    const { data: expData } = await supabase.from('expenses').select('amount').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to);
    
    // Fetch supplier data for outstanding balance
    const { data: poData } = await supabase.from('purchase_orders').select('grand_total, supplier_id').eq('tenant_id', store.state.tenant.id);
    const { data: quickData } = await supabase.from('purchases').select('total, supplier_id').eq('tenant_id', store.state.tenant.id);
    const { data: supPayData } = await supabase.from('supplier_payments').select('amount, supplier_id').eq('tenant_id', store.state.tenant.id);

    const { data: payData, error } = await supabase.from('payments')
      .select('amount, tip_amount, mode, reference_no, invoice_id, paid_at, invoices(invoice_number)')
      .eq('outlet_id', outletId)
      .gte('paid_at', from)
      .lte('paid_at', to)
      .eq('status', 'success');

    if (error) throw error;

    const validPays = (payData || []).filter(p => p.mode !== 'credit' && p.mode !== 'no_charge');
    const totalRevenue = validPays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalTips = validPays.reduce((sum, p) => sum + Number(p.tip_amount || 0), 0);
    const totalExpenses = (expData || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    
    // Calculate supplier outstanding balance (Total Purchases - Total Payments)
    const totalPurchases = (poData || []).reduce((s, p) => s + Number(p.grand_total || 0), 0) 
                         + (quickData || []).reduce((s, p) => s + Number(p.total || 0), 0);
    const totalSupplierPayments = (supPayData || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const supplierOutstanding = Math.max(0, totalPurchases - totalSupplierPayments);
    
    // Calculate the final Net Profit
    // Correct accounting: Deduct TOTAL purchases (paid + unpaid) to get true profit
    const netProfit = totalRevenue + totalTips - totalExpenses - totalPurchases;

    // Group payments by invoice for the table
    const invoiceMap = {};
    validPays.forEach(p => {
      if (!p.invoice_id) return;
      if (!invoiceMap[p.invoice_id]) {
        invoiceMap[p.invoice_id] = { 
          invoice_number: p.invoices?.invoice_number || 'Unknown', 
          total: 0, 
          date: p.paid_at 
        };
      }
      invoiceMap[p.invoice_id].total += Number(p.amount || 0);
    });

    const billDetails = Object.values(invoiceMap);

    wrapper.innerHTML = `
      <div class="max-w-7xl mx-auto space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Revenue (Realized)</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${totalRevenue.toFixed(2)}</div>
            <div class="text-xs text-slate-400 mt-1">Food: ₹${totalRevenue.toFixed(2)} + Tips: ₹${totalTips.toFixed(2)}</div>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
            <div class="text-emerald-800 text-xs uppercase tracking-widest font-bold">Tips Collected</div>
            <div class="text-3xl font-bold text-emerald-600 mt-1">₹${totalTips.toFixed(2)}</div>
          </div>
          <div class="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
            <div class="text-red-800 text-xs uppercase tracking-widest font-bold">Total Expenses</div>
            <div class="text-3xl font-bold text-red-600 mt-1">₹${totalExpenses.toFixed(2)}</div>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-5 shadow-sm">
            <div class="text-amber-800 text-xs uppercase tracking-widest font-bold">Supplier Dues</div>
            <div class="text-3xl font-bold text-amber-600 mt-1">₹${supplierOutstanding.toFixed(2)}</div>
            <div class="text-xs text-amber-500 mt-1">Unpaid to vendors</div>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-5 shadow-sm">
            <div class="text-blue-600 text-xs uppercase tracking-widest font-bold">Total Purchases</div>
            <div class="text-3xl font-bold text-blue-700 mt-1">₹${totalPurchases.toFixed(2)}</div>
            <div class="text-xs text-blue-500 mt-1">Suppliers & Quick Buy</div>
          </div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-white">
            <div class="text-slate-400 text-xs uppercase tracking-widest font-bold">Net Profit</div>
            <div class="text-3xl font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} mt-1">₹${netProfit.toFixed(2)}</div>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Bill Details (Realized Revenue)</h3>
            <span class="text-xs font-semibold text-slate-500">Total: ₹${totalRevenue.toFixed(2)}</span>
          </div>
          <table class="w-full text-left">
            <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th class="px-5 py-3">Date</th>
                <th class="px-5 py-3">Bill #</th>
                <th class="px-5 py-3 text-right">Amount Realized</th>
              </tr>
            </thead>
            <tbody>
              ${billDetails.length === 0 ? '<tr><td colspan="3" class="text-center py-8 text-slate-400 text-sm">No payments in this period.</td></tr>' : 
                billDetails.map(inv => `
                  <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                    <td class="px-5 py-3 text-sm text-slate-600">${new Date(inv.date).toLocaleDateString('en-GB')}</td>
                    <td class="px-5 py-3 text-sm font-semibold text-slate-800">${inv.invoice_number}</td>
                    <td class="px-5 py-3 text-sm font-bold text-slate-800 text-right">₹${inv.total.toFixed(2)}</td>
                  </tr>
                `).join('')
              }
            </tbody>
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
