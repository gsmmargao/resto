import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';
import { kpi, state, rangeStart, rangeEnd } from './helpers.js';

export async function renderOverview() {
  const outletId = store.state.outlet.id;
  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const [invRes, itemsRes, payRes, shiftRes] = await Promise.all([
    supabase.from('invoices').select('id, order_id, grand_total, discount_total, balance_due, created_at, customer_id, orders(customer_id)')
      .eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to),
    supabase.from('order_items').select('order_id, quantity, line_total, cost_price')
      .eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to).neq('status', 'cancelled'),
    supabase.from('payments').select('order_id, mode, amount, tip_amount, is_refund')
      .eq('outlet_id', outletId).gte('paid_at', from).lte('paid_at', to).eq('status', 'success'),
    supabase.from('cash_registers').select('id, status, cash_difference')
      .eq('outlet_id', outletId).gte('opened_at', from).lte('opened_at', to),
  ]);

  const rawInvoices = invRes.data || [];
  const rawItems = itemsRes.data || [];
  const rawPays = (payRes.data || []).filter(p => !p.is_refund);
  const shifts = shiftRes.data || [];

  // Exclude 'no_charge' invoices
  const noChargeOrderIds = new Set(
    rawPays.filter(p => p.mode === 'no_charge').map(p => p.order_id)
  );
  const validInvoices = rawInvoices.filter(inv => !noChargeOrderIds.has(inv.order_id));
  const validOrderIds = new Set(validInvoices.map(inv => inv.order_id));
  
  const validPays = rawPays.filter(p => p.mode !== 'no_charge');
  const validItems = rawItems.filter(i => validOrderIds.has(i.order_id));

  const gross = validInvoices.reduce((s, inv) => s + Number(inv.grand_total || 0), 0);
  const totalDiscount = validInvoices.reduce((s, inv) => s + Number(inv.discount_total || 0), 0);
  const pendingCredit = validInvoices.reduce((s, inv) => s + Number(inv.balance_due || 0), 0); // Keep this
  const realizedGross = gross - pendingCredit;
  const orderCount = validInvoices.length;
  const itemCount = validItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const aov = orderCount ? gross / orderCount : 0;
  
  // Unique guests based on customer_id linked to invoices
  const uniqueCust = new Set(validInvoices.map(inv => inv.customer_id || inv.orders?.customer_id).filter(Boolean)).size;
  
  const itemCost = validItems.reduce((s, i) => s + Number(i.quantity) * Number(i.cost_price || 0), 0);
 // Deduct unpaid credit
  const grossProfit = realizedGross - itemCost;
  const marginPct = realizedGross > 0 ? (grossProfit / realizedGross) * 100 : 0;
  
  const totalTips = validPays.reduce((s, p) => s + Number(p.tip_amount || 0), 0);
  
  const byMode = {};
  let realPaymentCount = 0;
  
  validPays.forEach(p => { 
    // Only count real payments, ignore the initial 'credit' booking
    if (p.mode !== 'credit') {
      const modeTotal = Number(p.amount || 0) + Number(p.tip_amount || 0);
      byMode[p.mode] = (byMode[p.mode] || 0) + modeTotal; 
      realPaymentCount++;
    }
  });

  // Add the actual unpaid pending credit to the breakdown so it matches Total Sales
  if (pendingCredit > 0) {
    byMode['credit'] = pendingCredit;
  }
  
  const varianceTotal = shifts.filter(s => s.status === 'closed').reduce((s, x) => s + Number(x.cash_difference || 0), 0);

  const wrap = el('div', {});
  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-6 gap-3 mb-4' });
  grid.appendChild(kpi('Gross Sales', fmtMoney(gross), 'from-indigo-500 to-indigo-600', `${orderCount} orders`));
  
  const discKpi = kpi('Discount Given', fmtMoney(totalDiscount), 'from-rose-500 to-pink-500', 'Total discount applied');
  discKpi.style.cursor = 'pointer';
  discKpi.title = 'Click to view discounted bills';
  discKpi.onclick = () => openDiscountModal(validInvoices);
  grid.appendChild(discKpi);
  grid.appendChild(kpi('Avg Order', fmtMoney(aov), 'from-emerald-500 to-emerald-600', `${itemCount} items sold`));
  grid.appendChild(kpi('Gross Profit', fmtMoney(grossProfit), 'from-amber-500 to-orange-500', `${marginPct.toFixed(1)}% margin`));
  grid.appendChild(kpi('Tips Collected', fmtMoney(totalTips), 'from-purple-500 to-purple-600', `${uniqueCust} unique guests`));
  grid.appendChild(kpi('Pending Credit', fmtMoney(pendingCredit), 'from-red-500 to-red-600', 'Unsettled bills'));

  const modesCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden flex-1' }, [
    el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Payment Modes'),
      el('span', { class: 'text-xs text-slate-500' }, `${realPaymentCount + (pendingCredit > 0 ? 1 : 0)} transactions`),
    ]),
    el('div', { class: 'p-4 space-y-3' }, Object.entries(byMode).map(([mode, amt]) => {
      const pct = gross > 0 ? (amt / (gross + totalTips)) * 100 : 0;
      return el('div', { class: 'flex items-center justify-between text-sm' }, [
        el('span', { class: 'w-20 font-medium text-slate-700 uppercase' }, mode),
        el('div', { class: 'flex-1 mx-4 h-2 bg-slate-100 rounded-full overflow-hidden' }, [
          el('div', { class: `h-full ${mode === 'cash' ? 'bg-emerald-500' : 'bg-indigo-500'}`, style: `width: ${pct}%` })
        ]),
        el('span', { class: 'text-slate-800 font-semibold w-20 text-right' }, fmtMoney(amt)),
        el('span', { class: 'text-slate-400 text-xs w-12 text-right' }, `${pct.toFixed(0)}%`),
      ]);
    })),
  ]);

  const orderTypesCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden flex-1' }, [
    el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Order Types'),
    ]),
    el('div', { class: 'p-4 space-y-3' }, Object.entries(validInvoices.reduce((acc, inv) => {
        const type = inv.orders?.order_type || 'dine_in';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {})).map(([type, count]) => {
      const pct = orderCount > 0 ? (count / orderCount) * 100 : 0;
      return el('div', { class: 'flex items-center justify-between text-sm' }, [
        el('span', { class: 'w-24 font-medium text-slate-700 uppercase' }, type.replace('_', ' ')),
        el('div', { class: 'flex-1 mx-4 h-2 bg-slate-100 rounded-full overflow-hidden' }, [
          el('div', { class: 'h-full bg-orange-400', style: `width: ${pct}%` })
        ]),
        el('span', { class: 'text-slate-800 font-semibold w-8 text-right' }, count),
        el('span', { class: 'text-slate-400 text-xs w-12 text-right' }, `${pct.toFixed(0)}%`),
      ]);
    })),
  ]);

  const cashCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between mt-4' }, [
    el('div', {}, [
        el('h3', { class: 'font-semibold text-slate-800 text-sm mb-3' }, 'Cash Reconciliation'),
        el('div', { class: 'flex gap-8' }, [
            el('div', {}, [
                el('div', { class: 'text-xs text-slate-500 uppercase' }, 'Shifts'),
                el('div', { class: 'text-2xl font-bold text-slate-800' }, shifts.length)
            ]),
            el('div', {}, [
                el('div', { class: 'text-xs text-slate-500 uppercase' }, 'Closed'),
                el('div', { class: 'text-2xl font-bold text-slate-800' }, shifts.filter(s => s.status === 'closed').length)
            ]),
            el('div', {}, [
                el('div', { class: 'text-xs text-slate-500 uppercase' }, 'Net Variance'),
                el('div', { class: `text-2xl font-bold ${varianceTotal === 0 ? 'text-emerald-500' : 'text-red-500'}` }, fmtMoney(varianceTotal))
            ])
        ])
    ]),
    el('span', { class: 'px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full uppercase tracking-wide' }, varianceTotal === 0 ? 'Balanced' : 'Variance')
  ]);

  wrap.appendChild(grid);
  wrap.appendChild(el('div', { class: 'flex flex-col md:flex-row gap-4' }, [modesCard, orderTypesCard]));
  wrap.appendChild(cashCard);

  return wrap;
}



