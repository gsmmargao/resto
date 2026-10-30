import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative } from '../utils.js';
import { cachedQuerySafe, CACHE_KEYS } from './offline-cache.js';
import { openCheckoutModal } from './billing.js';
import { loadOrderIntoCart } from './cart.js';

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
      .select('id, order_number, table_id, status, grand_total, placed_at, guest_count, customer_name, customer_name_snapshot, order_type, table_name_snapshot')
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
              el('div', { class: 'truncate font-semibold' }, `#${openOrder.order_number} ${openOrder.customer_name_snapshot ? '• ' + openOrder.customer_name_snapshot : ''}`),
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
          el('div', { class: 'truncate font-semibold' }, `#${openOrder.order_number} ${openOrder.customer_name_snapshot ? '• ' + openOrder.customer_name_snapshot : ''}`),
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



export function openTableActionModal(table, openOrder, onPickTable) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden' });

  // Header
  const header = el('div', { class: 'px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50' }, [
    el('div', {}, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, table.name),
      el('p', { class: 'text-xs text-slate-500 mt-1' }, `#${openOrder.order_number} • ₹${Number(openOrder.grand_total || 0).toFixed(2)}`)
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×')
  ]);
  card.appendChild(header);

  // Body
  const body = el('div', { class: 'p-5 space-y-3 bg-slate-50' });

  // 1. Take Order (Blue)
  body.appendChild(el('button', {
    class: 'w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition shadow-sm text-sm',
    onclick: () => { overlay.remove(); if (typeof onPickTable === 'function') onPickTable(table, openOrder); }
  }, 'Take Order'));

  // 2. Generate Bill (Green)
  body.appendChild(el('button', {
    class: 'w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg transition shadow-sm text-sm',
    onclick: () => { 
        overlay.remove(); 
        // Load the table first
        if (typeof onPickTable === 'function') onPickTable(table, openOrder); 
        // Attempt to trigger the checkout button after a short delay
        setTimeout(() => {
            const checkoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Checkout'));
            if (checkoutBtn) checkoutBtn.click();
        }, 500);
    }
  }, 'Generate Bill'));

  // 3. View All KOTs (Grey)
  body.appendChild(el('button', {
    class: 'w-full py-3 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg transition shadow-sm text-sm',
    onclick: () => { overlay.remove(); openViewKOTsModal(openOrder, table.name, onPickTable); }
  }, 'View All KOTs'));

  // 4. Add Customer (White/Blue Outline)
  body.appendChild(el('button', {
    class: 'w-full py-3 border-2 border-blue-500 text-blue-500 hover:bg-blue-50 font-bold rounded-lg transition text-sm',
    onclick: () => { 
        overlay.remove(); 
        openSelectCustomerModal(openOrder, table.name); 
    }
  }, 'Add Customer'));

  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

