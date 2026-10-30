import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, toast } from '../utils.js';
import { buildReceiptData, buildReceiptHTML } from './receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from './printer.js';
import { openPersonLedgerModal } from './reports/modals.js';

const state = {
  tab: localStorage.getItem('reports_active_tab') || 'overview',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10)
};

export async function renderReports(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Reports'),
      el('p', { class: 'text-xs text-slate-500' }, store.state.outlet?.name || ''),
    ]),
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
      el('div', { class: 'flex items-center gap-1 bg-slate-100 rounded-lg p-1' }, [
        el('button', {
            class: 'px-2 py-1.5 rounded hover:bg-slate-200 text-slate-600 transition font-bold',
            onclick: () => {
                state.startDate = shiftDate(state.startDate, -1);
                state.endDate = shiftDate(state.endDate, -1);
                renderReports(root);
            }
        }, '‹'),
        
        el('input', {
          type: 'date', value: state.startDate,
          class: 'px-2 py-1 rounded-md border-0 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-sm',
          onchange: (e) => { 
              state.startDate = e.target.value; 
              if (state.endDate < state.startDate) state.endDate = state.startDate;
              renderReports(root); 
          }
        }),
        el('span', { class: 'text-slate-400 text-xs px-1 font-medium' }, 'to'),
        el('input', {
          type: 'date', value: state.endDate,
          class: 'px-2 py-1 rounded-md border-0 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium shadow-sm',
          onchange: (e) => { 
              state.endDate = e.target.value; 
              if (state.startDate > state.endDate) state.startDate = state.endDate;
              renderReports(root); 
          }
        }),
        
        el('button', {
            class: 'px-2 py-1.5 rounded hover:bg-slate-200 text-slate-600 transition font-bold',
            onclick: () => {
                state.startDate = shiftDate(state.startDate, 1);
                state.endDate = shiftDate(state.endDate, 1);
                renderReports(root);
            }
        }, '›'),

        el('button', {
            class: 'ml-1 px-3 py-1.5 rounded bg-white text-indigo-600 text-xs font-bold shadow-sm border border-slate-200 hover:bg-indigo-50 transition',
            onclick: () => {
                const today = new Date().toISOString().split('T')[0];
                state.startDate = today;
                state.endDate = today;
                renderReports(root);
            }
        }, 'Today')
      ]),
      el('button', {
          class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition',
          onclick: () => window.print()
      }, 'Print / PDF')
    ]),
  ]);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    [
      ['overview', 'Overview'],
      ['sales', 'Sales Trend'],
      ['items', 'Item Mix'],
      ['staff', 'Staff'],
      ['upi', 'UPI'],
      ['cashbook', 'Cashbook'],
      ['voided', 'Voided Items'],
      ['bills', 'Bills'],
      ['kots', 'KOTs'],
      ['profit', 'Profit Book']
    ].map(([key, label]) =>
        el('button', {
          class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
          onclick: async () => { state.tab = key; localStorage.setItem('reports_active_tab', key); await renderReports(root); },
        }, label)));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto' });
  inner.appendChild(el('div', { class: 'text-slate-400 text-sm' }, 'Loading…'));
  body.appendChild(inner);

  wrap.appendChild(header); wrap.appendChild(tabs); wrap.appendChild(body);
  root.appendChild(wrap);

  try {
    const panels = { 
      overview: renderOverview, 
      sales: renderSalesTrend, 
      items: renderItemMix, 
      staff: renderStaff, 
      cash: renderCashVariance,
      upi: renderUPI,
      cashbook: renderCashbookDetailed,
      voided: renderVoidedItems,
      bills: renderBills,
      kots: renderKOTs,
      profit: renderProfitBook
    };
    const panel = await panels[state.tab]();
    
    // Only clear if panel is a valid Node OR the panel didn't self-render
    if (panel && panel.nodeType === 1) {
        inner.innerHTML = '';
        inner.appendChild(panel);
    } else {
        // The panel might have rendered itself directly into the DOM
        // Only show an error if the container is still empty
        if (!inner.innerHTML.trim() || inner.innerHTML.includes('animate-pulse') || inner.innerHTML.includes('Loading')) {
            inner.innerHTML = `<div class="bg-red-50 text-red-600 p-6 rounded-xl border border-red-200 text-center font-medium">Failed to render ${state.tab} report.</div>`;
        }
        // Otherwise, the tab rendered itself. Do nothing.
    }
  } catch (err) {
    console.error('[reports]', err);
    inner.innerHTML = '';
    inner.appendChild(el('div', { class: 'bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm' }, 'Failed to load report: ' + (err.message || err)));
  }
}

function rangeStart() {
  const d = new Date(state.startDate);
  d.setHours(0, 0, 0, 0);
  return d;
}
function rangeEnd() {
  const d = new Date(state.endDate);
  d.setHours(23, 59, 59, 999);
  return d;
}
function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-2xl font-bold mt-1' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}
function ioRow(label, value, isBold = false) {
  return el('tr', { class: isBold ? 'bg-slate-50 font-bold border-t border-slate-200' : 'border-b border-slate-100 last:border-0' }, [
    el('td', { class: 'px-4 py-2 text-slate-700' }, label),
    el('td', { class: 'px-4 py-2 text-right font-medium' }, fmtMoney(value))
  ]);
}

async function renderOverview() {
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

function buildPaymentModes(byMode, txnCount) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5' });
  card.appendChild(el('div', { class: 'flex items-center justify-between mb-3' }, [
    el('h3', { class: 'font-semibold text-slate-800' }, 'Payment Modes'),
    el('span', { class: 'text-xs text-slate-500' }, `${txnCount} transactions`),
  ]));
  const entries = Object.entries(byMode).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length) { card.appendChild(el('div', { class: 'text-sm text-slate-400 italic py-4 text-center' }, 'No payments yet')); return card; }
  const colors = { cash: 'bg-emerald-500', card: 'bg-indigo-500', upi: 'bg-purple-500', wallet: 'bg-pink-500', netbanking: 'bg-sky-500', other: 'bg-slate-500' };
  entries.forEach(([mode, amount]) => {
    const pct = total > 0 ? (amount / total) * 100 : 0;
    card.appendChild(el('div', { class: 'flex items-center gap-3 py-2' }, [
      el('div', { class: 'w-24 text-xs uppercase font-medium text-slate-700' }, mode),
      el('div', { class: 'flex-1 bg-slate-100 rounded-full h-2 overflow-hidden' }, [
        el('div', { class: `${colors[mode] || 'bg-slate-400'} h-full rounded-full`, style: `width: ${pct}%` }),
      ]),
      el('div', { class: 'text-right w-24 text-sm font-semibold text-slate-800' }, fmtMoney(amount)),
      el('div', { class: 'text-right w-12 text-xs text-slate-500' }, pct.toFixed(0) + '%'),
    ]));
  });
  return card;
}

