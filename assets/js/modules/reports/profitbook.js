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
    // 1. Fetch all data
    const { data: expData } = await supabase.from('expenses').select('*').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to);
    
    // Fetch suppliers for name mapping
    const { data: allSups } = await supabase.from('suppliers').select('id, name').eq('tenant_id', store.state.tenant.id);
    const supNameMap = {};
    (allSups || []).forEach(s => supNameMap[s.id] = s.name);

    // Fetch supplier data WITH DATE FILTERS
    const { data: poData } = await supabase.from('purchase_orders').select('id, po_number, grand_total, supplier_id, created_at').eq('tenant_id', store.state.tenant.id).gte('created_at', from).lte('created_at', to);
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
                         
    // 3. Calculate Supplier Balances
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

    // Helper to open PO Details Modal
    const openPO = async (po) => {
        const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
        const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });
        
        card.innerHTML = `
            <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                    <div class="font-mono text-sm text-slate-500">${po.po_number}</div>
                    <h3 class="font-bold text-lg text-slate-800">${supNameMap[po.supplier_id] || 'Supplier'}</h3>
                </div>
                <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" id="close-po-modal">&times;</button>
            </div>
            <div class="p-5 space-y-4" id="po-modal-body">
                <div class="text-center py-4 text-slate-500 animate-pulse">Loading items...</div>
            </div>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector('#close-po-modal').onclick = () => overlay.remove();
        
        const { data: items } = await supabase.from('purchase_order_items').select('*, ingredients(name)').eq('purchase_order_id', po.id);
        const body = card.querySelector('#po-modal-body');
        
        const tbody = el('tbody');
        (items || []).forEach(it => {
            tbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
                el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, it.ingredients?.name || 'Unknown'),
                el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, it.quantity),
                el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, fmtMoney(it.unit_price)),
                el('td', { class: 'px-4 py-2 text-right text-sm font-semibold text-slate-800' }, fmtMoney(it.line_total)),
            ]));
        });
        
        body.innerHTML = `
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <div class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Date</div>
                    <div class="text-sm font-medium text-slate-800 mt-0.5">${new Date(po.created_at).toLocaleDateString('en-IN')}</div>
                </div>
                <div>
                    <div class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Total Bill</div>
                    <div class="text-sm font-medium text-slate-800 mt-0.5">${fmtMoney(po.grand_total)}</div>
                </div>
            </div>
        `;
        
        const table = el('table', { class: 'w-full border border-slate-200 rounded-lg overflow-hidden mt-4' });
        table.appendChild(el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
            el('tr', {}, [
                el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Ingredient'),
                el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Qty'),
                el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Unit Price'),
                el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Total'),
            ])
        ]));
        table.appendChild(tbody);
        body.appendChild(table);
        body.appendChild(el('div', { class: 'bg-slate-50 rounded-lg p-4 mt-4 text-sm' }, [
            el('div', { class: 'flex justify-between font-bold text-slate-900 text-base' }, [
                el('span', {}, 'Total Bill'), el('span', {}, fmtMoney(po.grand_total)),
            ]),
        ]));
    };

    // Helper to open Expense Details Modal
    const openExpenseDetails = (e) => {
        const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
        const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden' });
        
        card.innerHTML = `
            <div class="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h3 class="font-bold text-slate-800">Expense Details</h3>
                <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" id="close-exp-modal">&times;</button>
            </div>
            <div class="p-5 space-y-3">
                <div>
                    <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Description</div>
                    <div class="font-bold text-slate-800 text-lg">${e.staff_name || e.custom_category || e.category || 'Expense'}</div>
                </div>
                <div>
                    <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Amount</div>
                    <div class="text-2xl font-black text-red-600">-₹${Number(e.amount).toFixed(2)}</div>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                    <div>
                        <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Date</div>
                        <div class="text-sm font-medium text-slate-800">${new Date(e.created_at).toLocaleDateString('en-GB')}</div>
                    </div>
                    <div>
                        <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Mode</div>
                        <div class="text-sm font-medium text-slate-800 uppercase">${e.payment_mode || 'CASH'}</div>
                    </div>
                </div>
                <div class="pt-2 border-t border-slate-100">
                    <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Notes</div>
                    <div class="text-sm text-slate-600 mt-0.5">${e.notes || 'No notes provided'}</div>
                </div>
            </div>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector('#close-exp-modal').onclick = () => overlay.remove();
    };

    // Helper to render details list
    const renderList = (items, emptyMsg) => {
        if (!items || items.length === 0) return `<div class="p-3 text-slate-500 text-sm italic">${emptyMsg}</div>`;
        return `<div class="divide-y divide-slate-100 max-h-60 overflow-y-auto">` + items.map(item => `
            <div class="p-3 flex justify-between items-center text-sm hover:bg-slate-50 ${item.dataId ? 'cursor-pointer hover:bg-indigo-50 transition' : ''}" ${item.dataId ? `data-id="${item.dataId}" data-type="${item.dataType || 'po'}"` : ''}>
                <div>
                    <div class="${item.isBold ? 'font-bold text-slate-900 text-base' : 'font-medium text-slate-800'} ${item.dataId ? 'text-indigo-600 underline' : ''}">${item.title}</div>
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
                ${renderList((expData || []).map(e => ({ title: e.staff_name || e.custom_category || e.category || e.notes || 'Expense', subtitle: e.notes || 'No notes', amount: '-₹' + Number(e.amount).toFixed(2), isNegative: true, dataId: e.id, dataType: 'expense' })), 'No expenses in this period')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Supplier Payments Made (Settlements)</span>
                    <span class="text-sm font-normal text-slate-500">₹${supPayData.reduce((s, p) => s + Number(p.amount || 0), 0).toFixed(2)}</span>
                </summary>
                ${renderList((supPayData || []).map(p => ({ 
                    title: 'Paid to ' + (supNameMap[p.supplier_id] || 'Supplier'), 
                    subtitle: p.notes || 'Partial/Full settlement', 
                    amount: '₹' + Number(p.amount).toFixed(2) 
                })), 'No supplier payments in this period')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Supplier Dues Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${supplierOutstanding.toFixed(2)}</span>
                </summary>
                ${renderList(Object.entries(supMap).filter(([id, s]) => s.balance > 0).map(([id, s]) => ({ title: s.name, subtitle: 'Outstanding Balance', amount: '₹' + s.balance.toFixed(2), isNegative: true, dataId: id, dataType: 'supplier' })), 'No outstanding dues')}
            </details>

            <details class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden group">
                <summary class="px-5 py-4 font-bold text-slate-800 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                    <span>Total Purchases Breakdown</span>
                    <span class="text-sm font-normal text-slate-500">₹${totalPurchases.toFixed(2)}</span>
                </summary>
                ${renderList([
                    ...(poData || []).map(p => ({ title: supNameMap[p.supplier_id] || 'Supplier', subtitle: '', amount: '₹' + Number(p.grand_total || 0).toFixed(2), dataId: p.id, isBold: true, dataType: 'po' })),
                    ...(quickData || []).map(p => ({ title: 'Quick Purchase', subtitle: p.notes || 'Direct entry', amount: '₹' + Number(p.total || 0).toFixed(2) }))
                ], 'No purchases in this period')}
            </details>
        </div>
      </div>
    `;

    // Attach click listeners for the dropdown items
    wrapper.querySelectorAll('[data-id]').forEach(el => {
        el.onclick = () => {
            const id = el.getAttribute('data-id');
            const type = el.getAttribute('data-type');
            
            if (type === 'expense') {
                const expense = expData.find(e => e.id === id);
                if (expense) openExpenseDetails(expense);
            } else {
                let po = poData.find(p => p.id === id);
                if (!po && type === 'supplier') {
                    const supplierPOs = poData.filter(p => p.supplier_id === id);
                    if (supplierPOs.length > 0) {
                        po = supplierPOs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
                    }
                }
                if (po) openPO(po);
            }
        };
    });

  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading Profit Book: ${err.message}</div>`;
  }

  return wrapper;
}
