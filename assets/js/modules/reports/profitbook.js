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
    // 1. Fetch all data WITH DATE FILTERS
    const { data: expData } = await supabase.from('expenses').select('*').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to);
    
    // Fetch suppliers for name mapping
    const { data: allSups } = await supabase.from('suppliers').select('id, name').eq('tenant_id', store.state.tenant.id);
    const supNameMap = {};
    (allSups || []).forEach(s => supNameMap[s.id] = s.name);

    // Fetch supplier data WITH DATE FILTERS
    const { data: poData } = await supabase.from('purchase_orders').select('po_number, grand_total, supplier_id, created_at').eq('tenant_id', store.state.tenant.id).gte('created_at', from).lte('created_at', to);
    const { data: quickData } = await supabase.from('purchases').select('*').eq('tenant_id', store.state.tenant.id).gte('created_at', from).lte('created_at', to);
    const { data: supPayData } = await supabase.from('supplier_payments').select('*').eq('tenant_id', store.state.tenant.id).gte('created_at', from).lte('created_at', to);
    
    // Fetch Tip Payouts
    const { data: tipOutData } = await supabase.from('tip_payouts').select('*').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to);

    // Fetch Payments
    const { data: payData, error } = await supabase.from('payments')
      .select('amount, tip_amount, mode, reference_no, invoice_id, paid_at, invoices(invoice_number)')
      .eq('outlet_id', outletId)
      .gte('paid_at', from)
      .lte('paid_at', to)
      .eq('status', 'success');

    if (error) throw error;

    const validPays = (payData || []).filter(p => p.mode !== 'credit' && p.mode !== 'no_charge');
    
    // 2. Calculate Totals
    const totalCollected = validPays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalTipsIn = validPays.reduce((sum, p) => sum + Number(p.tip_amount || 0), 0);
    const baseRevenue = totalCollected - totalTipsIn;

    const totalTipsOut = (tipOutData || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const tipsBalance = totalTipsIn - totalTipsOut;

    const totalExpenses = (expData || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    
    const totalPurchases = (poData || []).reduce((s, p) => s + Number(p.grand_total || 0), 0)
                         + (quickData || []).reduce((s, p) => s + Number(p.total || 0), 0);
                         
    // 3. Calculate Supplier Balances (using Name Mapping)
    const supMap = {};
    const addToSupMap = (id, amount) => {
        if (!id) return;
        if (!supMap[id]) supMap[id] = { name: supNameMap[id] || 'Unknown Supplier', balance: 0 };
        supMap[id].balance += amount;
    };
    (poData || []).forEach(p => addToSupMap(p.supplier_id, Number(p.grand_total || 0)));
    (quickData || []).forEach(p => addToSupMap(p.supplier_id, Number(p.total || 0)));
    (supPayData || []).forEach(p => addToSupMap(p.supplier_id, -Number(p.amount || 0)));
    
    let supplierOutstanding = 0;
    Object.values(supMap).forEach(s => { if (s.balance > 0) supplierOutstanding += s.balance; });
    
    const netProfit = baseRevenue - totalExpenses - totalPurchases;

    // Helper to render details list
    const renderList = (items, emptyMsg) => {
        if (!items || items.length === 0) return `<div class="p-3 text-slate-500 text-sm italic">${emptyMsg}</div>`;
        return `<div class="divide-y divide-slate-100 max-h-60 overflow-y-auto">` + items.map(item => `
            <div class="p-3 flex justify-between items-center text-sm hover:bg-slate-50">
                <div>
                    <div class="font-medium text-slate-800">${item.title}</div>
                    ${item.subtitle ? `<div class="text-xs text-slate-500 mt-0.5">${item.subtitle}</div>` : ''}
                </div>
                <div class="font-bold ${item.isNegative ? 'text-red-600' : 'text-slate-800'}">${item.amount}</div>
            </div>
        `).join('') + `</div>`;
    };

    // 4. Render UI
    wrapper.innerHTML = `
      <div class="max-w-7xl mx-auto space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Revenue (Base)</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${baseRevenue.toFixed(2)}</div>
            <div class="text-xs text-slate-400 mt-1">Excludes Tips</div>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
            <div class="text-emerald-800 text-xs uppercase tracking-widest font-bold">Tips Balance</div>
            <div class="text-3xl font-bold text-emerald-600 mt-1">₹${tipsBalance.toFixed(2)}</div>
            <div class="text-xs text-emerald-500 mt-1">In: ₹${totalTipsIn.toFixed(2)} | Out: ₹${totalTipsOut.toFixed(2)}</div>
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

        <div class="space-y-3">
            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Total Revenue Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${baseRevenue.toFixed(2)}</span>
                </summary>
                ${renderList(validPays.map(p => ({ title: p.invoices?.invoice_number || 'Unknown Bill', subtitle: p.mode.toUpperCase(), amount: '₹' + Number(p.amount || 0).toFixed(2) })), 'No revenue in this period')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Tips Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${tipsBalance.toFixed(2)}</span>
                </summary>
                <div class="p-3 bg-slate-100 font-semibold text-sm">Tips In</div>
                ${renderList(validPays.filter(p => p.tip_amount > 0).map(p => ({ title: 'Tip Collected', subtitle: p.mode.toUpperCase(), amount: '₹' + Number(p.tip_amount).toFixed(2) })), 'No tips collected')}
                <div class="p-3 bg-slate-100 font-semibold text-sm border-t border-slate-200">Tips Out</div>
                ${renderList((tipOutData || []).map(t => ({ title: 'Tip Payout', subtitle: t.staff_name || 'Staff', amount: '-₹' + Number(t.amount).toFixed(2), isNegative: true })), 'No tips paid out')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Total Expenses Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${totalExpenses.toFixed(2)}</span>
                </summary>
                ${renderList((expData || []).map(e => ({ title: e.category || 'Expense', subtitle: e.notes || 'No notes', amount: '-₹' + Number(e.amount).toFixed(2), isNegative: true })), 'No expenses in this period')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Supplier Dues Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${supplierOutstanding.toFixed(2)}</span>
                </summary>
                ${renderList(Object.values(supMap).filter(s => s.balance > 0).map(s => ({ title: s.name, subtitle: 'Outstanding Balance', amount: '₹' + s.balance.toFixed(2), isNegative: true })), 'No outstanding dues')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Total Purchases Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${totalPurchases.toFixed(2)}</span>
                </summary>
                ${renderList([
                    ...(poData || []).map(p => ({ title: 'PO: ' + (p.po_number || 'N/A'), subtitle: supNameMap[p.supplier_id] || 'Supplier', amount: '₹' + Number(p.grand_total || 0).toFixed(2) })),
                    ...(quickData || []).map(p => ({ title: 'Quick Purchase', subtitle: p.notes || 'Direct entry', amount: '₹' + Number(p.total || 0).toFixed(2) }))
                ], 'No purchases in this period')}
            </details>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading Profit Book: ${err.message}</div>`;
  }

  return wrapper;
}