function buildOrderTypes(orders) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5' });
  card.appendChild(el('h3', { class: 'font-semibold text-slate-800 mb-3' }, 'Order Types'));
  const counts = { dine_in: 0, takeaway: 0, delivery: 0, online: 0 };
  let total = 0;
  orders.forEach(o => { counts[o.order_type] = (counts[o.order_type] || 0) + 1; total++; });
  const colors = { dine_in: 'bg-amber-500', takeaway: 'bg-cyan-500', delivery: 'bg-fuchsia-500', online: 'bg-slate-500' };
  Object.entries(counts).forEach(([type, count]) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    card.appendChild(el('div', { class: 'flex items-center gap-3 py-2' }, [
      el('div', { class: 'w-24 text-xs uppercase font-medium text-slate-700' }, type.replace('_', ' ')),
      el('div', { class: 'flex-1 bg-slate-100 rounded-full h-2 overflow-hidden' }, [
        el('div', { class: `${colors[type] || 'bg-slate-400'} h-full rounded-full`, style: `width: ${pct}%` }),
      ]),
      el('div', { class: 'text-right w-12 text-sm font-semibold text-slate-800' }, count),
      el('div', { class: 'text-right w-12 text-xs text-slate-500' }, pct.toFixed(0) + '%'),
    ]));
  });
  return card;
}

async function renderSalesTrend() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();
  const { data: orders } = await supabase.from('orders').select('grand_total, placed_at')
    .eq('outlet_id', outletId).gte('placed_at', from).lte('placed_at', to)
    .in('status', ['paid', 'partially_paid', 'billed']);

  const wrap = el('div', {});
  const daily = {};
  const hourly = Array(24).fill(0);
  (orders || []).forEach(o => {
    const d = new Date(o.placed_at);
    const key = d.toISOString().slice(0, 10);
    daily[key] = (daily[key] || 0) + Number(o.grand_total || 0);
    hourly[d.getHours()] += Number(o.grand_total || 0);
  });

  const days = [];
  const start = rangeStart();
  const end = rangeEnd();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const max = Math.max(...days.map(d => daily[d] || 0), 1);

  const chartWrap = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5 mb-3' });
  chartWrap.appendChild(el('div', { class: 'flex items-center justify-between mb-4' }, [
    el('h3', { class: 'font-semibold text-slate-800' }, 'Daily Sales'),
    el('span', { class: 'text-xs text-slate-500' }, `Peak: ${fmtMoney(max)}`),
  ]));

  const chart = el('div', { class: 'flex items-end gap-1 h-48 pt-2 overflow-x-auto' });
  days.forEach(d => {
    const v = daily[d] || 0;
    const pct = (v / max) * 100;
    chart.appendChild(el('div', { class: 'flex-1 flex flex-col items-center justify-end min-w-[18px] group relative' }, [
      el('div', { class: 'absolute -top-7 opacity-0 group-hover:opacity-100 transition bg-slate-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10' }, fmtMoney(v)),
      el('div', { class: 'w-full bg-indigo-500 rounded-t hover:bg-indigo-600 transition-all', style: `height: ${pct}%; min-height: 2px;` }),
      el('div', { class: 'text-[9px] text-slate-500 mt-1' }, d.slice(8)),
    ]));
  });
  chartWrap.appendChild(chart);
  wrap.appendChild(chartWrap);

  const maxH = Math.max(...hourly, 1);
  const heatWrap = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5' });
  heatWrap.appendChild(el('h3', { class: 'font-semibold text-slate-800 mb-4' }, 'Hourly Sales Pattern'));
  const grid = el('div', { class: 'grid grid-cols-8 md:grid-cols-12 gap-1.5' });
  hourly.forEach((v, h) => {
    const intensity = v / maxH;
    const bg = intensity === 0 ? 'bg-slate-100' : intensity < 0.25 ? 'bg-indigo-100' : intensity < 0.5 ? 'bg-indigo-300' : intensity < 0.75 ? 'bg-indigo-500' : 'bg-indigo-700';
    const text = intensity > 0.5 ? 'text-white' : 'text-slate-700';
    grid.appendChild(el('div', {
      class: `${bg} ${text} rounded-lg p-2 text-center hover:ring-2 hover:ring-indigo-400 transition cursor-default`,
      title: `${h}:00 — ${fmtMoney(v)}`,
    }, [
      el('div', { class: 'text-[9px] font-semibold uppercase opacity-80' }, `${h}`),
      el('div', { class: 'text-[10px] font-bold mt-0.5' }, v > 0 ? fmtMoney(v).replace('₹', '') : '·'),
    ]));
  });
  heatWrap.appendChild(grid);
  wrap.appendChild(heatWrap);
  return wrap;
}

async function renderItemMix() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();
  const { data: items } = await supabase.from('order_items')
    .select('name_snapshot, quantity, line_total, cost_price')
    .eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to)
    .neq('status', 'cancelled');

  const agg = {};
  (items || []).forEach(it => {
    const k = it.name_snapshot;
    if (!agg[k]) agg[k] = { qty: 0, revenue: 0, cost: 0 };
    agg[k].qty += Number(it.quantity);
    agg[k].revenue += Number(it.line_total);
    agg[k].cost += Number(it.quantity) * Number(it.cost_price || 0);
  });

  const rows = Object.entries(agg).map(([name, v]) => ({
    name, qty: v.qty, revenue: v.revenue, profit: v.revenue - v.cost,
    marginPct: v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0,
  }));

  const wrap = el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-3' });
  wrap.appendChild(itemTable('Top Sellers (by qty)', [...rows].sort((a, b) => b.qty - a.qty), 'qty'));
  wrap.appendChild(itemTable('Top Revenue', [...rows].sort((a, b) => b.revenue - a.revenue), 'revenue'));
  wrap.appendChild(itemTable('Top Profit', [...rows].sort((a, b) => b.profit - a.profit), 'profit'));
  wrap.appendChild(itemTable('Lowest Margin', rows.filter(r => r.revenue > 0).sort((a, b) => a.marginPct - b.marginPct), 'margin'));
  return wrap;
}

function itemTable(title, rows, mode, limit = 10) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, title),
  ]));
  const slice = rows.slice(0, limit);
  if (!slice.length) {
    card.appendChild(el('div', { class: 'p-5 text-center text-slate-400 text-sm' }, 'No data for this range'));
    return card;
  }
  const tbody = el('tbody');
  slice.forEach((r, i) => {
    let value, cls;
    if (mode === 'qty') { value = r.qty; cls = 'text-slate-700'; }
    else if (mode === 'revenue') { value = fmtMoney(r.revenue); cls = 'text-indigo-600'; }
    else if (mode === 'profit') { value = fmtMoney(r.profit); cls = 'text-emerald-600'; }
    else { value = r.marginPct.toFixed(1) + '%'; cls = r.marginPct < 20 ? 'text-red-600' : r.marginPct < 40 ? 'text-amber-600' : 'text-emerald-600'; }
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-2 text-xs text-slate-400 w-8' }, String(i + 1)),
      el('td', { class: 'px-5 py-2 text-sm text-slate-800 truncate max-w-[200px]' }, r.name),
      el('td', { class: `px-5 py-2 text-sm font-semibold text-right ${cls}` }, String(value)),
    ]));
  });
  card.appendChild(el('table', { class: 'w-full' }, [tbody]));
  return card;
}

