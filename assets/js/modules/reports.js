import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, toast } from '../utils.js';
import { buildReceiptData, buildReceiptHTML } from './receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from './printer.js';

const state = {
  tab: 'overview',
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
      el('div', { class: 'flex items-center bg-slate-100 rounded-lg p-0.5' }, [
        el('span', { class: 'px-2 text-xs font-semibold text-slate-500' }, 'From'),
        el('input', {
          type: 'date', value: state.startDate,
          class: 'px-3 py-1.5 rounded-md border-0 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium',
          onchange: (e) => { state.startDate = e.target.value; renderReports(root); }
        }),
      ]),
      el('div', { class: 'flex items-center bg-slate-100 rounded-lg p-0.5' }, [
        el('span', { class: 'px-2 text-xs font-semibold text-slate-500' }, 'To'),
        el('input', {
          type: 'date', value: state.endDate,
          class: 'px-3 py-1.5 rounded-md border-0 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium',
          onchange: (e) => { state.endDate = e.target.value; renderReports(root); }
        }),
      ]),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium ml-2',
        onclick: () => window.print(),
      }, 'Print / PDF'),
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
          onclick: async () => { state.tab = key; await renderReports(root); },
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
    inner.innerHTML = '';
    inner.appendChild(panel);
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
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const [ordersRes, itemsRes, payRes, shiftRes] = await Promise.all([
    supabase.from('orders').select('id, order_type, grand_total, placed_at, customer_id')
      .eq('outlet_id', outletId).gte('placed_at', from).lte('placed_at', to)
      .in('status', ['paid', 'partially_paid', 'billed']),
    supabase.from('order_items').select('quantity, line_total, cost_price')
      .eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to)
      .neq('status', 'cancelled'),
    supabase.from('payments').select('mode, amount, tip_amount, is_refund')
      .eq('outlet_id', outletId).gte('paid_at', from).lte('paid_at', to).eq('status', 'success'),
    supabase.from('cash_registers').select('id, status, cash_difference')
      .eq('outlet_id', outletId).gte('opened_at', from).lte('opened_at', to),
  ]);

  const orders = ordersRes.data || [];
  const items = itemsRes.data || [];
  const pays = (payRes.data || []).filter(p => !p.is_refund);
  const shifts = shiftRes.data || [];

  const gross = orders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const orderCount = orders.length;
  const itemCount = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const aov = orderCount ? gross / orderCount : 0;
  const uniqueCust = new Set(orders.map(o => o.customer_id).filter(Boolean)).size;
  const itemCost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.cost_price || 0), 0);
  const grossProfit = gross - itemCost;
  const marginPct = gross > 0 ? (grossProfit / gross) * 100 : 0;
  const totalTips = pays.reduce((s, p) => s + Number(p.tip_amount || 0), 0);
  const byMode = {};
  pays.forEach(p => { byMode[p.mode] = (byMode[p.mode] || 0) + Number(p.amount); });
  const varianceTotal = shifts.filter(s => s.status === 'closed').reduce((s, x) => s + Number(x.cash_difference || 0), 0);

  const wrap = el('div', {});
  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-4' });
  grid.appendChild(kpi('Gross Sales', fmtMoney(gross), 'from-indigo-500 to-indigo-600', `${orderCount} orders`));
  grid.appendChild(kpi('Avg Order', fmtMoney(aov), 'from-emerald-500 to-emerald-600', `${itemCount} items sold`));
  grid.appendChild(kpi('Gross Profit', fmtMoney(grossProfit), 'from-amber-500 to-orange-500', `${marginPct.toFixed(1)}% margin`));
  grid.appendChild(kpi('Unique Guests', uniqueCust, 'from-pink-500 to-rose-500', totalTips > 0 ? 'Tips ' + fmtMoney(totalTips) : 'No tips'));
  wrap.appendChild(grid);

  wrap.appendChild(el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-3' }, [
    buildPaymentModes(byMode, pays.length),
    buildOrderTypes(orders),
  ]));

  wrap.appendChild(el('div', { class: 'mt-3 bg-white rounded-xl border border-slate-200 p-5' }, [
    el('div', { class: 'flex items-center justify-between mb-3' }, [
      el('h3', { class: 'font-semibold text-slate-800' }, 'Cash Reconciliation'),
      el('span', { class: `text-xs font-semibold px-2 py-0.5 rounded-full ${Math.abs(varianceTotal) < 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}` },
        Math.abs(varianceTotal) < 1 ? 'Balanced' : 'Variance ' + fmtMoney(varianceTotal)),
    ]),
    el('div', { class: 'grid grid-cols-3 gap-4 text-sm' }, [
      el('div', {}, [
        el('div', { class: 'text-xs uppercase text-slate-500 font-semibold' }, 'Shifts'),
        el('div', { class: 'text-2xl font-bold text-slate-800 mt-1' }, shifts.length),
      ]),
      el('div', {}, [
        el('div', { class: 'text-xs uppercase text-slate-500 font-semibold' }, 'Closed'),
        el('div', { class: 'text-2xl font-bold text-slate-800 mt-1' }, shifts.filter(s => s.status === 'closed').length),
      ]),
      el('div', {}, [
        el('div', { class: 'text-xs uppercase text-slate-500 font-semibold' }, 'Net Variance'),
        el('div', { class: `text-2xl font-bold mt-1 ${Math.abs(varianceTotal) < 1 ? 'text-emerald-600' : 'text-amber-600'}` },
          (varianceTotal > 0 ? '+' : '') + fmtMoney(varianceTotal)),
      ]),
    ]),
  ]));
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
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const [salesRes, purchasesRes, supplierPaysRes, tipPayoutsRes] = await Promise.all([
    supabase.from('payments').select('amount, tip_amount, mode, paid_at').eq('outlet_id', outletId).in('mode', ['upi', 'card']).eq('status', 'success').gte('paid_at', from).lte('paid_at', to),
    supabase.from('purchase_orders').select('grand_total, payment_mode, payment_status, created_at').eq('outlet_id', outletId).gte('created_at', from).lte('created_at', to),
    supabase.from('supplier_payments').select('amount, payment_mode, notes, created_at').eq('tenant_id', store.state.tenant.id).in('payment_mode', ['upi', 'card', 'bank']).gte('created_at', from).lte('created_at', to),
    supabase.from('tip_payouts').select('amount, payment_mode, staff_name, created_at').eq('outlet_id', outletId).in('payment_mode', ['upi', 'card', 'bank']).gte('created_at', from).lte('created_at', to)
  ]);

  const sales = salesRes.data || [];
  const allPurchases = purchasesRes.data || [];
  const supplierPays = supplierPaysRes.data || [];
  const tipPayouts = tipPayoutsRes.data || [];

  const paidDigitalPurchases = allPurchases.filter(p => p.payment_status === 'paid' && ['upi', 'card', 'bank'].includes(p.payment_mode?.toLowerCase()));
  
  let upiIn = 0, cardIn = 0, digitalTips = 0;
  sales.forEach(s => {
    if (s.mode === 'upi') upiIn += Number(s.amount);
    if (s.mode === 'card') cardIn += Number(s.amount);
    digitalTips += Number(s.tip_amount || 0);
  });

  let totalTipPayouts = tipPayouts.reduce((s, p) => s + Number(p.amount), 0);
  let totalOut = paidDigitalPurchases.reduce((s, p) => s + Number(p.grand_total), 0) + supplierPays.reduce((s, p) => s + Number(p.amount), 0) + totalTipPayouts;
  
  const totalIn = upiIn + cardIn + digitalTips;
  const netBalance = totalIn - totalOut;

  const wrap = el('div', {});

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-5 gap-3 mb-4' });
  summary.appendChild(kpi('Digital Sales (In)', fmtMoney(totalIn), 'from-emerald-500 to-emerald-600', `UPI: ${fmtMoney(upiIn)} | Card: ${fmtMoney(cardIn)}`));
  summary.appendChild(kpi('Digital Purchases (Out)', fmtMoney(paidDigitalPurchases.reduce((s, p) => s + Number(p.grand_total), 0) + supplierPays.reduce((s, p) => s + Number(p.amount), 0)), 'from-red-500 to-red-600', 'POs & Suppliers'));
  summary.appendChild(kpi('Tips Paid Out', fmtMoney(totalTipPayouts), 'from-pink-500 to-rose-500', 'To staff (Digital)'));
  summary.appendChild(kpi('Digital Tips In', fmtMoney(digitalTips), 'from-purple-500 to-purple-600', 'Collected via UPI/Card'));
  summary.appendChild(kpi('Final UPI Balance', fmtMoney(netBalance), 'from-indigo-600 to-indigo-800', 'Available balance'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'UPI & Card Ledger'),
  ]));

  const ledger = [];
  sales.forEach(s => ledger.push({ type: 'in', mode: s.mode, amount: Number(s.amount) + Number(s.tip_amount || 0), date: s.paid_at, desc: 'Customer Payment' }));
  allPurchases.forEach(p => {
    if (['upi', 'card', 'bank'].includes(p.payment_mode?.toLowerCase())) ledger.push({ type: 'out', mode: p.payment_mode, amount: p.grand_total, date: p.created_at, desc: `Supplier Purchase (${p.payment_status})` });
  });
  supplierPays.forEach(p => ledger.push({ type: 'out', mode: p.payment_mode, amount: p.amount, date: p.created_at, desc: `Supplier Payment (${p.notes || 'No notes'})` }));
  tipPayouts.forEach(p => ledger.push({ type: 'out', mode: p.payment_mode, amount: p.amount, date: p.created_at, desc: `Tip Payout (${p.staff_name || 'Staff'})` }));
  ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!ledger.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No digital transactions in this range'));
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
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${l.mode === 'upi' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}` }, l.mode)
      ]),
      el('td', { class: `px-5 py-2 text-sm text-right font-semibold ${isIn ? 'text-emerald-600' : 'text-red-600'}` }, (isIn ? '+' : '-') + fmtMoney(l.amount)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Description'),
        el('th', { class: 'text-center px-5 py-2 font-semibold' }, 'Mode'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Amount'),
      ]),
    ]),
    tbody,
  ]));
  
  wrap.appendChild(card);
  return wrap;
}

async function renderCashbookDetailed() {
  const outletId = store.state.outlet.id;
  const tenantId = store.state.tenant.id;
  const toISO = rangeEnd().toISOString();
  const fromDate = rangeStart();

  const [payments, purchases, supplierPays, tipPayouts, cashMovements] = await Promise.all([
    supabase.from('payments').select('amount, tip_amount, mode, paid_at, orders(order_number)').eq('outlet_id', outletId).eq('status', 'success').lte('paid_at', toISO),
    supabase.from('purchase_orders').select('grand_total, payment_mode, payment_status, created_at, po_number').eq('outlet_id', outletId).lte('created_at', toISO),
    supabase.from('supplier_payments').select('amount, payment_mode, notes, created_at').eq('tenant_id', tenantId).lte('created_at', toISO),
    supabase.from('tip_payouts').select('amount, payment_mode, staff_name, created_at').eq('outlet_id', outletId).lte('created_at', toISO),
    supabase.from('cash_movements').select('amount, movement_type, reason, created_at').eq('outlet_id', outletId).lte('created_at', toISO)
  ]);

  const records = [];
  (payments.data || []).forEach(p => records.push({
    date: p.paid_at, type: 'Bill Payment', reference: p.orders?.order_number || 'Walk-in', mode: p.mode,
    amount: Number(p.amount), tip: Number(p.tip_amount || 0), in: Number(p.amount) + Number(p.tip_amount || 0), out: 0
  }));
  (purchases.data || []).forEach(p => {
    if (p.payment_status === 'paid') records.push({
      date: p.created_at, type: 'Supplier Purchase', reference: p.po_number, mode: p.payment_mode || 'cash', in: 0, out: Number(p.grand_total), amount: 0, tip: 0
    });
  });
  (supplierPays.data || []).forEach(p => records.push({
    date: p.created_at, type: 'Supplier Payment', reference: p.notes || '', mode: p.payment_mode, in: 0, out: Number(p.amount), amount: 0, tip: 0
  }));
  (tipPayouts.data || []).forEach(p => records.push({
    date: p.created_at, type: 'Tip Payout', reference: p.staff_name, mode: p.payment_mode, in: 0, out: Number(p.amount), amount: 0, tip: 0
  }));
  (cashMovements.data || []).forEach(m => {
    if (m.movement_type === 'tip_payout') return; // Handled by tipPayouts
    records.push({
      date: m.created_at, type: m.movement_type === 'cash_in' ? 'Cash In' : 'Cash Out', reference: m.reason || '', mode: 'cash',
      in: m.movement_type === 'cash_in' ? Number(m.amount) : 0, out: m.movement_type !== 'cash_in' ? Number(m.amount) : 0, amount: 0, tip: 0
    });
  });

  let openIn = 0, openOut = 0, periodIn = 0, periodOut = 0;
  let openCashIn=0, openCashOut=0, openUpiIn=0, openUpiOut=0, openCardIn=0, openCardOut=0;
  let periodCashIn=0, periodCashOut=0, periodUpiIn=0, periodUpiOut=0, periodCardIn=0, periodCardOut=0;
  let periodUpiBill = 0, periodUpiTips = 0, periodCashBill = 0, periodCashTips = 0;
  let billPaymentsTotal = 0, tipsInTotal = 0, supplierPaymentsTotal = 0, tipsOutTotal = 0, otherExpensesTotal = 0;

  records.forEach(r => {
    const isBefore = new Date(r.date) < fromDate;
    const mode = r.mode?.toLowerCase() || 'cash';

    if (isBefore) {
      openIn += r.in; openOut += r.out;
      if (mode === 'cash') { openCashIn += r.in; openCashOut += r.out; }
      if (mode === 'upi') { openUpiIn += r.in; openUpiOut += r.out; }
      if (mode === 'card') { openCardIn += r.in; openCardOut += r.out; }
    } else {
      periodIn += r.in; periodOut += r.out;
      if (mode === 'cash') { periodCashIn += r.in; periodCashOut += r.out; }
      if (mode === 'upi') { periodUpiIn += r.in; periodUpiOut += r.out; }
      if (mode === 'card') { periodCardIn += r.in; periodCardOut += r.out; }

      if (r.type === 'Bill Payment') {
        billPaymentsTotal += r.amount; tipsInTotal += r.tip;
        if (mode === 'upi') { periodUpiBill += r.amount; periodUpiTips += r.tip; }
        if (mode === 'cash') { periodCashBill += r.amount; periodCashTips += r.tip; }
      }
      if (r.type === 'Supplier Purchase' || r.type === 'Supplier Payment') supplierPaymentsTotal += r.out;
      if (r.type === 'Tip Payout') tipsOutTotal += r.out;
      if (r.type === 'Cash In' || r.type === 'Cash Out') otherExpensesTotal += r.out;
    }
  });

  const wrap = el('div', { class: 'max-w-5xl mx-auto space-y-6' });

  wrap.appendChild(el('h2', { class: 'text-lg font-bold text-slate-800' }, 'Opening balance (before this period, by mode below)'));
  const openTable = el('table', { class: 'w-full text-sm bg-white rounded-lg border border-slate-200 overflow-hidden' });
  openTable.appendChild(el('tbody', {}, [
    el('tr', { class: 'border-b border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-slate-600' }, 'Opening — money in (all modes)'),
      el('td', { class: 'px-4 py-2 text-right font-medium text-emerald-600' }, fmtMoney(openIn))
    ]),
    el('tr', { class: 'border-b border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-slate-600' }, 'Opening — money out (all modes)'),
      el('td', { class: 'px-4 py-2 text-right font-medium text-red-600' }, fmtMoney(openOut))
    ]),
    el('tr', { class: 'bg-slate-50 font-bold' }, [
      el('td', { class: 'px-4 py-2 text-slate-800' }, 'Opening — net (in — out)'),
      el('td', { class: 'px-4 py-2 text-right text-slate-800' }, fmtMoney(openIn - openOut))
    ])
  ]));
  wrap.appendChild(openTable);

  const ioGrid = el('div', { class: 'grid grid-cols-2 gap-4' });
  const inCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  inCard.appendChild(el('div', { class: 'px-4 py-2 bg-slate-50 border-b border-slate-200 font-bold text-emerald-600' }, '↓ Money in'));
  const inTbody = el('tbody');
  inTbody.appendChild(ioRow('Bill payments (non-deleted bills)', billPaymentsTotal));
  inTbody.appendChild(ioRow('Tips', tipsInTotal));
  inTbody.appendChild(ioRow('Total in', periodIn, true));
  inCard.appendChild(el('table', { class: 'w-full text-sm' }, [inTbody]));
  ioGrid.appendChild(inCard);

  const outCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  outCard.appendChild(el('div', { class: 'px-4 py-2 bg-slate-50 border-b border-slate-200 font-bold text-red-600' }, '↑ Money out'));
  const outTbody = el('tbody');
  outTbody.appendChild(ioRow('Expense payments', otherExpensesTotal));
  outTbody.appendChild(ioRow('Supplier payments', supplierPaymentsTotal));
  outTbody.appendChild(ioRow('Tips payments', tipsOutTotal));
  outTbody.appendChild(ioRow('Total out', periodOut, true));
  outCard.appendChild(el('table', { class: 'w-full text-sm' }, [outTbody]));
  ioGrid.appendChild(outCard);
  wrap.appendChild(ioGrid);

  const netTable = el('table', { class: 'w-full text-sm bg-white rounded-lg border border-slate-200 overflow-hidden' });
  netTable.appendChild(el('tbody', {}, [
    el('tr', { class: 'border-b border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-slate-600' }, 'Period net (money in — money out)'),
      el('td', { class: 'px-4 py-2 text-right font-medium text-slate-800' }, fmtMoney(periodIn - periodOut))
    ]),
    el('tr', { class: 'bg-slate-50 font-bold' }, [
      el('td', { class: 'px-4 py-2 text-slate-800' }, 'Closing net (opening + period)'),
      el('td', { class: 'px-4 py-2 text-right text-slate-800' }, fmtMoney((openIn - openOut) + (periodIn - periodOut)))
    ])
  ]));
  wrap.appendChild(netTable);

  wrap.appendChild(el('h2', { class: 'text-lg font-bold text-slate-800 mt-6' }, 'UPI and Cash snapshot'));
  const snapTable = el('table', { class: 'w-full text-sm bg-white rounded-lg border border-slate-200 overflow-hidden' });
  snapTable.appendChild(el('tbody', {}, [
    ioRow('UPI Bill payment', periodUpiBill),
    ioRow('UPI TIPS', periodUpiTips),
    ioRow('CASH Bill Payment', periodCashBill),
    ioRow('CASH Tips', periodCashTips)
  ]));
  wrap.appendChild(snapTable);

  wrap.appendChild(el('h2', { class: 'text-lg font-bold text-slate-800 mt-6' }, 'Ledger (all transactions in period, oldest first; balance includes opening net)'));
  const lTable = el('table', { class: 'w-full text-sm bg-white rounded-lg border border-slate-200 overflow-hidden' });
  lTable.appendChild(el('thead', { class: 'bg-slate-50 text-[10px] uppercase text-slate-500' }, [
    el('tr', {}, [
      el('th', { class: 'text-left px-4 py-2' }, 'When'),
      el('th', { class: 'text-left px-4 py-2' }, 'Type'),
      el('th', { class: 'text-left px-4 py-2' }, 'Reference'),
      el('th', { class: 'text-center px-4 py-2' }, 'Mode'),
      el('th', { class: 'text-right px-4 py-2 text-emerald-600' }, 'In (₹)'),
      el('th', { class: 'text-right px-4 py-2 text-red-600' }, 'Out (₹)'),
      el('th', { class: 'text-right px-4 py-2' }, 'Balance (₹)')
    ])
  ]));
  const periodRecords = records.filter(r => new Date(r.date) >= fromDate).sort((a,b) => new Date(a.date) - new Date(b.date));
  let runningBal = openIn - openOut;
  const lTbody = el('tbody');
  periodRecords.forEach(r => {
    runningBal += (r.in - r.out);
    lTbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(r.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2' }, r.type),
      el('td', { class: 'px-4 py-2 text-xs' }, r.reference),
      el('td', { class: 'px-4 py-2 text-center text-[10px] uppercase font-bold' }, [
        el('span', { class: `px-1.5 py-0.5 rounded ${r.mode==='cash'?'bg-emerald-100 text-emerald-700':r.mode==='upi'?'bg-purple-100 text-purple-700':'bg-indigo-100 text-indigo-700'}` }, r.mode)
      ]),
      el('td', { class: 'px-4 py-2 text-right text-emerald-600' }, r.in > 0 ? fmtMoney(r.in) : ''),
      el('td', { class: 'px-4 py-2 text-right text-red-600' }, r.out > 0 ? fmtMoney(r.out) : ''),
      el('td', { class: 'px-4 py-2 text-right font-medium' }, fmtMoney(runningBal))
    ]));
  });
  if (!periodRecords.length) {
    lTbody.appendChild(el('tr', {}, [el('td', { colspan: 7, class: 'text-center py-4 text-slate-400' }, 'No transactions in this range.')]));
  }
  lTable.appendChild(lTbody);
  wrap.appendChild(lTable);

  wrap.appendChild(el('h2', { class: 'text-lg font-bold text-slate-800 mt-6' }, 'Summary by payment mode'));
  const sumTable = el('table', { class: 'w-full text-sm bg-white rounded-lg border border-slate-200 overflow-hidden' });
  sumTable.appendChild(el('thead', { class: 'bg-slate-50 text-[10px] text-slate-500' }, [
    el('tr', {}, [
      el('th', { rowspan: 2, class: 'text-left px-4 py-2 border-r' }, 'Mode'),
      el('th', { colspan: 3, class: 'text-center py-1 border-r border-b' }, 'Opening (before period)'),
      el('th', { colspan: 3, class: 'text-center py-1 border-r border-b' }, 'This period'),
      el('th', { rowspan: 2, class: 'text-right px-4 py-2' }, 'Closing net'),
    ]),
    el('tr', {}, [
      el('th', { class: 'text-right px-2 py-1 text-emerald-600 border-r' }, 'In'),
      el('th', { class: 'text-right px-2 py-1 text-red-600 border-r' }, 'Out'),
      el('th', { class: 'text-right px-2 py-1 border-r' }, 'Net'),
      el('th', { class: 'text-right px-2 py-1 text-emerald-600 border-r' }, 'In'),
      el('th', { class: 'text-right px-2 py-1 text-red-600 border-r' }, 'Out'),
      el('th', { class: 'text-right px-2 py-1 border-r' }, 'Net'),
    ])
  ]));
  const sumTbody = el('tbody');
  const modes = ['card', 'cash', 'upi'];
  modes.forEach(m => {
    let oIn=0, oOut=0, pIn=0, pOut=0;
    if (m==='cash') { oIn=openCashIn; oOut=openCashOut; pIn=periodCashIn; pOut=periodCashOut; }
    if (m==='upi') { oIn=openUpiIn; oOut=openUpiOut; pIn=periodUpiIn; pOut=periodUpiOut; }
    if (m==='card') { oIn=openCardIn; oOut=openCardOut; pIn=periodCardIn; pOut=periodCardOut; }
    const oNet = oIn - oOut;
    const pNet = pIn - pOut;
    sumTbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-4 py-2 font-bold border-r' }, m),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(oIn)),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(oOut)),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(oNet)),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(pIn)),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(pOut)),
      el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(pNet)),
      el('td', { class: 'px-4 py-2 text-right font-bold' }, fmtMoney(oNet + pNet))
    ]));
  });
  sumTbody.appendChild(el('tr', { class: 'border-t border-slate-200 bg-slate-50 font-bold' }, [
    el('td', { class: 'px-4 py-2 border-r' }, 'Total'),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(openIn)),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(openOut)),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(openIn - openOut)),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(periodIn)),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(periodOut)),
    el('td', { class: 'px-2 py-2 text-right border-r' }, fmtMoney(periodIn - periodOut)),
    el('td', { class: 'px-4 py-2 text-right' }, fmtMoney((openIn - openOut) + (periodIn - periodOut)))
  ]));
  sumTable.appendChild(sumTbody);
  wrap.appendChild(sumTable);

  return wrap;
}

async function renderVoidedItems() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const { data, error } = await supabase.from('v_voided_items')
    .select('*')
    .eq('outlet_id', outletId)
    .gte('cancelled_at', from)
    .lte('cancelled_at', to)
    .order('cancelled_at', { ascending: false });

  const wrap = el('div', {});
  
  if (error) {
    wrap.appendChild(el('div', { class: 'p-6 text-red-600 font-mono text-sm' }, 'Database Error: ' + error.message));
    return wrap;
  }

  const totalLost = (data || []).reduce((s, item) => s + Number(item.line_total || 0), 0);

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-3 gap-3 mb-3' });
  summary.appendChild(kpi('Voided Items', String(data?.length || 0), 'from-red-500 to-red-600', 'Total count'));
  summary.appendChild(kpi('Value Removed', fmtMoney(totalLost), 'from-slate-600 to-slate-700', 'Before taxes'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Voided KOT Items'),
    el('span', { class: 'text-xs text-slate-500' }, 'Items removed after being sent to kitchen'),
  ]));

  if (!data?.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No items were voided in this period'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  data.forEach(item => {
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2 text-xs text-slate-500 whitespace-nowrap' }, new Date(item.cancelled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-4 py-2' }, [
        el('div', { class: 'font-mono text-xs font-semibold text-slate-700' }, `#${item.order_number}`),
        el('div', { class: 'text-xs text-slate-500' }, item.table_name_snapshot || 'Takeaway'),
      ]),
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, item.item_name + (item.variant_name ? ` (${item.variant_name})` : '')),
      el('td', { class: 'px-4 py-2 text-center text-sm text-slate-600' }, String(item.quantity)),
      el('td', { class: 'px-4 py-2 text-right text-sm font-semibold text-slate-800' }, fmtMoney(item.line_total)),
      el('td', { class: 'px-4 py-2 text-xs text-red-600 font-medium' }, item.cancel_reason || '—'),
      el('td', { class: 'px-4 py-2 text-xs text-slate-500' }, item.cancelled_by_name || '—'),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Time'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Order'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Item'),
        el('th', { class: 'text-center px-4 py-2.5 font-semibold' }, 'Qty'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Value'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Reason'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Voided By'),
      ]),
    ]),
    tbody,
  ]));

  wrap.appendChild(card);
  return wrap;
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

  let fromDate = new Date().toISOString().split('T')[0];
  let toDate = new Date().toISOString().split('T')[0];
  if (window.state && window.state.fromDate) fromDate = window.state.fromDate;
  if (window.state && window.state.toDate) toDate = window.state.toDate;

  try {
    const { data: invoices } = await supabase.from('invoices').select('grand_total').eq('outlet_id', outletId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59');
    const { data: periodPurchases } = await supabase.from('purchases').select('total').eq('tenant_id', tenantId).gte('created_at', fromDate + 'T00:00:00').lte('created_at', toDate + 'T23:59:59');
    const { data: suppliers } = await supabase.from('suppliers').select('id, name').eq('tenant_id', tenantId);
    const { data: allPurchases } = await supabase.from('purchases').select('supplier_id, total, payment_mode').eq('tenant_id', tenantId);
    const { data: allPayments } = await supabase.from('supplier_payments').select('supplier_id, amount').eq('tenant_id', tenantId);

    const totalRevenue = (invoices || []).reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
    const totalPurchases = (periodPurchases || []).reduce((sum, p) => sum + Number(p.total || 0), 0);
    const grossProfit = totalRevenue - totalPurchases;

    const supplierMap = new Map();
    (suppliers || []).forEach(s => supplierMap.set(s.id, { name: s.name, credit: 0, paid: 0 }));

    (allPurchases || []).forEach(p => {
      if (p.payment_mode === 'credit' && supplierMap.has(p.supplier_id)) supplierMap.get(p.supplier_id).credit += Number(p.total);
    });
    (allPayments || []).forEach(p => {
      if (supplierMap.has(p.supplier_id)) supplierMap.get(p.supplier_id).paid += Number(p.amount);
    });

    let totalOutstanding = 0;
    const outstandingList = [];
    supplierMap.forEach((val, id) => {
      const balance = val.credit - val.paid;
      if (balance > 0) {
        totalOutstanding += balance;
        outstandingList.push({ name: val.name, credit: val.credit, paid: val.paid, balance });
      }
    });
    outstandingList.sort((a, b) => b.balance - a.balance);

    const buildOutRows = () => {
      if (!outstandingList.length) return '<tr><td colspan="4" class="text-center py-8 text-slate-400 text-sm font-medium">No outstanding balances. All clear!</td></tr>';
      return outstandingList.map(s => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="px-5 py-4 text-sm font-semibold text-slate-800">${s.name}</td>
          <td class="px-5 py-4 text-sm text-right text-slate-600">₹${s.credit.toFixed(2)}</td>
          <td class="px-5 py-4 text-sm text-right text-emerald-600">₹${s.paid.toFixed(2)}</td>
          <td class="px-5 py-4 text-sm text-right font-bold text-red-600">₹${s.balance.toFixed(2)}</td>
        </tr>
      `).join('');
    };

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Revenue</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${totalRevenue.toFixed(2)}</div>
            <div class="text-xs text-slate-400 mt-2">From invoices in selected period</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div class="text-slate-500 text-xs uppercase tracking-widest font-bold">Total Purchases</div>
            <div class="text-3xl font-bold text-slate-800 mt-1">₹${totalPurchases.toFixed(2)}</div>
            <div class="text-xs text-slate-400 mt-2">From purchases in selected period</div>
          </div>
          <div class="bg-slate-900 rounded-xl p-5 shadow-sm">
            <div class="text-slate-400 text-xs uppercase tracking-widest font-bold">Gross Profit</div>
            <div class="text-3xl font-bold ${grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} mt-1">₹${grossProfit.toFixed(2)}</div>
            <div class="text-xs text-slate-500 mt-2">Revenue - Purchases</div>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-8">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <div>
              <h3 class="font-bold text-slate-800 text-sm">Outstanding Supplier Payables</h3>
              <p class="text-xs text-slate-500">Cumulative credit purchases minus payments made</p>
            </div>
            <div class="text-right">
              <div class="text-xs text-slate-500 uppercase font-bold tracking-wider">Total Owed</div>
              <div class="text-xl font-bold text-red-600">₹${totalOutstanding.toFixed(2)}</div>
            </div>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest">
              <tr><th class="text-left px-5 py-3 font-semibold">Supplier Name</th><th class="text-right px-5 py-3 font-semibold">Total Credit Purchases</th><th class="text-right px-5 py-3 font-semibold">Total Paid</th><th class="text-right px-5 py-3 font-semibold">Balance Due</th></tr>
            </thead>
            <tbody>${buildOutRows()}</tbody>
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
