import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { state, shiftDate, kpi, rangeStart, rangeEnd } from './helpers.js';

// Import all your split tabs
import { renderOverview } from './overview.js?v=1793478710';
import { renderBills } from './bills.js?v=1793478575';
import { renderCashbookDetailed } from './cashbook.js?v=5ef7811956';
import { renderUPI } from './upi.js?v=1793478710';
import { renderVoidedItems } from './voided.js?v=1793478710';
import { renderKOTs } from './kots.js?v=1793478710';
import { renderProfitBook } from './profitbook.js?v=5ef7811956';
import { renderExpenses } from './expenses.js?v=5ef7811956';

// Hoisted fallback for Cash Variance tab
function renderCashVariance(root) { return renderCashbookDetailed(root); }



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
                const d = new Date();
                const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      ['expenses', 'Expense'],
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
      expenses: renderExpenses,
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