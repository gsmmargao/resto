import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative } from '../utils.js';
import { cachedQuerySafe, CACHE_KEYS } from './offline-cache.js';

export async function loadTables() {
  const outletId = store.state.outlet?.id;
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

  try {
    const { data, error } = await supabase.from('orders')
      .select('id, order_number, table_id, status, grand_total, placed_at, guest_count, customer_name, order_type, table_name_snapshot')
      .eq('outlet_id', outletId)
      .in('status', ['open','in_kitchen','partially_ready','ready','served','billed','partially_paid']);
    if (error) throw error;
    store.set('openOrders', data || []);
  } catch (e) {
    console.warn('[tables] open orders not refreshed (offline?)');
  }
}

export function renderTablesView(root, onPickTable) {
  root.innerHTML = '';
  
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
  let tables = [...(store.state.tables || [])];
  tables = tables.filter(t => !(t.is_takeaway && t.status === 'available')); 
  const openOrders = store.state.openOrders || [];
  
  const openByTable = new Map();
  openOrders.forEach(o => { if (o.table_id) openByTable.set(o.table_id, o); });

  const firstAreaId = areas[0]?.id || tables[0]?.area_id || 'unassigned';

  const activeTakeaways = openOrders.filter(o => o.order_type === 'takeaway');
  activeTakeaways.forEach(o => {
      tables.push({
          id: o.id,
          name: o.table_name_snapshot || 'Take-away',
          capacity: 1,
          status: 'occupied',
          area_id: firstAreaId,
          is_virtual_takeaway: true,
          _openOrder: o
      });
  });

  tables.unshift({
      id: 'NEW_TAKEAWAY_TRIGGER',
      name: '+ Takeaway',
      capacity: 1,
      status: 'available',
      area_id: firstAreaId,
      is_trigger: true
  });

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
          list.map(t => buildCard(t, openByTable.get(t.id) || t._openOrder, onPickTable))),
      ]));
    });
  }

  container.appendChild(header);
  container.appendChild(body);
  root.appendChild(container);

  // Start live timer updates every 10 seconds
  if (window._tablesTimerInterval) clearInterval(window._tablesTimerInterval);
  window._tablesTimerInterval = setInterval(() => {
      document.querySelectorAll('.live-timer').forEach(el => {
          const ts = el.getAttribute('data-ts');
          if (ts) {
              el.textContent = fmtRelative(ts);
          }
      });
  }, 10000);
}

