import { store } from '../store.js';
import { el, fmtMoney } from '../utils.js';

// ============================================================
// BROADCAST CHANNEL — shared between POS and Display
// ============================================================
const CHANNEL_NAME = 'resto-customer-display';

let _posChannel = null;   // POS-side sender
let _displayChannel = null; // Display-side receiver

function getPosChannel() {
  if (!_posChannel) _posChannel = new BroadcastChannel(CHANNEL_NAME);
  return _posChannel;
}

function getDisplayChannel() {
  if (!_displayChannel) _displayChannel = new BroadcastChannel(CHANNEL_NAME);
  return _displayChannel;
}

// ============================================================
// POS-SIDE PUBLISHERS
// ============================================================

/** Publish the current cart contents to any open display window. */
export function publishCart(cart, { tableName = null } = {}) {
  const items = (cart?.items || []).map(l => ({
    name: l.name,
    variantName: l.variantName,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineTotal: l.qty * l.unitPrice,
  }));

  const totals = cart?.totals || { gross: 0, tax: 0, discount: 0, grand: 0 };
  const hasItems = items.length > 0;

  getPosChannel().postMessage({
    type: 'cart:update',
    payload: {
      items,
      totals,
      tableName,
      orderType: cart?.orderType || 'dine_in',
      state: hasItems ? 'active' : 'idle',
      tenant: {
        name: store.state.tenant?.name,
        logo_url: store.state.tenant?.logo_url,
        brand_color: store.state.tenant?.brand_color,
      },
      outlet: {
        name: store.state.outlet?.name,
      },
      at: Date.now(),
    },
  });
}

/** Show a "thank you" splash. */
export function publishThankYou({ orderNumber, grandTotal } = {}) {
  getPosChannel().postMessage({
    type: 'cart:thankyou',
    payload: { orderNumber, grandTotal, at: Date.now() },
  });
}

/** Clear the display (back to welcome). */
export function publishIdle() {
  getPosChannel().postMessage({ type: 'cart:idle', at: Date.now() });
}

// ============================================================
// DISPLAY VIEW
// ============================================================
let _displayUnsub = null;

