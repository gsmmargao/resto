import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney } from '../utils.js';

const state = { tab: 'overview', range: 7 };

const RANGES = [
  { days: 1,  label: 'Today' },
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export async function renderReports(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Reports'),
      el('p', { class: 'text-xs text-slate-500' }, store.state.outlet?.name || ''),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('div', { class: 'flex bg-slate-100 rounded-lg p-0.5' },
        RANGES.map(r => el('button', {
          class: `px-3 py-1.5 text-xs font-medium rounded-md transition ${state.range === r.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`,
          onclick: async () => { state.range = r.days; await renderReports(root); },
        }, r.label)),
      ),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium',
        onclick: () => window.print(),
      }, 'Print / PDF'),
    ]),
  ]);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    [['overview', 'Overview'], ['sales', 'Sales Trend'], ['items', 'Item Mix'], ['staff', 'Staff'], ['cash', 'Cash']]
      .map(([key, label]) =>
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
    const panels = { overview: renderOverview, sales: renderSalesTrend, items: renderItemMix, staff: renderStaff, cash: renderCashVariance };
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
  const d = new Date();
  d.setDate(d.getDate() - (state.range - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function rangeEnd() {
  const d = new Date();
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
  for (let i = state.range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
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
  const { data: shifts } = await supabase.from('cash_registers').select('*')
    .eq('outlet_id', outletId).gte('opened_at', from).order('opened_at', { ascending: false });

  const wrap = el('div', {});
  const closed = (shifts || []).filter(s => s.status === 'closed');
  const totalDiff = closed.reduce((s, x) => s + Number(x.cash_difference || 0), 0);
  const overCount = closed.filter(s => Number(s.cash_difference || 0) > 0.5).length;
  const shortCount = closed.filter(s => Number(s.cash_difference || 0) < -0.5).length;
  const balancedCount = closed.filter(s => Math.abs(Number(s.cash_difference || 0)) <= 0.5).length;

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3 mb-3' });
  summary.appendChild(kpi('Net Variance', (totalDiff > 0 ? '+' : '') + fmtMoney(totalDiff), Math.abs(totalDiff) < 1 ? 'from-emerald-500 to-emerald-600' : 'from-amber-500 to-orange-500', 'All closed shifts'));
  summary.appendChild(kpi('Balanced', String(balancedCount), 'from-emerald-500 to-emerald-600', 'Within ₹0.50'));
  summary.appendChild(kpi('Over', String(overCount), 'from-amber-500 to-orange-500', 'Counted > expected'));
  summary.appendChild(kpi('Short', String(shortCount), 'from-red-500 to-red-600', 'Counted < expected'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Shift History'),
  ]));

  if (!closed.length) {
    card.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No closed shifts in this range'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  closed.forEach(s => {
    const diff = Number(s.cash_difference || 0);
    const diffCls = Math.abs(diff) < 0.5 ? 'text-slate-500' : diff > 0 ? 'text-amber-600' : 'text-red-600';
    const closedAt = s.closed_at ? new Date(s.closed_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-2 text-xs text-slate-500 whitespace-nowrap' }, closedAt),
      el('td', { class: 'px-5 py-2 text-sm font-medium text-slate-700' }, s.shift_name || '—'),
      el('td', { class: 'px-5 py-2 text-sm text-right text-slate-600' }, fmtMoney(s.opening_balance)),
      el('td', { class: 'px-5 py-2 text-sm text-right text-slate-700' }, fmtMoney(s.total_sales)),
      el('td', { class: 'px-5 py-2 text-sm text-right text-slate-500' }, fmtMoney(s.expected_cash)),
      el('td', { class: 'px-5 py-2 text-sm text-right text-slate-700' }, fmtMoney(s.counted_cash)),
      el('td', { class: `px-5 py-2 text-sm text-right font-semibold ${diffCls}` }, (diff > 0 ? '+' : '') + fmtMoney(diff)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Closed'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Shift'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Float'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Sales'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Expected'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Counted'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Diff'),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);
  return wrap;
}