function buildCard(table, openOrder, onPickTable) {
  if (table.is_trigger) {
      return el('button', {
          class: 'bg-amber-500 hover:bg-amber-600 text-white rounded-xl p-3 text-left shadow-sm transition h-28 flex flex-col justify-between',
          onclick: async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const btn = e.currentTarget;
              btn.innerHTML = '<div class="text-center font-bold mt-8 animate-pulse">Creating...</div>';
              
              try {
                  // 1. Generate Daily Sequence
                  const today = new Date().toISOString().split('T')[0];
                  let seq = parseInt(localStorage.getItem('takeaway_seq') || '0');
                  if (localStorage.getItem('takeaway_date') !== today) {
                      seq = 0;
                      localStorage.setItem('takeaway_date', today);
                  }
                  seq++;
                  localStorage.setItem('takeaway_seq', seq);
                  const name = 'Take-away ' + seq;

                  const m1Data = window.store.state.tables.find(t => t.name === 'M1');

                  // 2. Insert REAL table in DB to satisfy router
                  const { data: newTable, error } = await supabase.from('dining_tables').insert([{
                      name: name + ' - ' + new Date().toLocaleDateString('en-GB').replace(/\//g, ''),
                      capacity: 1,
                      status: 'occupied',
                      tenant_id: window.store.state.tenant.id,
                      outlet_id: window.store.state.outlet.id,
                      area_id: m1Data ? m1Data.area_id : null,
                      is_takeaway: true
                  }]).select().single();

                  if (newTable) {
                      newTable.name = name; // Override the DB name for the UI
                      // 3. Add to state and open
                      const currentTables = window.store.state.tables || [];
                      window.store.set('tables', [...currentTables, newTable]);
                      
                      if (typeof onPickTable === 'function') {
                          onPickTable(newTable, null);
                      }
                  } else {
                      console.error(error);
                      alert('Error creating takeaway: ' + (error ? error.message : 'Unknown'));
                      btn.innerHTML = '<div class="font-bold text-lg">+ Takeaway</div><div class="text-sm opacity-90 mt-2">Click to create</div>';
                  }
              } catch (err) {
                  console.error(err);
                  btn.innerHTML = '<div class="font-bold text-lg">+ Takeaway</div><div class="text-sm opacity-90 mt-2">Click to create</div>';
              }
          }
      }, [
          el('div', { class: 'flex justify-between items-start' }, [
              el('span', { class: 'font-bold text-xl' }, table.is_takeaway ? table.name.split(' - ')[0] : table.name),
              el('span', { class: 'text-xs uppercase opacity-90 font-medium' }, 'New'),
          ]),
          el('div', { class: 'text-sm opacity-90 font-medium' }, 'Click to create')
      ]);
  }

  if (table.is_virtual_takeaway) {
      return el('button', {
          class: 'bg-red-500 hover:bg-red-600 text-white rounded-xl p-3 text-left shadow-sm transition h-28 flex flex-col justify-between',
          onclick: async (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              if (window.store && openOrder) {
                  const btn = e.currentTarget;
                  const originalHtml = btn.innerHTML;
                  btn.innerHTML = '<div class="text-center font-bold mt-8 animate-pulse">Loading...</div>';

                  try {
                      // Fetch items directly to load the cart
                      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', openOrder.id);
                      const cartItems = (items || []).map(it => ({
                          menu_item_id: it.menu_item_id || it.id,
                          name: it.name_snapshot || it.description || 'Item',
                          price: Number(it.unit_price),
                          quantity: Number(it.quantity),
                          tax_rate: Number(it.tax_rate || 0)
                      }));

                      // Patch store directly
                      window.store.patch('ui', { 
                          activeTable: { id: openOrder.id, name: table.name, is_takeaway: true },
                          activeCategory: null,
                          search: ''
                      });
                      window.store.patch('cart', {
                          orderId: openOrder.id,
                          orderType: 'takeaway',
                          tableId: null,
                          tableName: table.name,
                          items: cartItems
                      });
                      
                      // Force POS tab
                      const posTab = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === 'POS');
                      if (posTab) posTab.click();
                  } catch (err) {
                      console.error(err);
                      btn.innerHTML = originalHtml;
                  }
              }
          }
      }, [
          el('div', { class: 'flex justify-between items-start' }, [
              el('span', { class: 'font-bold text-xl' }, table.is_takeaway ? table.name.split(' - ')[0] : table.name),
              el('span', { class: 'text-xs uppercase opacity-90 font-medium' }, `1 pax`),
          ]),
          openOrder ? el('div', { class: 'text-sm space-y-1 opacity-95 font-medium' }, [
              el('div', { class: 'truncate' }, `#${openOrder.order_number}`),
              el('div', { class: 'flex justify-between' }, [
                  el('span', {}, fmtMoney(openOrder.grand_total || 0)),
                  el('span', { class: 'live-timer', 'data-ts': openOrder.placed_at }, fmtRelative(openOrder.placed_at)),
              ]),
          ]) : el('div', { class: 'text-[11px] opacity-90' }, 'Occupied')
      ]);
  }

  const status = openOrder ? 'occupied' : (table.status || 'available');
  const color = {
    available: 'bg-emerald-500 hover:bg-emerald-600',
    occupied:  'bg-red-500 hover:bg-red-600',
    reserved:  'bg-amber-400 hover:bg-amber-500',
    cleaning:  'bg-slate-400 hover:bg-slate-500',
    blocked:   'bg-slate-500',
    merged:    'bg-purple-500',
  }[status] || 'bg-slate-400';

    const isTakeaway = table.is_takeaway;
  const displayName = isTakeaway ? table.name.split(' - ')[0] : table.name;

  return el('button', {
    class: `${color} text-white rounded-xl p-3 text-left shadow-sm transition h-28 flex flex-col justify-between`,
    onclick: async () => {
      // If it's a Takeaway and there's no active order (empty table)
      if (isTakeaway && !openOrder) {
          if (confirm(`This Take-away is empty. Do you want to delete it from the floor plan?`)) {
              await supabase.from('dining_tables').delete().eq('id', table.id);
              if (window.store) {
                  window.store.set('tables', window.store.state.tables.filter(t => t.id !== table.id));
              }
          }
          return;
      }
      if (typeof onPickTable === 'function') onPickTable(table, openOrder);
    },
  }, [
    el('div', { class: 'flex justify-between items-start' }, [
      el('span', { class: 'font-bold text-xl' }, displayName),
      el('span', { class: 'text-xs uppercase opacity-90 font-medium' }, `${table.capacity} pax`),
    ]),
    openOrder
      ? el('div', { class: 'text-sm space-y-1 opacity-95 font-medium' }, [
          el('div', { class: 'truncate' }, `#${openOrder.order_number}`),
          el('div', { class: 'flex justify-between' }, [
            el('span', {}, fmtMoney(openOrder.grand_total || 0)),
            el('span', { class: 'live-timer', 'data-ts': openOrder.placed_at }, fmtRelative(openOrder.placed_at)),
          ]),
        ])
      : el('div', { class: 'text-sm opacity-90 font-medium uppercase' }, status),
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
