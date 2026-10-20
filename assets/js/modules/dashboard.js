import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative, toast, confirmDialog } from '../utils.js';
import { renderMenuPanel } from './menu.js';
import { renderCartPanel, addToCart, clearCart, loadOrderIntoCart } from './cart.js';
import { renderTablesView, loadTables, renderTablePicker } from './tables.js';
import { sendKOT } from './kot.js';
import { openCheckoutModal } from './billing.js';
import { publishCart, startPosBridge } from './customer-display.js';
import { navigate } from '../router.js';

let realtimeChannel = null;

export async function renderDashboard(root) {
  root.innerHTML = '';
  await loadTables();
  await refreshOpenOrders();

  const wrapper = el('div', { class: 'h-full flex flex-col' });
  const subnav = el('div', { class: 'flex items-center gap-2 p-2 border-b border-slate-200 bg-white' }, [
    tab('POS', 'pos', true),
    tab('Tables', 'tables'),
    tab('Orders', 'orders'),
  ]);
  const content = el('div', { class: 'flex-1 min-h-0 overflow-hidden' });
  wrapper.appendChild(subnav);
  wrapper.appendChild(content);
  root.appendChild(wrapper);

  let current = 'pos';
  function switchView(v) {
    current = v;
    content.innerHTML = '';
    if (v === 'pos')    renderPOS(content);
    if (v === 'tables') renderTables(content);
    if (v === 'orders') renderOrders(content);
  }
  switchView('pos');

  function tab(label, key, active = false) {
    return el('button', {
      class: `px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`,
      onclick: (e) => {
        [...subnav.children].forEach(c => {
          c.className = c.className.replace('bg-indigo-600 text-white', 'text-slate-700 hover:bg-slate-100');
        });
        e.currentTarget.className = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white';
        switchView(key);
      },
    }, label);
  }

  subscribeRealtime(() => {
    loadTables().then(() => { if (current === 'tables') renderTables(content); });
    refreshOpenOrders().then(() => { if (current === 'orders') renderOrders(content); });
  });
}

async function refreshOpenOrders() {
  const outletId = store.state.outlet?.id;
  if (!outletId) return;
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, table_id, table_name_snapshot, status, grand_total, placed_at, guest_count, customer_name, order_type')
    .eq('outlet_id', outletId)
    .in('status', ['open','in_kitchen','partially_ready','ready','served','billed','partially_paid'])
    .order('placed_at', { ascending: false });
  store.set('openOrders', data || []);
}

async function openOrderIntoCart(orderId, orderNumber) {
  const loaded = await loadOrderIntoCart(orderId);
  if (!loaded) return;
  toast(`Order #${orderNumber} loaded`, 'success');
  navigate('dashboard');
}

function safeCheckout() {
  if (!store.state.cashRegister) { toast('Open a shift first (Cash menu)', 'warn'); return; }
  openCheckoutModal();
}

function renderPOS(root) {
  const layout = el('div', { class: 'h-full grid grid-cols-12 gap-0' });
  const left  = el('div', { class: 'col-span-7 lg:col-span-8 h-full flex flex-col border-r border-slate-200 min-h-0' });
  const right = el('div', { class: 'col-span-5 lg:col-span-4 h-full flex flex-col min-h-0' });

  renderMenuPanel(left, { onAddItem: ({ item, variant }) => addToCart({ item, variant }) });

  const cartOpts = {
    onPickTable: () => renderTablePicker(document.body, (t) => {
      store.state.cart.tableId = t.id;
      window.dispatchEvent(new CustomEvent('cart:changed'));
    }),
    onCheckout: safeCheckout,
    onSendKOT: handleSendKOT,
    onClear: () => { clearCart(); toast('Cart cleared', 'info', 1200); },
  };

  const paintCart = () => {
    if (!right.isConnected) return;
    right.innerHTML = '';
    renderCartPanel(right, cartOpts);
  };

  layout.appendChild(left);
  layout.appendChild(right);
  root.appendChild(layout);

  paintCart();
  requestAnimationFrame(paintCart);

  // Start the POS-side bridge (responds to display's "give me state" pings)
  startPosBridge();

  const onCartChanged = () => {
    paintCart();
    // Broadcast to any open customer display
    const cart = store.state.cart;
    const tableName = store.state.tables.find(t => t.id === cart.tableId)?.name || null;
    publishCart(cart, { tableName });
  };
  window.addEventListener('cart:changed', onCartChanged);

  // Publish an initial snapshot so a newly-opened display is in sync
  publishCart(store.state.cart, {
    tableName: store.state.tables.find(t => t.id === store.state.cart.tableId)?.name || null,
  });

  const watcher = setInterval(() => {
    if (!right.isConnected) {
      window.removeEventListener('cart:changed', onCartChanged);
      clearInterval(watcher);
    }
  }, 800);

  async function handleSendKOT() {
    const id = await sendKOT();
    if (id) { await loadTables(); await refreshOpenOrders(); }
  }

}

function renderTables(root) {
  renderTablesView(root, (table, openOrder) => {
    openTableActionModal(table, openOrder, root);
  });
}

