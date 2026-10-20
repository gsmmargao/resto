import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative } from '../utils.js';
import { cachedQuerySafe, CACHE_KEYS } from './offline-cache.js';

export async function loadTables() {
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId) return;

  const [tRes, aRes] = await Promise.all([
    cachedQuerySafe(CACHE_KEYS.tables(outletId), async () => {
      const { data, error } = await supabase.from('dining_tables').select('*')
        .eq('outlet_id', outletId).eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data || [];
    }, []),
    cachedQuerySafe(CACHE_KEYS.areas(outletId), async () => {
      const { data, error } = await supabase.from('floor_areas').select('*')
        .eq('outlet_id', outletId).order('sort_order');
      if (error) throw error;
      return data || [];
    }, []),
  ]);

  store.set('tables', tRes.data || []);
  store.set('areas',  aRes.data || []);

  // Open orders are NOT cached — they must be live. If we're offline,
  // we keep the previous state so the floor plan still renders.
  try {
    const { data, error } = await supabase.from('orders')
      .select('id, order_number, table_id, status, grand_total, placed_at, guest_count, customer_name')
      .eq('outlet_id', outletId)
      .in('status', ['open','in_kitchen','partially_ready','ready','served','billed','partially_paid']);
    if (error) throw error;
    store.set('openOrders', data || []);
  } catch (e) {
    console.warn('[tables] open orders not refreshed (offline?)');
    // Leave existing store.state.openOrders untouched
  }
}

export function renderTablesView(root, onPickTable) {
  root.innerHTML = '';
  
  // Create a strict flex container so the body can scroll independently
  const container = el('div', { class: 'h-full flex flex-col' });

  const header = el('div', { class: 'p-4 border-b border-slate-200 bg-white shrink-0 flex flex-wrap items-center justify-between gap-2' }, [
    el('h2', { class: 'text-lg font-semibold text-slate-800' }, 'Floor Plan'),
    el('div', { class: 'flex flex-wrap items-center gap-2 text-xs' }, [
      legend('bg-emerald-500', 'Available'),
      legend('bg-red-500',     'Occupied'),
      legend('bg-amber-400',   'Reserved'),
      legend('bg-slate-400',   'Cleaning'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto p-4 bg-slate-100' });

  const areas  = store.state.areas || [];
  const tables = store.state.tables || [];
  const openByTable = new Map();
  (store.state.openOrders || []).forEach(o => { if (o.table_id) openByTable.set(o.table_id, o); });

  if (!tables.length) {
    body.appendChild(el('div', { class: 'text-center text-slate-500 py-20 text-sm' }, 'No tables configured'));
  } else {
    const grouped = new Map();
    tables.forEach(t => {
      const k = t.area_id || 'unassigned';
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(t);
    });

    grouped.forEach((list, areaId) => {
      const areaName = areas.find(a => a.id === areaId)?.name || 'Main';
      body.appendChild(el('div', { class: 'mb-6' }, [
        el('h3', { class: 'text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3' }, areaName),
        el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-3' },
          list.map(t => buildCard(t, openByTable.get(t.id), onPickTable))),
      ]));
    });
  }

  container.appendChild(header);
  container.appendChild(body);
  root.appendChild(container);
}

function buildCard(table, openOrder, onPickTable) {
  const status = openOrder ? 'occupied' : (table.status || 'available');
  const color = {
    available: 'bg-emerald-500 hover:bg-emerald-600',
    occupied:  'bg-red-500 hover:bg-red-600',
    reserved:  'bg-amber-400 hover:bg-amber-500',
    cleaning:  'bg-slate-400 hover:bg-slate-500',
    blocked:   'bg-slate-500',
    merged:    'bg-purple-500',
  }[status] || 'bg-slate-400';

  return el('button', {
    class: `${color} text-white rounded-xl p-3 text-left shadow-sm transition h-28 flex flex-col justify-between`,
    onclick: () => { if (typeof onPickTable === 'function') onPickTable(table, openOrder); },
  }, [
    el('div', { class: 'flex justify-between items-start' }, [
      el('span', { class: 'font-semibold text-base' }, table.name),
      el('span', { class: 'text-[10px] uppercase opacity-90' }, `${table.capacity} pax`),
    ]),
    openOrder
      ? el('div', { class: 'text-[11px] space-y-0.5 opacity-95' }, [
          el('div', { class: 'truncate' }, `#${openOrder.order_number}`),
          el('div', { class: 'flex justify-between' }, [
            el('span', {}, fmtMoney(openOrder.grand_total || 0)),
            el('span', {}, fmtRelative(openOrder.placed_at)),
          ]),
        ])
      : el('div', { class: 'text-[11px] opacity-90' }, status),
  ]);
}

function legend(color, label) {
  return el('span', { class: 'inline-flex items-center gap-1' }, [
    el('span', { class: `inline-block w-2.5 h-2.5 rounded-sm ${color}` }),
    el('span', { class: 'text-slate-600' }, label),
  ]);
}

export function renderTablePicker(root, onPicked) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-md p-4' });
  card.appendChild(el('h3', { class: 'text-lg font-semibold text-slate-800 mb-3' }, 'Pick a table'));
  const grid = el('div', { class: 'grid grid-cols-3 gap-2 max-h-80 overflow-y-auto' });
  (store.state.tables || []).forEach(t => {
    const occupied = (store.state.openOrders || []).some(o => o.table_id === t.id);
    grid.appendChild(el('button', {
      class: `py-3 rounded-lg text-sm font-medium ${occupied ? 'bg-slate-200 text-slate-500' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`,
      onclick: () => { overlay.remove(); onPicked(t); },
    }, t.name));
  });
  card.appendChild(grid);
  card.appendChild(el('button', {
    class: 'mt-3 w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm',
    onclick: () => overlay.remove(),
  }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
