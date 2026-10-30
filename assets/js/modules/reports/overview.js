import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';
import { kpi } from './helpers.js';

export async function renderOverview() {
  const outletId = store.state.outlet.id;
  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];
  const from = fromDate + 'T00:00:00';
  const to = toDate + 'T23:59:59';

  const [invRes, itemsRes, payRes, shiftRes] = await Promise.all([
    supabase.from('invoices').select('id, order_id, grand_total, created_at, customer_id, orders(customer_id)')
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
  const orderCount = validInvoices.length;
  const itemCount = validItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const aov = orderCount ? gross / orderCount : 0;
  
  // Unique guests based on customer_id linked to invoices
  const uniqueCust = new Set(validInvoices.map(inv => inv.customer_id || inv.orders?.customer_id).filter(Boolean)).size;
  
  const itemCost = validItems.reduce((s, i) => s + Number(i.quantity) * Number(i.cost_price || 0), 0);
  const grossProfit = gross - itemCost;
  const marginPct = gross > 0 ? (grossProfit / gross) * 100 : 0;
  
  const totalTips = validPays.reduce((s, p) => s + Number(p.tip_amount || 0), 0);
  
  const byMode = {};
  validPays.forEach(p => { 
    const modeTotal = Number(p.amount || 0) + Number(p.tip_amount || 0);
    byMode[p.mode] = (byMode[p.mode] || 0) + modeTotal; 
  });
  
  const varianceTotal = shifts.filter(s => s.status === 'closed').reduce((s, x) => s + Number(x.cash_difference || 0), 0);

  const wrap = el('div', {});
  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-4' });
  grid.appendChild(kpi('Gross Sales', fmtMoney(gross), 'from-indigo-500 to-indigo-600', `${orderCount} orders`));
  grid.appendChild(kpi('Avg Order', fmtMoney(aov), 'from-emerald-500 to-emerald-600', `${itemCount} items sold`));
  grid.appendChild(kpi('Gross Profit', fmtMoney(grossProfit), 'from-amber-500 to-orange-500', `${marginPct.toFixed(1)}% margin`));
  grid.appendChild(kpi('Tips Collected', fmtMoney(totalTips), 'from-purple-500 to-purple-600', `${uniqueCust} unique guests`));

  const modesCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden flex-1' }, [
    el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Payment Modes'),
      el('span', { class: 'text-xs text-slate-500' }, `${validPays.length} transactions`),
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