export async function renderCustomerDisplay(root) {
  // Tear down any previous state
  if (_displayUnsub) { try { _displayUnsub(); } catch {} _displayUnsub = null; }

  document.body.classList.add('overflow-hidden');

  let current = {
    state: 'idle',
    items: [],
    totals: { gross: 0, tax: 0, discount: 0, grand: 0 },
    tableName: null,
    orderType: 'dine_in',
    tenant: { name: 'Restaurant' },
    outlet: {},
  };

  root.innerHTML = '';
  const wrap = el('div', { class: 'h-screen w-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white overflow-hidden' });

  // ---- Header ----
  const header = el('div', { class: 'flex items-center justify-between px-8 py-5 shrink-0 border-b border-white/10' });
  wrap.appendChild(header);

  // ---- Body (items) ----
  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-8 py-4' });
  wrap.appendChild(body);

  // ---- Footer (totals) ----
  const footer = el('div', { class: 'shrink-0 border-t border-white/10 bg-black/30' });
  wrap.appendChild(footer);

  root.appendChild(wrap);

  // ---- Welcome overlay (idle state) ----
  const welcome = el('div', { class: 'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 z-20 transition-opacity duration-500' });
  wrap.style.position = 'relative';
  wrap.appendChild(welcome);

  // ---- Thankyou overlay ----
  const thankyou = el('div', { class: 'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 z-30 opacity-0 pointer-events-none transition-opacity duration-500' });
  wrap.appendChild(thankyou);

  // ---- Render helpers ----
  function repaint() {
    paintHeader();
    paintBody();
    paintFooter();
    paintWelcome();
  }

  function paintHeader() {
    header.innerHTML = '';
    const name = current.tenant?.name || 'Restaurant';
    const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

    header.appendChild(el('div', { class: 'flex items-center gap-4' }, [
      el('div', { class: 'w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center font-bold text-xl backdrop-blur' }, initials),
      el('div', {}, [
        el('div', { class: 'text-xl font-bold leading-tight' }, name),
        current.outlet?.name ? el('div', { class: 'text-xs text-white/60 mt-0.5' }, current.outlet.name) : null,
      ].filter(Boolean)),
    ]));

    header.appendChild(el('div', { class: 'text-right' }, [
      el('div', { class: 'text-[10px] uppercase tracking-widest text-white/50 font-semibold' }, 'Your Order'),
      current.tableName
        ? el('div', { class: 'text-2xl font-bold leading-tight mt-0.5' }, current.tableName)
        : el('div', { class: 'text-sm text-white/60 mt-1' }, current.orderType.replace('_',' ')),
    ]));
  }

  function paintBody() {
    body.innerHTML = '';
    if (!current.items.length) return;

    const list = el('div', { class: 'max-w-4xl mx-auto space-y-2' });
    current.items.forEach((it, i) => {
      list.appendChild(el('div', {
        class: 'flex items-start justify-between gap-4 py-3 px-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur',
        style: `animation: slideIn .3s ease-out ${i * 30}ms backwards`,
      }, [
        el('div', { class: 'flex items-baseline gap-4 min-w-0 flex-1' }, [
          el('div', { class: 'shrink-0 w-10 h-10 rounded-lg bg-indigo-500/30 border border-indigo-400/40 flex items-center justify-center font-bold text-lg' }, `×${it.qty}`),
          el('div', { class: 'min-w-0' }, [
            el('div', { class: 'text-base font-medium leading-tight truncate' }, it.name),
            it.variantName ? el('div', { class: 'text-xs text-white/60 leading-tight mt-0.5' }, it.variantName) : null,
            el('div', { class: 'text-[11px] text-white/50 mt-1' }, `${fmtMoney(it.unitPrice)} each`),
          ].filter(Boolean)),
        ]),
        el('div', { class: 'shrink-0 text-lg font-bold tabular-nums' }, fmtMoney(it.lineTotal)),
      ]));
    });

    body.appendChild(list);
  }

  function paintFooter() {
    footer.innerHTML = '';
    const t = current.totals;
    const hasItems = current.items.length > 0;

    const wrap2 = el('div', { class: 'max-w-4xl mx-auto px-8 py-5 space-y-2' });

    const row = (label, value, cls = 'text-white/80') =>
      el('div', { class: `flex justify-between text-sm ${cls}` }, [
        el('span', {}, label),
        el('span', { class: 'tabular-nums font-medium' }, value),
      ]);

    if (Number(t.discount) > 0) {
      wrap2.appendChild(row('Discount', `− ${fmtMoney(t.discount)}`, 'text-emerald-300'));
    }
    wrap2.appendChild(row('Taxable', fmtMoney(t.gross)));
    wrap2.appendChild(row('CGST',    fmtMoney(t.tax / 2)));
    wrap2.appendChild(row('SGST',    fmtMoney(t.tax / 2)));

    wrap2.appendChild(el('div', { class: 'flex justify-between items-baseline pt-3 mt-2 border-t border-white/20' }, [
      el('span', { class: 'text-sm uppercase tracking-widest text-white/60 font-semibold' }, 'Total'),
      el('span', {
        class: 'text-4xl md:text-5xl font-black tabular-nums text-emerald-300 transition-all',
        'data-total': String(t.grand),
      }, fmtMoney(t.grand)),
    ]));

    if (!hasItems) {
      wrap2.appendChild(el('div', { class: 'text-center text-white/40 text-xs mt-4' }, 'Waiting for items…'));
    }

    footer.appendChild(wrap2);
  }

  function paintWelcome() {
    welcome.innerHTML = '';
    if (current.state !== 'idle') {
      welcome.style.opacity = '0';
      welcome.style.pointerEvents = 'none';
      return;
    }
    welcome.style.opacity = '1';
    welcome.style.pointerEvents = 'auto';

    welcome.appendChild(el('div', { class: 'text-center max-w-2xl px-8' }, [
      el('div', { class: 'mb-6 flex justify-center' }, [
        el('div', { class: 'w-24 h-24 rounded-3xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-5xl backdrop-blur animate-pulse' }, '🍽️'),
      ]),
      el('div', { class: 'text-4xl md:text-5xl font-bold mb-3' }, 'Welcome!'),
      el('div', { class: 'text-lg text-white/70' }, 'Scan the menu QR or ask your server to begin your order.'),
      el('div', { class: 'mt-8 text-xs text-white/40 uppercase tracking-widest font-semibold' }, 'Your order will appear here in real time'),
    ]));
  }

  function paintThankYou(payload) {
    thankyou.innerHTML = '';
    thankyou.appendChild(el('div', { class: 'text-center max-w-2xl px-8' }, [
      el('div', { class: 'mb-6 flex justify-center' }, [
        el('div', { class: 'w-24 h-24 rounded-full bg-white/15 border-4 border-emerald-300 flex items-center justify-center text-6xl' }, '✓'),
      ]),
      el('div', { class: 'text-4xl md:text-5xl font-bold mb-3' }, 'Thank You!'),
      el('div', { class: 'text-lg text-white/80' },
        payload.orderNumber ? `Order #${payload.orderNumber}` : 'Your order is confirmed'),
      payload.grandTotal != null
        ? el('div', { class: 'mt-4 text-3xl font-black tabular-nums text-emerald-300' }, fmtMoney(payload.grandTotal))
        : null,
      el('div', { class: 'mt-8 text-sm text-white/60' }, 'We hope to see you again soon!'),
    ].filter(Boolean)));

    thankyou.style.opacity = '1';
    thankyou.style.pointerEvents = 'auto';

    setTimeout(() => {
      thankyou.style.opacity = '0';
      thankyou.style.pointerEvents = 'none';
      current.state = 'idle';
      current.items = [];
      current.totals = { gross: 0, tax: 0, discount: 0, grand: 0 };
      repaint();
    }, 8000);
  }

  // ---- Subscribe ----
  const channel = getDisplayChannel();

  const onMessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'cart:update') {
      current = { ...current, ...msg.payload };
      repaint();
    } else if (msg.type === 'cart:idle') {
      current.state = 'idle';
      current.items = [];
      current.totals = { gross: 0, tax: 0, discount: 0, grand: 0 };
      repaint();
    } else if (msg.type === 'cart:thankyou') {
      paintThankYou(msg.payload || {});
    }
  };

  channel.addEventListener('message', onMessage);
  _displayUnsub = () => {
    channel.removeEventListener('message', onMessage);
    try { channel.close(); } catch {}
    _displayChannel = null;
  };

  // Ask POS for current state (in case display opened mid-order)
  channel.postMessage({ type: 'display:request-state', at: Date.now() });

  // Fullscreen toggle on double-click
  wrap.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  });

  repaint();
}

// ============================================================
// POS-SIDE LISTENER — responds to display's "give me current state"
// ============================================================
let _posListener = null;

export function startPosBridge() {
  if (_posListener) return;

  const channel = getPosChannel();
  _posListener = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'display:request-state') {
      // POS: rebroadcast current cart
      const { store } = window; // not reliable — use dynamic import
      import('../store.js').then(({ store: s }) => {
        publishCart(s.state.cart, {
          tableName: s.state.tables.find(t => t.id === s.state.cart.tableId)?.name || null,
        });
      });
    }
  };

  channel.addEventListener('message', _posListener);
}

export function stopPosBridge() {
  if (_posChannel && _posListener) {
    _posChannel.removeEventListener('message', _posListener);
  }
  _posListener = null;
}