async function renderStaff() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();
  const [ordersRes, membersRes] = await Promise.all([
    supabase.from('orders').select('id, grand_total, waiter_id, cashier_id')
      .eq('outlet_id', outletId).gte('placed_at', from).lte('placed_at', to)
      .in('status', ['paid', 'partially_paid', 'billed']),
    supabase.from('tenant_members').select('id, display_name, role').eq('tenant_id', store.state.tenant.id),
  ]);
  const memberMap = new Map((membersRes.data || []).map(m => [m.id, m]));
  const byWaiter = {}; const byCashier = {};
  (ordersRes.data || []).forEach(o => {
    if (o.waiter_id) { byWaiter[o.waiter_id] = byWaiter[o.waiter_id] || { count: 0, sales: 0 }; byWaiter[o.waiter_id].count += 1; byWaiter[o.waiter_id].sales += Number(o.grand_total || 0); }
    if (o.cashier_id) { byCashier[o.cashier_id] = byCashier[o.cashier_id] || { count: 0, sales: 0 }; byCashier[o.cashier_id].count += 1; byCashier[o.cashier_id].sales += Number(o.grand_total || 0); }
  });
  const wrap = el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-3' });
  wrap.appendChild(staffTable('Waiters', byWaiter, memberMap));
  wrap.appendChild(staffTable('Cashiers', byCashier, memberMap));
  return wrap;
}

function staffTable(title, data, memberMap) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, title),
    el('span', { class: 'text-xs text-slate-500' }, `${Object.keys(data).length} staff`),
  ]));
  const entries = Object.entries(data).sort((a, b) => b[1].sales - a[1].sales);
  if (!entries.length) {
    card.appendChild(el('div', { class: 'p-5 text-center text-slate-400 text-sm' }, 'No data'));
    return card;
  }
  const maxSales = Math.max(...entries.map(([, v]) => v.sales), 1);
  const tbody = el('tbody');
  entries.forEach(([id, v]) => {
    const m = memberMap.get(id);
    const name = m?.display_name || m?.role || 'Unknown';
    const pct = (v.sales / maxSales) * 100;
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-5 py-2.5' }, [
        el('div', { class: 'flex items-center gap-3' }, [
          el('div', { class: 'w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-xs font-bold flex items-center justify-center' }, name.charAt(0).toUpperCase()),
          el('div', { class: 'flex-1 min-w-0' }, [
            el('div', { class: 'text-sm font-medium text-slate-800 truncate' }, name),
            el('div', { class: 'text-[10px] uppercase text-slate-400' }, m?.role || '—'),
          ]),
        ]),
      ]),
      el('td', { class: 'px-5 py-2.5 text-right text-sm text-slate-600 w-16' }, String(v.count)),
      el('td', { class: 'px-5 py-2.5 text-right w-40' }, [
        el('div', { class: 'flex flex-col items-end gap-1' }, [
          el('div', { class: 'text-sm font-semibold text-slate-800' }, fmtMoney(v.sales)),
          el('div', { class: 'w-full bg-slate-100 rounded-full h-1.5 overflow-hidden' }, [
            el('div', { class: 'bg-indigo-500 h-full rounded-full', style: `width: ${pct}%` }),
          ]),
        ]),
      ]),
    ]));
  });
  card.appendChild(el('table', { class: 'w-full' }, [tbody]));
  return card;
}

