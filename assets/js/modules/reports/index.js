import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, shiftDate, kpi, rangeStart, rangeEnd } from './helpers.js';

// Import all tabs
import { renderOverview } from './overview.js';
import { renderBills } from './bills.js';
import { renderCashbookDetailed } from './cashbook.js';
import { renderUPI } from './upi.js';
import { renderVoidedItems } from './voided.js';
import { renderKOTs } from './kots.js';
import { renderProfitBook } from './profitbook.js';
import { renderExpenses } from './expenses.js';
import { renderPurchaseReport } from './purchase-report.js';

export async function renderReports(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const role = store.state.member?.role || '';
  const isPurchaser = role === 'purchaser';
  const isAdmin = role === 'owner' || role === 'admin' || role === 'manager';

  // 1. Header
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
        }, '›')
      ]),
      el('button', {
          class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition',
          onclick: () => {
              const d = new Date();
              const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              state.startDate = today;
              state.endDate = today;
              renderReports(root);
          }
      }, 'Today'),
      el('button', {
          class: 'px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold shadow-sm transition',
          onclick: () => {
              state.startDate = '2000-01-01';
              state.endDate = '2099-12-31';
              renderReports(root);
          }
      }, 'All Time'),
      el('button', {
          class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition',
          onclick: () => window.print()
      }, 'Print / PDF')
    ]),
  ]);
  wrap.appendChild(header);

  // 2. Tabs
  const tabsList = [
    (isAdmin || isPurchaser) ? ['purchases', 'Purchase Report'] : null,
    !isPurchaser ? ['overview', 'Overview'] : null,
    !isPurchaser ? ['sales', 'Sales Trend'] : null,
    !isPurchaser ? ['items', 'Item Mix'] : null,
    !isPurchaser ? ['staff', 'Staff'] : null,
    !isPurchaser ? ['upi', 'UPI'] : null,
    !isPurchaser ? ['cash', 'Cashbook'] : null,
    !isPurchaser ? ['voided', 'Voided Items'] : null,
    !isPurchaser ? ['bills', 'Bills'] : null,
    !isPurchaser ? ['kots', 'KOTs'] : null,
    !isPurchaser ? ['expenses', 'Expense'] : null,
    !isPurchaser ? ['profit', 'Profit Book'] : null
  ].filter(Boolean);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    tabsList.map(([key, label]) => el('button', {
        class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
        onclick: () => { state.tab = key; localStorage.setItem('reports_active_tab', key); renderReports(root); },
    }, label))
  );
  wrap.appendChild(tabs);

  // 3. Body
  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto p-4' });
  const inner = el('div', { class: 'max-w-7xl mx-auto w-full' });
  body.appendChild(inner);
  wrap.appendChild(body);

  root.appendChild(wrap);

  // 4. Render Active Panel
  try {
    const panels = { 
      overview: renderOverview, 
      sales: renderSalesTrend, 
      items: renderItemMix, 
      staff: renderStaff, 
      cash: renderCashbookDetailed,
      upi: renderUPI,
      cashbook: renderCashbookDetailed,
      voided: renderVoidedItems,
      bills: renderBills,
      kots: renderKOTs,
      expenses: renderExpenses,
      purchases: renderPurchaseReport,
      profit: renderProfitBook
    };
    
    // Fallback for cash variance
    if (!panels[state.tab]) panels[state.tab] = renderCashbookDetailed; 

    const panel = await panels[state.tab]();
    
    if (panel && panel.nodeType === 1) {
        inner.innerHTML = '';
        inner.appendChild(panel);
    }
  } catch (err) {
    console.error('[reports]', err);
    inner.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading report: ${err.message}</div>`;
  }
}

// ==========================================
// MISSING HELPER FUNCTIONS (RESTORED HERE)
// ==========================================
function itemTable(title, rows, metric) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' }, [
    el('div', { class: 'px-4 py-3 border-b border-slate-100 bg-slate-50' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, title)
    ])
  ]);
  const tbody = el('tbody');
  
  if (rows.length === 0) {
    tbody.appendChild(el('tr', {}, [el('td', { class: 'px-4 py-4 text-sm text-slate-500 text-center', colspan: 2 }, 'No data')]));
  } else {
    rows.slice(0, 10).forEach(r => {
      let value = '';
      if (metric === 'qty') value = r.qty;
      else if (metric === 'revenue') value = fmtMoney(r.revenue);
      else if (metric === 'profit') value = fmtMoney(r.profit);
      else if (metric === 'margin') value = r.marginPct.toFixed(1) + '%';

      tbody.appendChild(el('tr', { class: 'border-b border-slate-50 last:border-0 hover:bg-slate-50' }, [
        el('td', { class: 'px-4 py-2 text-sm text-slate-700 truncate max-w-[200px]' }, r.name),
        el('td', { class: 'px-4 py-2 text-sm text-slate-800 font-medium text-right' }, value),
      ]));
    });
  }
  card.appendChild(el('table', { class: 'w-full' }, [tbody]));
  return card;
}

function staffTable(title, data, memberMap) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' }, [
    el('div', { class: 'px-4 py-3 border-b border-slate-100 bg-slate-50' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, title)
    ])
  ]);
  const tbody = el('tbody');
  const entries = Object.entries(data).sort((a, b) => b[1].sales - a[1].sales);
  
  if (entries.length === 0) {
     tbody.appendChild(el('tr', {}, [el('td', { class: 'px-4 py-4 text-sm text-slate-500 text-center', colspan: 3 }, 'No data')]));
  } else {
      entries.forEach(([id, v]) => {
        const member = memberMap.get(id);
        const name = member ? member.display_name : 'Unknown';
        tbody.appendChild(el('tr', { class: 'border-b border-slate-50 last:border-0 hover:bg-slate-50' }, [
          el('td', { class: 'px-4 py-2 text-sm text-slate-700' }, name),
          el('td', { class: 'px-4 py-2 text-sm text-slate-600 text-right' }, v.count),
          el('td', { class: 'px-4 py-2 text-sm text-slate-800 font-medium text-right' }, fmtMoney(v.sales)),
        ]));
      });
  }
  
  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-white text-[10px] uppercase text-slate-400' }, [
      el('tr', {}, [
         el('th', { class: 'px-4 py-2 text-left' }, 'Name'),
         el('th', { class: 'px-4 py-2 text-right' }, 'Orders'),
         el('th', { class: 'px-4 py-2 text-right' }, 'Sales'),
      ])
    ]),
    tbody
  ]));
  return card;
}

// ==========================================
// REPORT TABS
// ==========================================

export async function renderSalesTrend() {
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

export async function renderItemMix() {
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

export async function renderStaff() {
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