function openTableActionModal(table, openOrder, root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3' });

  card.appendChild(el('div', { class: 'mb-2' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, `Table ${table.name}`),
    el('p', { class: 'text-xs text-slate-500' }, `Status: ${openOrder ? 'Occupied' : table.status.toUpperCase()}`)
  ]));

  // 1. If there is an active order
  if (openOrder) {
    card.appendChild(el('div', { class: 'p-3 bg-slate-50 rounded-lg border border-slate-200 mb-3' }, [
      el('div', { class: 'text-sm font-semibold text-slate-800' }, `#${openOrder.order_number}`),
      el('div', { class: 'text-xs text-slate-500' }, `Total: ${fmtMoney(openOrder.grand_total)}`)
    ]));

    card.appendChild(el('button', {
      class: 'w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: () => { overlay.remove(); openOrderIntoCart(openOrder.id, openOrder.order_number); }
    }, 'Load Order to Cart'));

    card.appendChild(el('button', {
      class: 'w-full py-2.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold text-sm',
      onclick: async () => {
        const ok = await confirmDialog('Cancel this order and clear the table? All unpainted items will be lost.', 'Cancel Order?');
        if (ok) {
          await supabase.from('orders').update({ status: 'cancelled' }).eq('id', openOrder.id);
          await supabase.from('dining_tables').update({ status: 'available', current_order_id: null }).eq('id', table.id);
          toast('Table cleared', 'success');
          overlay.remove();
          await loadTables();
          paint(root); // Repaint tables view
        }
      }
    }, 'Cancel Order & Clear Table'));

  } 
  // 2. If table is in cleaning status
  else if (table.status === 'cleaning') {
    card.appendChild(el('p', { class: 'text-sm text-slate-600 mb-4' }, 'This table is currently marked for cleaning.'));
    card.appendChild(el('button', {
      class: 'w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: async () => {
        await supabase.from('dining_tables').update({ status: 'available' }).eq('id', table.id);
        toast('Table is now available', 'success');
        overlay.remove();
        await loadTables();
        paint(root);
      }
    }, 'Mark as Available'));
  } 
  // 3. If table is available
  else {
    card.appendChild(el('button', {
      class: 'w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: () => {
        clearCart();
        store.state.cart.orderType = 'dine_in';
        store.state.cart.tableId = table.id;
        window.dispatchEvent(new CustomEvent('cart:changed'));
        overlay.remove();
        navigate('dashboard');
      }
    }, 'Start New Order'));
    
    card.appendChild(el('button', {
      class: 'w-full py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm',
      onclick: async () => {
        await supabase.from('dining_tables').update({ status: 'cleaning' }).eq('id', table.id);
        toast('Marked for cleaning', 'info');
        overlay.remove();
        await loadTables();
        paint(root);
      }
    }, 'Mark for Cleaning'));
  }

  card.appendChild(el('button', {
    class: 'w-full py-2 text-slate-400 hover:text-slate-700 text-xs mt-2',
    onclick: () => overlay.remove()
  }, 'Close'));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function renderOrders(root) {
  const orders = store.state.openOrders || [];
  const wrap = el('div', { class: 'h-full overflow-auto p-4 bg-slate-50' });
  if (!orders.length) {
    wrap.appendChild(el('div', { class: 'text-center text-slate-500 py-20 text-sm' }, 'No open orders'));
  } else {
    wrap.appendChild(el('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3' },
      orders.map(o => el('button', {
        class: 'text-left bg-white rounded-lg border border-slate-200 p-3 shadow-sm hover:border-indigo-400 hover:shadow-md transition',
        onclick: () => openOrderIntoCart(o.id, o.order_number),
      }, [
        el('div', { class: 'flex justify-between items-start' }, [
          el('div', {}, [
            el('div', { class: 'font-semibold text-slate-800' }, `#${o.order_number}`),
            el('div', { class: 'text-xs text-slate-500 mt-0.5 capitalize' },
              `${o.order_type.replace('_',' ')}${o.table_name_snapshot ? ' • ' + o.table_name_snapshot : ''}`),
          ]),
          el('span', { class: 'text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 capitalize' },
            o.status.replace('_',' ')),
        ]),
        el('div', { class: 'flex justify-between items-end mt-3' }, [
          el('div', { class: 'text-lg font-semibold text-slate-900' }, fmtMoney(o.grand_total || 0)),
          el('div', { class: 'text-xs text-slate-500' }, fmtRelative(o.placed_at) + ' ago'),
        ]),
      ])),
    ));
  }
  root.appendChild(wrap);
}

function subscribeRealtime(onChange) {
  if (realtimeChannel) return;
  const outletId = store.state.outlet?.id;
  if (!outletId) return;
  realtimeChannel = supabase
    .channel('pos-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders',        filter: `outlet_id=eq.${outletId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tables', filter: `outlet_id=eq.${outletId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kots',          filter: `outlet_id=eq.${outletId}` }, onChange)
    .subscribe();
}

export function unsubscribeRealtime() {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
}