async function renderCashVariance() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const [shiftsRes, cashSalesRes, purchasesRes, cashMovementsRes, supplierPaysRes, tipPayoutsRes] = await Promise.all([
    supabase.from('cash_registers').select('*').eq('outlet_id', outletId).gte('opened_at', from).order('opened_at', { ascending: false }),
    supabase.from('payments').select('amount, tip_amount, paid_at').eq('outlet_id', outletId).eq('mode', 'cash').eq('status', 'success').gte('paid_at', from).lte('paid_at', to),
    supabase.from('purchase_orders').select('grand_total, payment_mode, payment_status, created_at').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to),
    supabase.from('cash_movements').select('amount, movement_type, reason, created_at').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to),
    supabase.from('supplier_payments').select('amount, payment_mode, notes, created_at').eq('tenant_id', store.state.tenant.id).eq('payment_mode', 'cash').gte('created_at', from).lte('created_at', to),
    supabase.from('tip_payouts').select('amount, payment_mode, staff_name, created_at').eq('outlet_id', outletId).eq('payment_mode', 'cash').gte('created_at', from).lte('created_at', to)
  ]);

  const shifts = shiftsRes.data || [];
  const cashSales = cashSalesRes.data || [];
  const allPurchases = purchasesRes.data || [];
  const cashMovements = cashMovementsRes.data || [];
  const supplierPays = supplierPaysRes.data || [];
  const tipPayouts = tipPayoutsRes.data || [];

  const paidCashPurchases = allPurchases.filter(p => p.payment_status === 'paid' && p.payment_mode?.toLowerCase() === 'cash');
  const creditPurchases = allPurchases.filter(p => p.payment_status !== 'paid');
  const totalTipsIn = cashSales.reduce((s, p) => s + Number(p.tip_amount || 0), 0);
  const totalTipPayouts = tipPayouts.reduce((s, p) => s + Number(p.amount), 0);

  const totalIn = cashSales.reduce((s, p) => s + Number(p.amount), 0) + totalTipsIn;
  const totalPurchases = paidCashPurchases.reduce((s, p) => s + Number(p.grand_total), 0);
  const totalCredit = creditPurchases.reduce((s, p) => s + Number(p.grand_total), 0);
  const totalSupplierPays = supplierPays.reduce((s, p) => s + Number(p.amount), 0);
  const totalMovementsOut = cashMovements.filter(m => m.movement_type !== 'cash_in').reduce((s, m) => s + Number(m.amount), 0);
  const totalMovementsIn = cashMovements.filter(m => m.movement_type === 'cash_in').reduce((s, m) => s + Number(m.amount), 0);
  
  const totalCashOut = totalPurchases + totalSupplierPays + totalMovementsOut + totalTipPayouts;
  const netBalance = totalIn - totalCashOut + totalMovementsIn;

  const wrap = el('div', {});

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-5 gap-3 mb-4' });
  summary.appendChild(kpi('Cash Sales (In)', fmtMoney(totalIn), 'from-emerald-500 to-emerald-600', 'Collected + Tips'));
  summary.appendChild(kpi('Cash Purchases (Out)', fmtMoney(totalPurchases + totalSupplierPays), 'from-red-500 to-red-600', 'POs & Suppliers'));
  summary.appendChild(kpi('Tips Paid Out', fmtMoney(totalTipPayouts), 'from-pink-500 to-rose-500', 'To staff (Cash)'));
  summary.appendChild(kpi('Other Cash Out', fmtMoney(totalMovementsOut), 'from-amber-500 to-amber-600', 'Petty expenses'));
  summary.appendChild(kpi('Final Cash In Hand', fmtMoney(netBalance), 'from-indigo-600 to-indigo-800', 'Available balance'));
  wrap.appendChild(summary);

  const shiftSummary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-4' });
  const closed = shifts.filter(s => s.status === 'closed');
  const totalDiff = closed.reduce((s, x) => s + Number(x.cash_difference || 0), 0);
  const overCount = closed.filter(s => Number(s.cash_difference || 0) > 0.5).length;
  const shortCount = closed.filter(s => Number(s.cash_difference || 0) < -0.5).length;
  const balancedCount = closed.filter(s => Math.abs(Number(s.cash_difference || 0)) <= 0.5).length;
  shiftSummary.appendChild(kpi('Net Variance', (totalDiff > 0 ? '+' : '') + fmtMoney(totalDiff), Math.abs(totalDiff) < 1 ? 'from-emerald-500 to-emerald-600' : 'from-amber-500 to-orange-500', 'All closed shifts'));
  shiftSummary.appendChild(kpi('Balanced', String(balancedCount), 'from-emerald-500 to-emerald-600', 'Within ₹0.50'));
  shiftSummary.appendChild(kpi('Over', String(overCount), 'from-amber-500 to-orange-500', 'Counted > expected'));
  shiftSummary.appendChild(kpi('Short', String(shortCount), 'from-red-500 to-red-600', 'Counted < expected'));
  wrap.appendChild(shiftSummary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Cash Ledger'),
  ]));

  const ledger = [];
  cashSales.forEach(s => ledger.push({ date: s.paid_at, desc: 'Customer Payment', type: 'in', amount: Number(s.amount) + Number(s.tip_amount || 0) }));
  paidCashPurchases.forEach(p => ledger.push({ date: p.created_at, desc: 'Supplier Purchase', type: 'out', amount: p.grand_total }));
  supplierPays.forEach(p => ledger.push({ date: p.created_at, desc: `Supplier Payment (${p.notes || 'No notes'})`, type: 'out', amount: p.amount }));
  tipPayouts.forEach(p => ledger.push({ date: p.created_at, desc: `Tip Payout (${p.staff_name})`, type: 'out', amount: p.amount }));
  cashMovements.forEach(m => {
    const isIn = m.movement_type === 'cash_in';
    ledger.push({ date: m.created_at, desc: m.reason || `Cash ${isIn ? 'In' : 'Out'}`, type: isIn ? 'in' : 'out', amount: m.amount });
  });

  ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!ledger.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No cash transactions in this range'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  ledger.forEach(l => {
    const isIn = l.type === 'in';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(l.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-5 py-2 text-sm font-medium text-slate-700' }, l.desc),
      el('td', { class: 'px-5 py-2 text-center' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}` }, isIn ? 'IN' : 'OUT')
      ]),
      el('td', { class: `px-5 py-2 text-sm text-right font-semibold ${isIn ? 'text-emerald-600' : 'text-red-600'}` }, (isIn ? '+' : '-') + fmtMoney(l.amount)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Description'),
        el('th', { class: 'text-center px-5 py-2 font-semibold' }, 'Type'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Amount'),
      ]),
    ]),
    tbody,
  ]));
  
  wrap.appendChild(card);
  return wrap;
}


async function renderUPI() {
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

async function renderCashbookDetailed() {
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

async function renderVoidedItems() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Voided Items...</div>';
  
  const outletId = store.state.outlet?.id;
  if (!outletId) return wrapper;

  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];

  try {
    // Fetch KOTs and their items, then filter for cancelled items in JS
    const { data: kots, error } = await supabase.from('kots')
      .select('*, orders(order_number, table_name_snapshot), kot_items(*)')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Flatten and filter for cancelled items
    const voidedItems = [];
    (kots || []).forEach(k => {
        (k.kot_items || []).filter(it => it.status === 'cancelled' || it.status === 'void').forEach(it => {
            voidedItems.push({
                ...it,
                order_number: k.orders?.order_number,
                table_name: k.orders?.table_name_snapshot,
                kot_time: k.created_at,
                // Since we don't have the price in kot_items, we show 0 or fetch it. 
                // For now, we'll use a placeholder if price is not available.
                price: Number(it.unit_price || 0) 
            });
        });
    });

    const totalCount = voidedItems.length;
    const totalValue = voidedItems.reduce((sum, item) => sum + (Number(item.quantity) * item.price), 0);

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        
        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
            <div class="text-red-800 text-xs uppercase tracking-widest font-bold">Voided Items</div>
            <div class="text-3xl font-bold text-red-600 mt-1">${totalCount}</div>
            <div class="text-xs text-red-700 mt-1">Total count</div>
          </div>
          <div class="bg-slate-900 rounded-xl p-5 shadow-sm">
            <div class="text-slate-400 text-xs uppercase tracking-widest font-bold">Value Removed</div>
            <div class="text-3xl font-bold text-white mt-1">₹${totalValue.toFixed(2)}</div>
            <div class="text-xs text-slate-500 mt-1">Before taxes</div>
          </div>
        </div>

        <!-- Table -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Voided KOT Items</h3>
            <span class="text-xs text-slate-500">Items removed after being sent to kitchen</span>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th class="text-left px-5 py-3 font-semibold">Time</th>
                <th class="text-left px-5 py-3 font-semibold">Order</th>
                <th class="text-left px-5 py-3 font-semibold">Item</th>
                <th class="text-center px-5 py-3 font-semibold">Qty</th>
                <th class="text-left px-5 py-3 font-semibold">Reason</th>
                <th class="text-left px-5 py-3 font-semibold">Voided By</th>
              </tr>
            </thead>
            <tbody>
              ${voidedItems.length ? voidedItems.map(item => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td class="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">${new Date(item.kot_time).toLocaleString('en-GB', {dateStyle:'short', timeStyle:'short'})}</td>
                  <td class="px-5 py-4 text-sm text-slate-800 font-semibold">
                    #${item.order_number || 'N/A'}<br>
                    <span class="text-xs text-slate-500 font-normal">${item.table_name || 'Take-away'}</span>
                  </td>
                  <td class="px-5 py-4 text-sm text-slate-700">${item.name_snapshot}</td>
                  <td class="px-5 py-4 text-sm text-slate-800 text-center font-bold">${item.quantity}</td>
                  <td class="px-5 py-4 text-sm text-red-600 font-medium">${item.notes || 'No reason provided'}</td>
                  <td class="px-5 py-4 text-sm text-slate-500">Owner</td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="text-center py-10 text-slate-400 font-medium">No voided items in this period.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading Voided Items: ${err.message}</div>`;
  }
  return wrapper;
}