// ==========================================
// DISCOUNT BREAKDOWN MODAL
// ==========================================
function openDiscountModal(invoices) {
    const discountedBills = invoices.filter(inv => Number(inv.discount_total || 0) > 0);
    
    // Overlay: Full screen on mobile, padded on desktop
    const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-0 sm:p-4' });
    
    // Card: Full height on mobile, max height on desktop. Flex col to keep header fixed.
    const card = el('div', { class: 'bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden sm:max-w-4xl' });
    
    // Header: Fixed at top
    card.appendChild(el('div', { class: 'px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0 z-10' }, [
        el('div', {}, [
            el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Discounted Bills'),
            el('p', { class: 'text-xs text-slate-500 mt-0.5' }, `${discountedBills.length} bills with discounts`)
        ]),
        // Added a larger hit area for the close button
        el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none p-2 -mr-2', onclick: () => overlay.remove() }, '×')
    ]));

    // Body: Scrollable area
    const body = el('div', { class: 'flex-1 overflow-y-auto p-0 bg-white' });
    
    if (discountedBills.length === 0) {
        body.innerHTML = '<div class="text-center py-10 text-slate-400">No discounted bills in this period.</div>';
    } else {
        // Table wrapper: Horizontal scroll for mobile
        const tableWrap = el('div', { class: 'w-full overflow-x-auto' });
        const tbody = el('tbody');
        
        discountedBills.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).forEach(inv => {
            tbody.appendChild(el('tr', { 
                class: 'border-b border-slate-100 hover:bg-indigo-50 cursor-pointer transition',
                onclick: () => {
                    import('../reports/modals.js').then(m => {
                        if (typeof m.openBillReprintModal === 'function') {
                            m.openBillReprintModal(inv.id);
                        }
                    });
                }
            }, [
                el('td', { class: 'px-4 py-3 text-xs sm:text-sm text-slate-600 whitespace-nowrap' }, new Date(inv.created_at).toLocaleDateString('en-GB')),
                el('td', { class: 'px-4 py-3 text-xs sm:text-sm font-semibold text-indigo-600 underline whitespace-nowrap' }, inv.id.slice(0,8).toUpperCase()),
                el('td', { class: 'px-4 py-3 text-xs sm:text-sm text-right text-slate-800 whitespace-nowrap' }, fmtMoney(inv.grand_total)),
                el('td', { class: 'px-4 py-3 text-xs sm:text-sm text-right font-bold text-rose-600 whitespace-nowrap' }, '-' + fmtMoney(inv.discount_total))
            ]));
        });

        // min-w-[500px] ensures columns don't squish too much on mobile
        tableWrap.appendChild(el('table', { class: 'w-full text-left min-w-[500px]' }, [
            el('thead', { class: 'bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-200 sticky top-0 z-0' }, [
                el('tr', {}, [
                    el('th', { class: 'px-4 py-3' }, 'Date'),
                    el('th', { class: 'px-4 py-3' }, 'Invoice'),
                    el('th', { class: 'px-4 py-3 text-right' }, 'Total'),
                    el('th', { class: 'px-4 py-3 text-right' }, 'Discount')
                ])
            ]),
            tbody
        ]));
        body.appendChild(tableWrap);
    }
    
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
}
