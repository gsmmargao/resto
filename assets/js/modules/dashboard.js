import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative, toast, confirmDialog } from '../utils.js';
import { renderMenuPanel } from './menu.js';
import { renderCartPanel, addToCart, clearCart, loadOrderIntoCart } from './cart.js';
import { renderTablesView, loadTables, renderTablePicker } from './tables.js';
import { sendKOT } from './kot.js';
import { openCheckoutModal } from './billing.js';
import { navigate } from '../router.js';

let realtimeChannel = null;

export async function renderDashboard(root) {
  root.innerHTML = '';
  try {
    await loadTables();
    await refreshOpenOrders();
  } catch (e) {
    console.error("Failed to load data", e);
  }

  const wrapper = el('div', { class: 'h-full flex flex-col' });

  // If a table is already selected, start in POS view, else start in Tables view
  const startView = store.state.cart.tableId ? 'pos' : 'tables';
  
  const subnav = el('div', { class: 'flex items-center gap-2 p-2 border-b border-slate-200 bg-white' }, [
    tab('Tables', 'tables', startView === 'tables'),
    tab('Orders', 'orders', startView === 'orders'),
    startView === 'pos' ? el('button', {
      class: 'px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 ml-auto',
      onclick: () => {
        store.state.cart.tableId = null;
        navigate('dashboard');
      },
    }, '← Back to Tables') : null,
  ].filter(Boolean));

  const content = el('div', { class: 'flex-1 min-h-0 overflow-hidden' });
  wrapper.appendChild(subnav);
  wrapper.appendChild(content);
  root.appendChild(wrapper);

  let current = startView;
  function switchView(v) {
    current = v;
    content.innerHTML = '';
    if (v === 'pos')    renderPOS(content);
    if (v === 'tables') renderTables(content);
    if (v === 'orders') renderOrders(content);
  }
  switchView(startView);

  function tab(label, key, active = false) {
    return el('button', {
      class: `px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`,
      onclick: (e) => {
        [...subnav.children].forEach(c => {
          if (c.tagName === 'BUTTON' && c.textContent !== '← Back to Tables') {
            c.className = c.className.replace('bg-indigo-600 text-white', 'text-slate-700 hover:bg-slate-100');
          }
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
      navigate('dashboard');
    }),
    onCheckout: safeCheckout,
    onSendKOT:  handleSendKOT,
    onClear:    () => { clearCart(); toast('Cart cleared', 'info', 1200); },
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

  const onCartChanged = () => paintCart();
  window.addEventListener('cart:changed', onCartChanged);

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
  renderTablesView(root, async (table, openOrder) => {
    if (openOrder) {
      const ok = await confirmDialog(
        `Table ${table.name} has an open order #${openOrder.order_number} for ${fmtMoney(openOrder.grand_total)}.\n\nLoad it into the cart?`,
        'Open order found',
      );
      if (ok) await openOrderIntoCart(openOrder.id, openOrder.order_number);
    } else {
      const ok = await confirmDialog(`Start a new order at table ${table.name}?`, 'New order');
      if (ok) {
        clearCart();
        store.state.cart.orderType = 'dine_in';
        store.state.cart.tableId = table.id;
        window.dispatchEvent(new CustomEvent('cart:changed'));
        navigate('dashboard');
      }
    }
  });
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