async function renderBills() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const { data: invoices, error } = await supabase.from('invoices')
    .select('id, invoice_number, grand_total, status, created_at, orders(table_name_snapshot, order_number)')
    .eq('outlet_id', outletId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  if (error) return el('div', { class: 'p-6 text-red-600 font-mono text-sm' }, 'Database Error: ' + error.message);

  if (!invoices || invoices.length === 0) {
    const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No bills found in this period'));
    return card;
  }

  const invIds = invoices.map(i => i.id);
  const { data: payments } = await supabase.from('payments').select('invoice_id, mode').in('invoice_id', invIds);

  const modeMap = new Map();
  (payments || []).forEach(p => {
    if (!modeMap.has(p.invoice_id)) modeMap.set(p.invoice_id, new Set());
    modeMap.get(p.invoice_id).add(p.mode);
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Recent Bills'),
    el('span', { class: 'text-xs text-slate-500' }, `${invoices.length} invoices`),
  ]));

  const tbody = el('tbody');
  invoices.forEach(inv => {
    const tableName = inv.orders?.table_name_snapshot || 'Takeaway';
    const time = new Date(inv.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    
    const modes = modeMap.get(inv.id) || new Set();
    const modeText = modes.size === 0 ? '—' : (modes.size > 1 ? 'SPLIT' : [...modes][0].toUpperCase());

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap' }, time),
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'font-mono text-sm font-semibold text-slate-800' }, inv.invoice_number),
        el('div', { class: 'text-xs text-slate-500' }, `#${inv.orders?.order_number || '—'}`),
      ]),
      el('td', { class: 'px-4 py-3 text-sm text-slate-700' }, tableName),
      el('td', { class: 'px-4 py-3 text-right text-sm font-semibold text-slate-800' }, fmtMoney(inv.grand_total)),
      el('td', { class: 'px-4 py-3 text-center' }, [
        el('button', {
          class: `text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide hover:ring-2 hover:ring-offset-1 transition cursor-pointer ${
            modeText === 'CASH' ? 'bg-emerald-100 text-emerald-700 ring-emerald-400' :
            modeText === 'UPI' ? 'bg-purple-100 text-purple-700 ring-purple-400' :
            modeText === 'CARD' ? 'bg-indigo-100 text-indigo-700 ring-indigo-400' :
            'bg-slate-100 text-slate-600 ring-slate-400'
          }`,
          title: 'Click to change payment mode',
          onclick: () => openModeToggleModal(inv.id, modeText)
        }, modeText)
      ]),
      el('td', { class: 'px-4 py-3 text-right' }, [
        el('button', {
          class: 'text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition',
          onclick: () => openBillReprintModal(inv.id)
        }, '🧾 View / Print')
      ])
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Bill #'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Table'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Total'),
        el('th', { class: 'text-center px-4 py-2.5 font-semibold' }, 'Mode'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));

  return card;
}