export async function openViewKOTsModal(initialOrder, initialTableName, onPickTable) {
    const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
    const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden' });
    
    let currentOrder = initialOrder;
    let currentTableName = initialTableName;

    const header = el('div', { class: 'px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-4 shrink-0' });
    card.appendChild(header);

    const body = el('div', { class: 'p-6 overflow-y-auto bg-slate-100 flex-1 space-y-4' });
    card.appendChild(body);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function getTableObj(order, name) {
        return { id: order.table_id || order.id, name: name };
    }

    async function renderModalContent() {
        const openOrders = (window.store && window.store.state.openOrders) ? window.store.state.openOrders : [];
        const tables = openOrders.map(o => ({
            id: o.id,
            name: o.table_name_snapshot || 'Take-away'
        }));

        header.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <select id="table-selector" class="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer">
                        ${tables.map(t => `<option value="${t.id}" ${t.id === currentOrder.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                    <button class="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold text-sm rounded-lg shadow-sm transition flex items-center gap-2" id="btn-shift-table">
                        ⇅ Shift
                    </button>
                </div>
                <button class="text-slate-400 hover:text-red-500 text-3xl leading-none transition" id="close-kot-modal">&times;</button>
            </div>
            <div class="flex gap-3">
                <button id="btn-view-bill" class="flex-1 py-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-sm rounded-lg shadow-sm transition">🧾 View Bill</button>
                <button id="btn-take-order" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow-sm transition">🛍️ Take Order</button>
            </div>
        `;

        header.querySelector('#close-kot-modal').onclick = () => overlay.remove();
        
        header.querySelector('#btn-shift-table').onclick = () => {
            openShiftTableModal(currentOrder, currentTableName, () => {
                overlay.remove();
                loadTables().then(() => window.dispatchEvent(new CustomEvent('cart:changed')));
            });
        };

        header.querySelector('#table-selector').onchange = (e) => {
            const selectedOrder = openOrders.find(o => o.id === e.target.value);
            if (selectedOrder) {
                currentOrder = selectedOrder;
                currentTableName = selectedOrder.table_name_snapshot || 'Take-away';
                renderModalContent();
            }
        };

        header.querySelector('#btn-take-order').onclick = () => {
            overlay.remove();
            if (typeof onPickTable === 'function') onPickTable(getTableObj(currentOrder, currentTableName), currentOrder);
        };

        header.querySelector('#btn-view-bill').onclick = async () => {
            overlay.remove();
            if (typeof onPickTable === 'function') await onPickTable(getTableObj(currentOrder, currentTableName), currentOrder);
            setTimeout(() => {
                openCheckoutModal().catch(err => {
                    if (window.toast) window.toast('Could not open billing. Ensure items are sent to kitchen.', 'warn');
                });
            }, 400);
        };

        body.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading KOTs...</div>';

        try {
            const { data: kots } = await supabase.from('kots')
                .select('*, kot_items(*)')
                .eq('order_id', currentOrder.id)
                .order('created_at', { ascending: false });

            const { data: orderItems } = await supabase.from('order_items')
                .select('id, unit_price')
                .eq('order_id', currentOrder.id);

            const priceMap = new Map((orderItems || []).map(i => [i.id, Number(i.unit_price || 0)]));
            
            if (!kots || !kots.length) {
                body.innerHTML = '<div class="text-center py-10 text-slate-400">No KOTs found for this order.</div>';
                return;
            }

            body.innerHTML = kots.map(k => {
                const dateStr = new Date(k.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
                
                // Separate active and voided items
                const activeItems = (k.kot_items || []).filter(it => it.status !== 'void' && it.status !== 'cancelled');
                const voidedItems = (k.kot_items || []).filter(it => it.status === 'void' || it.status === 'cancelled');
                
                // Calculate Total based ONLY on active items
                const totalPrice = activeItems.reduce((sum, it) => sum + (Number(it.quantity) * (priceMap.get(it.order_item_id) || 0)), 0);
                
                const activeRows = activeItems.map(it => {
                    const price = priceMap.get(it.order_item_id) || 0;
                    return `
                    <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                        <span class="text-sm font-semibold text-slate-800">${it.quantity}x ${it.name_snapshot}</span>
                        <span class="text-sm text-slate-600 font-medium">₹${(Number(it.quantity) * price).toFixed(2)}</span>
                    </div>
                `}).join('');

                const voidedRows = voidedItems.map(it => {
                    const price = priceMap.get(it.order_item_id) || 0;
                    return `
                    <div class="flex flex-col py-2 border-b border-red-100 last:border-0 bg-red-50 px-2 rounded">
                        <div class="flex justify-between items-center line-through text-red-500">
                            <span class="text-sm font-semibold">${it.quantity}x ${it.name_snapshot}</span>
                            <span class="text-sm font-medium">₹${(Number(it.quantity) * price).toFixed(2)}</span>
                        </div>
                        ${it.notes ? `<div class="text-[10px] text-red-400 mt-1">Void Reason: ${it.notes}</div>` : ''}
                    </div>
                `}).join('');

                return `
                    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <span class="font-bold text-slate-800 text-sm">Table ${currentTableName}</span>
                                <span class="text-xs text-slate-500">${dateStr}</span>
                            </div>
                            <span class="text-xs font-bold text-slate-400">ID: ${k.kot_number || 'N/A'}</span>
                        </div>
                        <div class="p-4 space-y-1">
                            ${activeRows || '<div class="text-sm text-slate-400 italic text-center py-2">No active items</div>'}
                            ${voidedItems.length > 0 ? `
                                <div class="mt-3 pt-3 border-t border-red-100">
                                    <div class="text-[10px] font-bold text-red-500 mb-2 uppercase tracking-wider">Voided Items</div>
                                    ${voidedRows}
                                </div>
                            ` : ''}
                        </div>
                        <div class="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                            <div class="text-sm font-bold text-slate-800">Total: ₹${totalPrice.toFixed(2)}</div>
                            <div class="flex items-center gap-3">
                                <button class="text-blue-500 hover:text-blue-700 transition btn-edit" data-id="${k.id}" title="Edit KOT">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                </button>
                                <button class="text-slate-600 hover:text-slate-900 transition btn-print" data-id="${k.id}" title="Print KOT">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                </button>
                                <button class="text-emerald-500 hover:text-emerald-700 transition btn-repeat" data-id="${k.id}" title="Repeat Order">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            body.querySelectorAll('.btn-print').forEach(btn => {
                btn.onclick = async (e) => {
                    const kot = kots.find(k => k.id === e.currentTarget.getAttribute('data-id'));
                    if (!kot) return;
                    const payload = {
                        kot: kot.kot_number,
                        items: (kot.kot_items || []).filter(it => it.status !== 'void').map(it => ({ quantity: it.quantity, name: it.name_snapshot, variant: it.variant_name, notes: it.notes })),
                        tableName: currentTableName, waiterName: 'admin'
                    };
                    try {
                        await fetch('https://192.168.100.19:3000/api/print-kot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if (window.toast) window.toast('KOT printed successfully', 'success');
                    } catch (err) { if (window.toast) window.toast('Failed to print KOT', 'error'); }
                };
            });

            body.querySelectorAll('.btn-repeat').forEach(btn => {
                btn.onclick = async (e) => {
                    const kot = kots.find(k => k.id === e.currentTarget.getAttribute('data-id'));
                    if (!kot) return;
                    overlay.remove();
                    if (typeof onPickTable === 'function') await onPickTable(getTableObj(currentOrder, currentTableName), currentOrder);
                    setTimeout(() => {
                        const cart = window.store.state.cart;
                        (kot.kot_items || []).filter(it => it.status !== 'void').forEach(it => {
                            const existing = cart.items.find(i => i.item_id === it.order_item_id);
                            if (existing) existing.qty += Number(it.quantity);
                            else cart.items.push({ item_id: it.order_item_id, name: it.name_snapshot, price: priceMap.get(it.order_item_id) || 0, qty: Number(it.quantity), tax_rate: 0 });
                        });
                        window.dispatchEvent(new CustomEvent('cart:changed'));
                        if (window.toast) window.toast('Items added to cart', 'success');
                    }, 800);
                };
            });

            body.querySelectorAll('.btn-edit').forEach(btn => {
                btn.onclick = (e) => {
                    const kot = kots.find(k => k.id === e.currentTarget.getAttribute('data-id'));
                    if (!kot) return;
                    openEditKOTModal(kot, currentOrder, currentTableName, priceMap, () => renderModalContent());
                };
            });

        } catch (err) {
            console.error(err);
            body.innerHTML = '<div class="text-red-500 text-center py-10">Failed to load KOTs.</div>';
        }
    }

    renderModalContent();
}






function openShiftTableModal(currentOrder, currentTableName, onSuccess) {
    const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-[110] flex items-center justify-center p-4' });
    const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden' });
    
    // Get available physical tables
    const availableTables = (window.store.state.tables || []).filter(t => t.status === 'available');

    card.innerHTML = `
        <div class="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <div>
                <h3 class="font-bold text-lg text-slate-800">Shift Table</h3>
                <p class="text-xs text-slate-500 mt-1">Move Order #${currentOrder.order_number} from ${currentTableName}</p>
            </div>
            <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" id="close-shift-modal">&times;</button>
        </div>
        <div class="p-4 overflow-y-auto bg-slate-100 flex-1 grid grid-cols-2 gap-3">
            ${availableTables.length ? availableTables.map(t => `
                <button class="bg-white border border-slate-200 rounded-lg p-4 text-center hover:border-indigo-500 hover:shadow-md transition shift-target-btn" data-id="${t.id}" data-name="${t.name}">
                    <div class="font-bold text-slate-800 text-lg">${t.name}</div>
                    <div class="text-xs text-slate-500">${t.capacity} PAX</div>
                </button>
            `).join('') : '<div class="col-span-2 text-center py-6 text-slate-400">No available tables to shift to.</div>'}
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    card.querySelector('#close-shift-modal').onclick = () => overlay.remove();

    card.querySelectorAll('.shift-target-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const newTableId = e.currentTarget.getAttribute('data-id');
            const newTableName = e.currentTarget.getAttribute('data-name');
            
            // Confirm shift
            if (!confirm(`Move order to ${newTableName}?`)) return;

            btn.innerHTML = '<div class="text-sm font-bold text-slate-400 animate-pulse">Shifting...</div>';
            btn.disabled = true;

            try {
                // 1. Update the order
                const { error: orderErr } = await supabase.from('orders')
                    .update({ 
                        table_id: newTableId, 
                        table_name_snapshot: newTableName,
                        order_type: 'dine_in' // If it was takeaway, it becomes dine-in
                    })
                    .eq('id', currentOrder.id);
                
                if (orderErr) throw orderErr;

                // 2. Update old table (if it existed and was a real table)
                if (currentOrder.table_id) {
                    await supabase.from('dining_tables').update({ status: 'available' }).eq('id', currentOrder.table_id);
                }

                // 3. Update new table
                await supabase.from('dining_tables').update({ status: 'occupied' }).eq('id', newTableId);

                if (window.toast) window.toast('Order shifted successfully', 'success');
                overlay.remove();
                if (typeof onSuccess === 'function') onSuccess();

            } catch (err) {
                console.error(err);
                if (window.toast) window.toast('Failed to shift: ' + err.message, 'error');
                btn.innerHTML = `<div class="font-bold text-slate-800 text-lg">${newTableName}</div><div class="text-xs text-slate-500">PAX</div>`;
                btn.disabled = false;
            }
        };
    });
}



function openEditKOTModal(kot, currentOrder, currentTableName, priceMap, onSave) {
    const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4' });
    const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden' });
    
    const menuItems = (window.store.state.menuItems || []).filter(m => m.is_active !== false);

    let kotItems = [...(kot.kot_items || [])].map(it => ({
        ...it,
        original_qty: Number(it.quantity),
        unit_price: priceMap.get(it.order_item_id) || 0
    }));

    card.innerHTML = `
        <div class="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <div>
                <h3 class="font-bold text-lg text-slate-800">Edit KOT #${kot.kot_number}</h3>
                <p class="text-xs text-slate-500 mt-1">Table ${currentTableName} • #${currentOrder.order_number}</p>
            </div>
            <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" id="close-edit-modal">&times;</button>
        </div>
        
        <div class="flex-1 overflow-y-auto flex flex-col md:flex-row">
            <div class="flex-1 p-4 border-r border-slate-200 bg-white">
                <h4 class="font-bold text-slate-700 text-sm mb-3">Current Items</h4>
                <div id="current-items-list" class="space-y-2"></div>
            </div>
            <div class="flex-1 p-4 bg-slate-50">
                <h4 class="font-bold text-slate-700 text-sm mb-3">Add Menu Item</h4>
                <input type="text" id="menu-search" placeholder="Search menu..." class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <div id="menu-list" class="space-y-2 max-h-[300px] overflow-y-auto"></div>
            </div>
        </div>

        <div class="px-5 py-4 border-t border-slate-200 bg-white flex justify-end gap-3">
            <button id="btn-cancel-edit" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition">Cancel</button>
            <button id="btn-save-edit" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition">Save Changes</button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const closeBtn = card.querySelector('#close-edit-modal');
    const cancelBtn = card.querySelector('#btn-cancel-edit');
    const saveBtn = card.querySelector('#btn-save-edit');
    const currentList = card.querySelector('#current-items-list');
    const menuList = card.querySelector('#menu-list');
    const searchInput = card.querySelector('#menu-search');

    const closeModal = () => overlay.remove();
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    function renderCurrentItems() {
        if (!kotItems.length) {
            currentList.innerHTML = '<div class="text-sm text-slate-400 text-center py-4">No items. Add from the right.</div>';
            return;
        }
        currentList.innerHTML = kotItems.map((it, index) => `
            <div class="flex items-center justify-between p-3 border rounded-lg ${it.status === 'void' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}">
                <div class="flex-1">
                    <div class="font-semibold text-sm ${it.status === 'void' ? 'text-red-500 line-through' : 'text-slate-800'}">${it.name_snapshot}</div>
                    <div class="text-xs text-slate-500">₹${it.unit_price.toFixed(2)}</div>
                </div>
                <div class="flex items-center gap-2">
                    ${it.status === 'void' ? '<span class="text-xs text-red-500 font-bold px-2 py-1 bg-red-100 rounded">VOID</span>' : `
                    <button class="w-7 h-7 bg-white border border-slate-300 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100" onclick="window._editKotQty(${index}, -1)">-</button>
                    <span class="text-sm font-bold w-6 text-center">${it.quantity}</span>
                    <button class="w-7 h-7 bg-white border border-slate-300 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100" onclick="window._editKotQty(${index}, 1)">+</button>
                    <button class="ml-2 text-red-500 hover:text-red-700" onclick="window._editKotRemove(${index})" title="Void Item">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>`}
                </div>
            </div>
        `).join('');
    }

    function renderMenu(search = '') {
        const filtered = menuItems.filter(m => m.name.toLowerCase().includes(search.toLowerCase())).slice(0, 50);
        menuList.innerHTML = filtered.length ? filtered.map(m => `
            <div class="flex items-center justify-between p-2 hover:bg-white rounded-lg transition group">
                <div>
                    <div class="text-sm font-medium text-slate-800">${m.name}</div>
                    <div class="text-xs text-slate-500">₹${Number(m.price || 0).toFixed(2)}</div>
                </div>
                <button class="w-7 h-7 bg-indigo-50 text-indigo-600 rounded flex items-center justify-center hover:bg-indigo-100 opacity-0 group-hover:opacity-100 transition" onclick="window._editKotAdd('${m.id}')">+</button>
            </div>
        `).join('') : '<div class="text-sm text-slate-400 text-center py-4">No items found.</div>';
    }

    window._editKotQty = (index, change) => {
        kotItems[index].quantity = Number(kotItems[index].quantity) + change;
        if (kotItems[index].quantity <= 0) {
            window._editKotRemove(index);
        } else {
            renderCurrentItems();
        }
    };

    window._editKotRemove = (index) => {
        const reason = prompt("Enter reason for voiding this item:");
        if (reason === null) return;
        if (!reason.trim()) {
            if (window.toast) window.toast('Void reason is required', 'warn');
            return;
        }
        kotItems[index].status = 'void';
        kotItems[index].void_reason = reason.trim();
        renderCurrentItems();
    };

    window._editKotAdd = (menuId) => {
        const m = menuItems.find(x => x.id === menuId);
        if (!m) return;
        const existing = kotItems.find(i => i.item_id === m.id && i.status !== 'void');
        if (existing) existing.quantity = Number(existing.quantity) + 1;
        else kotItems.push({ id: 'new-' + Date.now(), kot_id: kot.id, item_id: m.id, name_snapshot: m.name, quantity: 1, unit_price: Number(m.price), status: 'pending', is_new: true });
        renderCurrentItems();
    };

    searchInput.oninput = (e) => renderMenu(e.target.value);

    saveBtn.onclick = async () => {
        saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

        try {
            // 1. Process Voids
            const voidedItems = kotItems.filter(i => i.status === 'void' && !i.is_new);
            for (const item of voidedItems) {
                await supabase.from('order_items').update({ status: 'void', notes: item.void_reason }).eq('id', item.order_item_id);
                await supabase.from('kot_items').update({ status: 'cancelled', notes: item.void_reason }).eq('id', item.id);
            }

            // 2. Process Updates (Quantity changes)
            const updatedItems = kotItems.filter(i => i.status !== 'void' && !i.is_new && Number(i.quantity) !== i.original_qty);
            for (const item of updatedItems) {
                await supabase.from('order_items').update({ quantity: Number(item.quantity), line_total: Number(item.quantity) * item.unit_price }).eq('id', item.order_item_id);
                await supabase.from('kot_items').update({ quantity: Number(item.quantity) }).eq('id', item.id);
            }

            // 3. Process New Items
            const newItems = kotItems.filter(i => i.is_new && i.status !== 'void');
            for (const item of newItems) {
                const { data: newOrderItem } = await supabase.from('order_items').insert({
                    tenant_id: window.store.state.tenant.id,
                    outlet_id: window.store.state.outlet.id,
                    order_id: currentOrder.id,
                    item_id: item.item_id,
                    name_snapshot: item.name_snapshot,
                    quantity: Number(item.quantity),
                    unit_price: item.unit_price,
                    line_total: Number(item.quantity) * item.unit_price,
                    status: 'pending'
                }).select().single();

                if (newOrderItem) {
                    await supabase.from('kot_items').insert({
                        tenant_id: window.store.state.tenant.id,
                        kot_id: kot.id,
                        order_item_id: newOrderItem.id,
                        name_snapshot: item.name_snapshot,
                        quantity: Number(item.quantity),
                        status: 'pending'
                    });
                }
            }

            // 4. Recalculate Order Totals
            await supabase.rpc('recalc_order', { order_id: currentOrder.id });

            // 5. Refresh POS Cart if this order is active
            if (window.store && window.store.state.cart && window.store.state.cart.orderId === currentOrder.id) {
                const { data: freshItems } = await supabase.from('order_items').select('*').eq('order_id', currentOrder.id).neq('status', 'void');
                const { data: freshOrder } = await supabase.from('orders').select('*').eq('id', currentOrder.id).single();

                if (freshItems && freshOrder) {
                    const cartItems = freshItems.map(it => ({
                        menu_item_id: it.item_id,
                        item_id: it.item_id,
                        name: it.name_snapshot,
                        price: Number(it.unit_price),
                        qty: Number(it.quantity),
                        tax_rate: Number(it.tax_rate || 0)
                    }));

                    window.store.patch('cart', { items: cartItems });
                    
                    // Update grand total from the recalculated order
                    window.store.patch('cart', {
                        totals: { ...window.store.state.cart.totals, grand: Number(freshOrder.grand_total) }
                    });

                    window.dispatchEvent(new CustomEvent('cart:changed'));
                }
            }

            if (window.toast) window.toast('KOT Updated successfully', 'success');
            overlay.remove();
            if (typeof onSave === 'function') onSave();

        } catch (err) {
            console.error(err);
            if (window.toast) window.toast('Failed to update KOT: ' + err.message, 'error');
            saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
        }
    };

    renderCurrentItems();
    renderMenu();
}



function openSelectCustomerModal(order, tableName) {
    const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4' });
    const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden' });
    
    card.innerHTML = `
        <div class="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <h3 class="font-bold text-lg text-slate-800">Select Customer — ${tableName}</h3>
            <button class="text-slate-400 hover:text-slate-700 text-2xl leading-none" id="close-cust-modal">&times;</button>
        </div>
        
        <div class="p-5 space-y-4">
            <!-- Search Existing -->
            <div>
                <select id="existing-cust-select" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">-- Search existing customer --</option>
                </select>
            </div>
            
            <div class="flex justify-end">
                <button id="btn-save-existing" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition">Save Selection</button>
            </div>

            <hr class="border-slate-200">

            <!-- New Customer -->
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">New Customer Name</label>
                    <input type="text" id="new-cust-name" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Enter name">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Customer Phone Number</label>
                    <input type="tel" id="new-cust-phone" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Enter phone">
                </div>
                <button id="btn-create-cust" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition">+ Create New Customer</button>
            </div>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const selectEl = card.querySelector('#existing-cust-select');
    const nameIn = card.querySelector('#new-cust-name');
    const phoneIn = card.querySelector('#new-cust-phone');

    card.querySelector('#close-cust-modal').onclick = () => overlay.remove();

    // Fetch existing customers
    (async () => {
        const { data: customers } = await supabase.from('customers')
            .select('id, name, phone')
            .eq('tenant_id', window.store.state.tenant.id)
            .order('name');
        
        if (customers) {
            customers.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.name} (${c.phone || 'No phone'})`;
                selectEl.appendChild(opt);
            });
        }
    })();

    // Helper to update the order
    async function updateOrderCustomer(customerId, customerName, customerPhone) {
        try {
            await supabase.from('orders').update({
                customer_id: customerId,
                customer_name_snapshot: customerName,
                customer_phone_snapshot: customerPhone
            }).eq('id', order.id);

            // Update local state so the UI reflects immediately
            const orderIndex = window.store.state.openOrders.findIndex(o => o.id === order.id);
            if (orderIndex !== -1) {
                window.store.state.openOrders[orderIndex].customer_name_snapshot = customerName;
                window.store.state.openOrders[orderIndex].customer_id = customerId;
            }

            window.dispatchEvent(new CustomEvent('floorplan:reload'));
            window.dispatchEvent(new CustomEvent('floorplan:reload'));
            if (window.toast) window.toast('Customer updated', 'success');
            overlay.remove();
            
            // Force a complete reload of the tables and re-render the UI
            await loadTables();
            if (typeof window.renderTables === 'function') window.renderTables(); // Trigger dashboard re-render
            window.dispatchEvent(new CustomEvent('cart:changed'));
        } catch (err) {
            console.error(err);
            if (window.toast) window.toast('Failed to update customer', 'error');
        }
    }

    // Save Existing
    card.querySelector('#btn-save-existing').onclick = async () => {
        const selectedId = selectEl.value;
        if (!selectedId) {
            if (window.toast) window.toast('Please select a customer', 'warn');
            return;
        }
        const selectedOption = selectEl.options[selectEl.selectedIndex];
        const name = selectedOption.textContent.split(' (')[0];
        const phone = selectedOption.textContent.includes('(') ? selectedOption.textContent.split('(')[1].replace(')', '') : null;
        
        await updateOrderCustomer(selectedId, name, phone);
    };

    // Create New
    card.querySelector('#btn-create-cust').onclick = async () => {
        const name = nameIn.value.trim();
        const phone = phoneIn.value.trim();
        if (!name) {
            if (window.toast) window.toast('Customer Name is required', 'warn');
            return;
        }

        card.querySelector('#btn-create-cust').textContent = 'Creating...';

        const { data: newCust, error } = await supabase.from('customers').insert({
            tenant_id: window.store.state.tenant.id,
            name: name,
            phone: phone || null
        }).select().single();

        if (error) {
            if (window.toast) window.toast('Failed to create customer: ' + error.message, 'error');
            card.querySelector('#btn-create-cust').textContent = '+ Create New Customer';
            return;
        }

        await updateOrderCustomer(newCust.id, name, phone);
    };
}