function openModeToggleModal(invoiceId, currentMode) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4' });
  
  card.appendChild(el('h3', { class: 'text-xl font-bold text-slate-800' }, 'Update Payment Mode'));
  card.appendChild(el('p', { class: 'text-sm text-slate-500' }, 'Select the correct mode for this bill. This will instantly update the Cash and UPI books.'));

  const btnContainer = el('div', { class: 'grid grid-cols-3 gap-3 pt-2 pb-2' });
  
  const handleSelect = async (newMode) => {
    try {
      overlay.remove();
      toast('Updating...', 'info', 1000);
      const { error } = await supabase.from('payments').update({ mode: newMode }).eq('invoice_id', invoiceId);
      if (error) throw error;
      toast(`Mode changed to ${newMode.toUpperCase()}`, 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error(err);
      toast('Failed to update mode: ' + err.message, 'error');
    }
  };

  const modes = [
    { id: 'cash', label: '💵 Cash', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
    { id: 'upi',  label: '📱 UPI',  color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
    { id: 'card', label: '💳 Card', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' }
  ];

  modes.forEach(m => {
    const isActive = currentMode.toLowerCase() === m.id;
    btnContainer.appendChild(el('button', {
      class: `py-3 rounded-xl border-2 font-bold transition flex flex-col items-center justify-center gap-1 ${isActive ? 'ring-2 ring-offset-2 ring-slate-400 ' + m.color : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`,
      onclick: () => {
        if (currentMode.toLowerCase() === m.id) overlay.remove();
        else handleSelect(m.id);
      }
    }, [
      el('span', { class: 'text-2xl' }, m.label.split(' ')[0]),
      el('span', { class: 'text-xs uppercase tracking-wide' }, m.id)
    ]));
  });

  card.appendChild(btnContainer);
  card.appendChild(el('button', { class: 'w-full py-2.5 rounded-lg text-slate-500 hover:bg-slate-100 text-sm font-medium transition', onclick: () => overlay.remove() }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function openBillReprintModal(invoiceId) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const loader = el('div', { class: 'bg-white rounded-2xl shadow-2xl p-8 text-center' }, [ el('div', { class: 'text-slate-400 text-sm' }, 'Loading bill...') ]);
  overlay.appendChild(loader);
  document.body.appendChild(overlay);

  try {
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
    const { data: payments } = await supabase.from('payments').select('*').eq('invoice_id', invoiceId);
    const { data: order } = await supabase.from('orders').select('*').eq('id', inv.order_id).single();
    
    let customer = null;
    if (inv.customer_id) {
      const { data: c } = await supabase.from('customers').select('*').eq('id', inv.customer_id).single();
      customer = c;
    }

    const tableName = store.state.tables.find(t => t.id === order?.table_id)?.name || order?.table_name_snapshot;
    const receiptData = buildReceiptData({
      tenant: store.state.tenant, outlet: store.state.outlet, order,
      items: items, invoice: inv, payments: payments || [], customer: customer || inv, tableName,
    });

    overlay.remove();
    const modalOverlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 overflow-y-auto' });
    const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md my-8 flex flex-col max-h-[90vh]' });
    
    card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Bill Preview'),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => modalOverlay.remove() }, '×'),
    ]));

    const body = el('div', { class: 'p-5 overflow-y-auto bg-slate-100 flex justify-center shrink' });
    const previewWrapper = el('div', { class: 'bg-white shadow-sm p-4 w-[80mm] text-black' });
    previewWrapper.innerHTML = buildReceiptHTML(receiptData);
    
    const style = el('style', {}, `
      .receipt { font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.2; color: #000; }
      .receipt .center { text-align: center; }
      .receipt .r { text-align: right; }
      .receipt .row { display: flex; justify-content: space-between; }
      .receipt table { width: 100%; border-collapse: collapse; margin: 4px 0; }
      .receipt th, .receipt td { padding: 2px 0; font-size: 12px; }
      .receipt th { border-bottom: 1px dashed #000; text-align: left; }
      .receipt hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
      .receipt .bold { font-weight: bold; }
      .receipt .big { font-size: 14px; }
    `);
    previewWrapper.appendChild(style);
    body.appendChild(previewWrapper);
    card.appendChild(body);

    const footer = el('div', { class: 'p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2' }, [
      el('button', {
        class: 'px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const orig = btn.innerHTML;
          btn.innerHTML = 'Printing...';
          btn.disabled = true;
          
          try {
            // Use the receiptData already built at the top of the function
            const { CONFIG } = await import('../../../config.js');
            const printUrl = `https://${CONFIG.LOCAL_SERVER_IP || '192.168.100.19'}:3000/api/print-bill`;
            
            const res = await fetch(printUrl, {
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(receiptData)
            });
            
            if (!res.ok) throw new Error('LAN server rejected print request');
            if (window.toast) window.toast('Bill sent to printer', 'success');
          } catch (err) {
            console.error(err);
            if (window.toast) window.toast('Print failed: ' + err.message, 'error');
          }
          
          btn.innerHTML = orig;
          btn.disabled = false;
        }
      }, '🖨️ Print')
    ]);
    card.appendChild(footer);
    modalOverlay.appendChild(card);
    document.body.appendChild(modalOverlay);
  } catch (err) {
    console.error(err);
    toast('Failed to load bill: ' + err.message, 'error');
    overlay.remove();
  }
}




async function renderProfitBook() {
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
    const validInvoices = (invoices || []).filter(inv => !noChargeOrderIds.has(inv.id));
    
    const totalFoodRevenue = validInvoices.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
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


// ============================================================
// KOT TAB RENDER LOGIC
// ============================================================
async function renderKOTsTab(root, state) {
  root.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading KOTs...</div>';
  
  const outletId = store.state.outlet?.id;
  if (!outletId) return;

  // Fetch KOTs within date range
  let query = supabase.from('kots')
    .select('*, orders(table_name_snapshot)')
    .eq('outlet_id', outletId)
    .order('created_at', { ascending: false });

  if (state.fromDate) {
    query = query.gte('created_at', new Date(state.fromDate).toISOString());
  }
  if (state.toDate) {
    const to = new Date(state.toDate);
    to.setHours(23, 59, 59, 999);
    query = query.lte('created_at', to.toISOString());
  }

  const { data: kots, error } = await query;
  if (error) {
    root.innerHTML = `<div class="text-red-500 p-4">Error loading KOTs: ${error.message}</div>`;
    return;
  }

  if (!kots || kots.length === 0) {
    root.innerHTML = '<div class="text-center py-10 text-slate-500">No KOTs found for this period.</div>';
    return;
  }

  // Build Table
  const table = el('table', { class: 'w-full text-sm text-left text-slate-600' });
  table.innerHTML = `
    <thead class="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
      <tr>
        <th class="px-4 py-3">Time</th>
        <th class="px-4 py-3">KOT #</th>
        <th class="px-4 py-3">Table</th>
        <th class="px-4 py-3">Status</th>
        <th class="px-4 py-3 text-right">Action</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  kots.forEach(k => {
    const tr = el('tr', { class: 'border-b border-slate-100 hover:bg-slate-50' });
    
    const timeStr = new Date(k.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(k.created_at).toLocaleDateString('en-GB');
    
    const tableNameRaw = k.orders?.table_name_snapshot || 'Take-away';
    const tableName = tableNameRaw.split(' - ')[0];

    tr.innerHTML = `
      <td class="px-4 py-3">
        <div class="font-medium">${dateStr}</div>
        <div class="text-xs text-slate-400">${timeStr}</div>
      </td>
      <td class="px-4 py-3 font-semibold text-slate-800">KOT-${k.kot_number}</td>
      <td class="px-4 py-3 font-medium">${tableName}</td>
      <td class="px-4 py-3">
        <span class="px-2 py-1 rounded text-xs font-semibold bg-${k.status === 'ready' ? 'emerald' : 'amber'}-100 text-${k.status === 'ready' ? 'emerald' : 'amber'}-700">
          ${k.status.toUpperCase()}
        </span>
      </td>
      <td class="px-4 py-3 text-right">
        <button class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-semibold border border-blue-200 transition">
          🖨️ Print
        </button>
      </td>
    `;

    tr.querySelector('button').onclick = async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.innerHTML = 'Printing...';
      btn.disabled = true;

      try {
        // Fetch KOT items
        const { data: items } = await supabase.from('kot_items').select('*').eq('kot_id', k.id);
        
        const payload = {
          kot: k.kot_number,
          items: (items || []).map(it => ({ 
              quantity: it.quantity, 
              name: it.name_snapshot, 
              variant: it.variant_name, 
              notes: it.notes 
          })),
          tableName: tableName,
          waiterName: k.created_by_name || 'admin'
        };
        
        await fetch('https://192.168.100.19:3000/api/print-kot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (window.toast) window.toast('KOT printed successfully', 'success');
      } catch (err) {
        console.error(err);
        if (window.toast) window.toast('Failed to print KOT', 'error');
      }

      btn.innerHTML = orig;
      btn.disabled = false;
    };

    tbody.appendChild(tr);
  });

  root.innerHTML = '';
  const wrapper = el('div', { class: 'bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden' }, [
    el('div', { class: 'px-4 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 flex justify-between items-center' }, [
      el('span', {}, 'Recent KOTs'),
      el('span', { class: 'text-xs font-normal text-slate-500' }, `${kots.length} KOTs`)
    ])
  ]);
  wrapper.appendChild(table);
  root.appendChild(wrapper);
}


// ============================================================
// KOT TAB RENDER LOGIC
// ============================================================
async function renderKOTs() {
  const root = document.getElementById('reports-content') || document.querySelector('.report-content') || document.body;
  // Fallback to finding the content area if specific ID is missing
  const container = root.querySelector('.p-4') || root; 
  
  container.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading KOTs...</div>';
  
  const outletId = store.state.outlet?.id;
  if (!outletId) return;

  // Fetch KOTs within date range (using global state if available, otherwise last 50)
  let query = supabase.from('kots')
    .select('*, orders(table_name_snapshot)')
    .eq('outlet_id', outletId)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: kots, error } = await query;
  if (error) {
    container.innerHTML = `<div class="text-red-500 p-4">Error loading KOTs: ${error.message}</div>`;
    return;
  }

  if (!kots || kots.length === 0) {
    container.innerHTML = '<div class="text-center py-10 text-slate-500">No KOTs found for this period.</div>';
    return;
  }

  // Build Table
  const table = el('table', { class: 'w-full text-sm text-left text-slate-600' });
  table.innerHTML = `
    <thead class="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
      <tr>
        <th class="px-4 py-3">Time</th>
        <th class="px-4 py-3">KOT #</th>
        <th class="px-4 py-3">Table</th>
        <th class="px-4 py-3">Status</th>
        <th class="px-4 py-3 text-right">Action</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  kots.forEach(k => {
    const tr = el('tr', { class: 'border-b border-slate-100 hover:bg-slate-50' });
    
    const timeStr = new Date(k.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(k.created_at).toLocaleDateString('en-GB');
    
    const tableNameRaw = k.orders?.table_name_snapshot || 'Take-away';
    const tableName = tableNameRaw.split(' - ')[0];

    tr.innerHTML = `
      <td class="px-4 py-3">
        <div class="font-medium">${dateStr}</div>
        <div class="text-xs text-slate-400">${timeStr}</div>
      </td>
      <td class="px-4 py-3 font-semibold text-slate-800">KOT-${k.kot_number}</td>
      <td class="px-4 py-3 font-medium">${tableName}</td>
      <td class="px-4 py-3">
        <span class="px-2 py-1 rounded text-xs font-semibold bg-${k.status === 'ready' ? 'emerald' : 'amber'}-100 text-${k.status === 'ready' ? 'emerald' : 'amber'}-700">
          ${k.status.toUpperCase()}
        </span>
      </td>
      <td class="px-4 py-3 text-right">
        <button class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-semibold border border-blue-200 transition">
          🖨️ Print
        </button>
      </td>
    `;

    tr.querySelector('button').onclick = async (e) => {
      const btn = e.currentTarget;
      const orig = btn.innerHTML;
      btn.innerHTML = 'Printing...';
      btn.disabled = true;

      try {
        // Fetch KOT items
        const { data: items } = await supabase.from('kot_items').select('*').eq('kot_id', k.id);
        
        const payload = {
          kot: k.kot_number,
          items: (items || []).map(it => ({ 
              quantity: it.quantity, 
              name: it.name_snapshot, 
              variant: it.variant_name, 
              notes: it.notes 
          })),
          tableName: tableName,
          waiterName: 'admin'
        };
        
        await fetch('https://192.168.100.19:3000/api/print-kot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (window.toast) window.toast('KOT printed successfully', 'success');
      } catch (err) {
        console.error(err);
        if (window.toast) window.toast('Failed to print KOT', 'error');
      }

      btn.innerHTML = orig;
      btn.disabled = false;
    };

    tbody.appendChild(tr);
  });

  container.innerHTML = '';
  const wrapper = el('div', { class: 'bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mt-4' }, [
    el('div', { class: 'px-4 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 flex justify-between items-center' }, [
      el('span', {}, 'Recent KOTs'),
      el('span', { class: 'text-xs font-normal text-slate-500' }, `${kots.length} KOTs`)
    ])
  ]);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}


// ============================================================
// NEW SIMPLE CASHBOOK LOGIC
// ============================================================
async function renderCashbookNew() {
  const container = document.querySelector('.report-content') || document.getElementById('reports-content') || document.body;
  container.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Cashbook...</div>';
  
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) return;

  // Use the global date picker state if available, else default to today
  const fromDate = window.state?.fromDate || new Date().toISOString().split('T')[0];
  const toDate = window.state?.toDate || new Date().toISOString().split('T')[0];

  try {
    // Fetch Sales (Money In)
    const { data: payments } = await supabase.from('payments')
      .select('*, invoices(invoice_number)')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .in('mode', ['cash', 'upi']);

    // Fetch Purchases (Money Out)
    const { data: purchases } = await supabase.from('purchases')
      .select('*, suppliers(name)')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .in('payment_mode', ['cash', 'upi']);

    const { data: supplierPays } = await supabase.from('supplier_payments')
      .select('*, suppliers(name)')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .in('payment_mode', ['cash', 'upi']);

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledgerIn = [];
    const ledgerOut = [];

    // Process Sales (IN)
    (payments || []).forEach(p => {
      const amt = Number(p.amount);
      if (p.mode === 'cash') cashIn += amt;
      if (p.mode === 'upi') upiIn += amt;
      ledgerIn.push({ date: p.created_at, desc: `Invoice #${p.invoices?.invoice_number || 'N/A'}`, mode: p.mode.toUpperCase(), amount: amt });
    });

    // Process Purchases (OUT)
    (purchases || []).forEach(p => {
      const amt = Number(p.total);
      if (p.payment_mode === 'cash') cashOut += amt;
      if (p.payment_mode === 'upi') upiOut += amt;
      ledgerOut.push({ date: p.created_at, desc: `${p.suppliers?.name || 'Supplier'} - ${p.notes || 'Purchase'}`, mode: p.payment_mode.toUpperCase(), amount: amt });
    });

    // Process Supplier Payments (OUT)
    (supplierPays || []).forEach(p => {
      const amt = Number(p.amount);
      if (p.payment_mode === 'cash') cashOut += amt;
      if (p.payment_mode === 'upi') upiOut += amt;
      ledgerOut.push({ date: p.created_at, desc: `Payment to ${p.suppliers?.name || 'Supplier'}`, mode: p.payment_mode.toUpperCase(), amount: amt });
    });

    // Sort ledgers by date
    ledgerIn.sort((a, b) => new Date(a.date) - new Date(b.date));
    ledgerOut.sort((a, b) => new Date(a.date) - new Date(b.date));

    const cashBalance = cashIn - cashOut;
    const upiBalance = upiIn - upiOut;

    // Build UI
    container.innerHTML = '';
    
    const grid = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-6xl mx-auto mt-4' });

    // LEFT COLUMN: MONEY IN
    const colIn = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' });
    colIn.appendChild(el('div', { class: 'px-4 py-3 bg-emerald-50 border-b border-emerald-100 text-emerald-800 font-bold text-sm' }, 'Money In (Sales)'));
    
    const tableIn = el('table', { class: 'w-full text-sm' });
    tableIn.innerHTML = `<thead><tr class="text-xs text-slate-500 uppercase border-b border-slate-100"><th class="text-left px-4 py-2">Time</th><th class="text-left px-4 py-2">Desc</th><th class="text-right px-4 py-2">Amount</th></tr></thead><tbody></tbody>`;
    const tbodyIn = tableIn.querySelector('tbody');
    
    ledgerIn.forEach(l => {
      tbodyIn.appendChild(el('tr', { class: 'border-b border-slate-50' }, [
        el('td', { class: 'px-4 py-2 text-xs text-slate-500' }, new Date(l.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})),
        el('td', { class: 'px-4 py-2 text-slate-700' }, l.desc),
        el('td', { class: 'px-4 py-2 text-right font-semibold text-emerald-600' }, `+₹${l.amount.toFixed(2)}`)
      ]));
    });
    if (!ledgerIn.length) tbodyIn.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-slate-400 text-xs">No sales recorded</td></tr>';
    colIn.appendChild(tableIn);

    // RIGHT COLUMN: MONEY OUT
    const colOut = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' });
    colOut.appendChild(el('div', { class: 'px-4 py-3 bg-red-50 border-b border-red-100 text-red-800 font-bold text-sm' }, 'Money Out (Purchases)'));
    
    const tableOut = el('table', { class: 'w-full text-sm' });
    tableOut.innerHTML = `<thead><tr class="text-xs text-slate-500 uppercase border-b border-slate-100"><th class="text-left px-4 py-2">Time</th><th class="text-left px-4 py-2">Desc</th><th class="text-right px-4 py-2">Amount</th></tr></thead><tbody></tbody>`;
    const tbodyOut = tableOut.querySelector('tbody');

    ledgerOut.forEach(l => {
      tbodyOut.appendChild(el('tr', { class: 'border-b border-slate-50' }, [
        el('td', { class: 'px-4 py-2 text-xs text-slate-500' }, new Date(l.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})),
        el('td', { class: 'px-4 py-2 text-slate-700' }, l.desc),
        el('td', { class: 'px-4 py-2 text-right font-semibold text-red-600' }, `-₹${l.amount.toFixed(2)}`)
      ]));
    });
    if (!ledgerOut.length) tbodyOut.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-slate-400 text-xs">No purchases recorded</td></tr>';
    colOut.appendChild(tableOut);

    grid.appendChild(colIn);
    grid.appendChild(colOut);
    container.appendChild(grid);

    // BOTTOM: BALANCES
    const summary = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-6xl mx-auto mt-6 pb-10' });
    
    summary.appendChild(el('div', { class: 'bg-slate-800 text-white rounded-xl p-5 flex justify-between items-center shadow-lg' }, [
      el('div', {}, [
        el('div', { class: 'text-slate-400 text-xs uppercase tracking-wide font-semibold' }, 'Net Cash Balance'),
        el('div', { class: 'text-3xl font-bold mt-1 text-emerald-400' }, `₹${cashBalance.toFixed(2)}`)
      ]),
      el('div', { class: 'text-right text-xs text-slate-400 space-y-1' }, [
        el('div', {}, `In: ₹${cashIn.toFixed(2)}`),
        el('div', {}, `Out: ₹${cashOut.toFixed(2)}`)
      ])
    ]));

    summary.appendChild(el('div', { class: 'bg-slate-800 text-white rounded-xl p-5 flex justify-between items-center shadow-lg' }, [
      el('div', {}, [
        el('div', { class: 'text-slate-400 text-xs uppercase tracking-wide font-semibold' }, 'Net UPI Balance'),
        el('div', { class: 'text-3xl font-bold mt-1 text-blue-400' }, `₹${upiBalance.toFixed(2)}`)
      ]),
      el('div', { class: 'text-right text-xs text-slate-400 space-y-1' }, [
        el('div', {}, `In: ₹${upiIn.toFixed(2)}`),
        el('div', {}, `Out: ₹${upiOut.toFixed(2)}`)
      ])
    ]));

    container.appendChild(summary);

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm">Error loading cashbook: ${err.message}</div>`;
  }
}


async function renderCashbook() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Cashbook...</div>';
  
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) return wrapper;

  let fromDate = new Date().toISOString().split('T')[0];
  let toDate = new Date().toISOString().split('T')[0];
  if (window.state && window.state.fromDate) fromDate = window.state.fromDate;
  if (window.state && window.state.toDate) toDate = window.state.toDate;

  try {
    const { data: payments } = await supabase.from('payments').select('*, invoices(invoice_number)').eq('outlet_id', outletId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59').in('mode', ['cash', 'upi']);
    const { data: purchases } = await supabase.from('purchases').select('*, suppliers(name)').eq('tenant_id', tenantId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59').in('payment_mode', ['cash', 'upi']);
    const { data: supplierPays } = await supabase.from('supplier_payments').select('*, suppliers(name)').eq('tenant_id', tenantId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59').in('payment_mode', ['cash', 'upi']);

    let cashIn = 0, upiIn = 0, cashOut = 0, upiOut = 0;
    const ledgerIn = [];
    const ledgerOut = [];

    (payments || []).forEach(p => {
      const amt = Number(p.amount);
      if (p.mode === 'cash') cashIn += amt;
      if (p.mode === 'upi') upiIn += amt;
      ledgerIn.push({ time: new Date(p.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), desc: `Invoice #${p.invoices?.invoice_number || 'N/A'}`, mode: p.mode.toUpperCase(), amount: amt });
    });

    (purchases || []).forEach(p => {
      const amt = Number(p.total);
      if (p.payment_mode === 'cash') cashOut += amt;
      if (p.payment_mode === 'upi') upiOut += amt;
      ledgerOut.push({ time: new Date(p.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), desc: `${p.suppliers?.name || 'Supplier'} - ${p.notes || 'Purchase'}`, mode: p.payment_mode.toUpperCase(), amount: amt });
    });

    (supplierPays || []).forEach(p => {
      const amt = Number(p.amount);
      if (p.payment_mode === 'cash') cashOut += amt;
      if (p.payment_mode === 'upi') upiOut += amt;
      ledgerOut.push({ time: new Date(p.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), desc: `Payment to ${p.suppliers?.name || 'Supplier'}`, mode: p.payment_mode.toUpperCase(), amount: amt });
    });

    const cashBalance = cashIn - cashOut;
    const upiBalance = upiIn - upiOut;

    const buildRows = (arr, isIn) => {
      if (!arr.length) return '<tr><td colspan="4" class="text-center py-6 text-slate-400 text-sm">No entries found</td></tr>';
      return arr.map(l => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
          <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${l.time}</td>
          <td class="px-4 py-3 text-sm text-slate-700">${l.desc}</td>
          <td class="px-4 py-3"><span class="px-2 py-1 rounded text-[10px] font-bold ${l.mode === 'CASH' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}">${l.mode}</span></td>
          <td class="px-4 py-3 text-sm font-semibold text-right ${isIn ? 'text-emerald-600' : 'text-red-600'}">${isIn ? '+' : '-'}₹${l.amount.toFixed(2)}</td>
        </tr>
      `).join('');
    };

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex justify-between items-center shadow-sm">
            <div>
              <div class="text-emerald-800 text-xs uppercase tracking-wide font-bold">Net Cash Balance</div>
              <div class="text-3xl font-bold mt-1 text-emerald-600">₹${cashBalance.toFixed(2)}</div>
            </div>
            <div class="text-right text-xs text-emerald-700 space-y-1 font-medium">
              <div>In: ₹${cashIn.toFixed(2)}</div>
              <div>Out: ₹${cashOut.toFixed(2)}</div>
            </div>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-5 flex justify-between items-center shadow-sm">
            <div>
              <div class="text-blue-800 text-xs uppercase tracking-wide font-bold">Net UPI Balance</div>
              <div class="text-3xl font-bold mt-1 text-blue-600">₹${upiBalance.toFixed(2)}</div>
            </div>
            <div class="text-right text-xs text-blue-700 space-y-1 font-medium">
              <div>In: ₹${upiIn.toFixed(2)}</div>
              <div>Out: ₹${upiOut.toFixed(2)}</div>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 class="font-bold text-slate-700 text-sm">Money In (Sales)</h3></div>
            <table class="w-full">
              <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-wide">
                <tr><th class="text-left px-4 py-2 font-semibold">Time</th><th class="text-left px-4 py-2 font-semibold">Desc</th><th class="text-center px-4 py-2 font-semibold">Mode</th><th class="text-right px-4 py-2 font-semibold">Amount</th></tr>
              </thead>
              <tbody>${buildRows(ledgerIn, true)}</tbody>
            </table>
          </div>
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 class="font-bold text-slate-700 text-sm">Money Out (Purchases & Payments)</h3></div>
            <table class="w-full">
              <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-wide">
                <tr><th class="text-left px-4 py-2 font-semibold">Time</th><th class="text-left px-4 py-2 font-semibold">Desc</th><th class="text-center px-4 py-2 font-semibold">Mode</th><th class="text-right px-4 py-2 font-semibold">Amount</th></tr>
              </thead>
              <tbody>${buildRows(ledgerOut, false)}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading cashbook: ${err.message}</div>`;
  }
  return wrapper;
}

// Helper for Date Navigator
function shiftDate(dateStr, days) {
    // Append 'T12:00:00' to prevent timezone shift issues when parsing YYYY-MM-DD
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}
