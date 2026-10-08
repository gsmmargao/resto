import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, uuid, toast } from '../utils.js';

function notifyCartChanged() { window.dispatchEvent(new CustomEvent('cart:changed')); }

export function addToCart({ item, variant, addons = [], notes = '' }) {
  const cart = store.state.cart;
  const price = variant?.price ?? item.base_price;
  const taxRate = item.tax_rate ?? 0.05;
  const key = `${item.id}::${variant?.id || ''}::${notes}`;
  const existing = cart.items.find(l => l._key === key && !l._saved);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.items.push({
      id: uuid(), _key: key, _saved: false, _dbId: null,
      menuItemId: item.id, variantId: variant?.id || null,
      name: item.name, variantName: variant?.name || null,
      qty: 1, unitPrice: Number(price), taxRate: Number(taxRate),
      taxInclusive: !!item.tax_inclusive, stationId: item.station_id || null,
      addons, notes,
    });
  }
  _computeTotals(cart);
  notifyCartChanged();
}

export function updateQty(lineId, qty) {
  const cart = store.state.cart;
  const line = cart.items.find(l => l.id === lineId);
  if (!line || line._saved) return;
  line.qty = Math.max(0, qty);
  if (line.qty === 0) cart.items = cart.items.filter(l => l.id !== lineId);
  _computeTotals(cart);
  notifyCartChanged();
}

export function removeLine(lineId) { updateQty(lineId, 0); }

export function clearCart() {
  store.state.cart = {
    orderId: null, orderType: 'dine_in', tableId: null, guestCount: 1, items: [],
    discount: { type: 'percent', value: 0, amount: 0, name: '' },
    serviceChargePct: 0, deliveryCharge: 0, tipAmount: 0,
    totals: { gross:0, taxable:0, tax:0, discount:0, serviceCharge:0, roundOff:0, grand:0 },
  };
  notifyCartChanged();
}

export async function loadOrderIntoCart(orderId) {
  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', orderId).single();
  if (oErr || !order) { toast('Failed to load order', 'error'); return false; }

  const { data: items, error: iErr } = await supabase
    .from('order_items').select('*').eq('order_id', orderId)
    .neq('status', 'cancelled').order('created_at');
  if (iErr) { toast('Failed to load items', 'error'); return false; }

  const lines = (items || []).map(it => ({
    id: uuid(),
    _key: `${it.menu_item_id}::${it.variant_id || ''}::${it.notes || ''}`,
    _saved: true, _dbId: it.id,
    menuItemId: it.menu_item_id, variantId: it.variant_id,
    name: it.name_snapshot, variantName: it.variant_name,
    qty: Number(it.quantity), unitPrice: Number(it.unit_price),
    taxRate: Number(it.tax_rate), taxInclusive: !!it.tax_inclusive,
    stationId: it.station_id, addons: [], notes: it.notes,
  }));

  store.state.cart = {
    orderId: order.id, orderType: order.order_type, tableId: order.table_id,
    guestCount: order.guest_count || 1, items: lines,
    discount: { type: 'percent', value: 0, amount: 0, name: '' },
    serviceChargePct: Number(order.service_charge_pct) || 0,
    deliveryCharge: Number(order.delivery_charge) || 0, tipAmount: 0,
    totals: { gross:0, taxable:0, tax:0, discount:0, serviceCharge:0, roundOff:0, grand:0 },
  };
  _computeTotals(store.state.cart);
  notifyCartChanged();
  return true;
}

function _computeTotals(cart) {
  let gross = 0, taxable = 0, tax = 0;
  (cart.items || []).forEach(l => {
    const lineGross = l.qty * l.unitPrice;
    gross += lineGross;
    if (l.taxInclusive) {
      const base = lineGross / (1 + l.taxRate);
      taxable += base; tax += lineGross - base;
    } else {
      taxable += lineGross; tax += lineGross * l.taxRate;
    }
  });
  let discountAmount = 0;
  const d = cart.discount || { type: 'percent', value: 0 };
  if (d.type === 'percent') discountAmount = taxable * (Number(d.value) / 100);
  else if (d.type === 'flat') discountAmount = Math.min(Number(d.value), taxable);
  if (discountAmount < 0) discountAmount = 0;

  const factor = taxable > 0 ? (taxable - discountAmount) / taxable : 0;
  const finalTaxable = taxable - discountAmount;
  const finalTax = tax * factor;
  const serviceCharge = (finalTaxable + finalTax) * (cart.serviceChargePct || 0);
  let grand = finalTaxable + finalTax + serviceCharge + (cart.deliveryCharge || 0) + (cart.tipAmount || 0);
  const roundOff = Math.round(grand) - grand;
  grand = Math.round(grand);
  cart.totals = { gross, taxable: finalTaxable, tax: finalTax, discount: discountAmount, serviceCharge, roundOff, grand };
}

export function recalcCart() { _computeTotals(store.state.cart); notifyCartChanged(); }

export function renderCartPanel(root, { onCheckout, onSendKOT, onClear, onPickTable }) {
  root.innerHTML = '';
  const cart = store.state.cart;
  const t = cart.totals || { gross:0, taxable:0, tax:0, discount:0, serviceCharge:0, roundOff:0, grand:0 };

  const header = el('div', { class: 'p-3 border-b border-slate-200 bg-white' }, [
    cart.orderId ? el('div', { class: 'mb-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between' }, [
      el('span', { class: 'font-medium' }, 'Editing existing order'),
      el('span', { class: 'text-[10px] opacity-80 font-mono' }, cart.orderId.slice(0, 8)),
    ]) : null,
    el('div', { class: 'flex gap-1.5 mb-2' }, [
      ...['dine_in', 'takeaway', 'delivery'].map(k =>
        el('button', {
          class: `flex-1 px-2 py-1.5 rounded-md text-xs font-medium capitalize transition ${cart.orderType === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`,
          onclick: () => {
            if (cart.orderId) { toast('Cannot change type on existing order', 'warn'); return; }
            cart.orderType = k; if (k !== 'dine_in') cart.tableId = null;
            notifyCartChanged();
          },
        }, k.replace('_', ' ')),
      ),
    ]),
    cart.orderType === 'dine_in' ? el('button', {
      class: `w-full text-left px-3 py-2 rounded-md border text-sm flex justify-between items-center ${cart.tableId ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-600 hover:border-indigo-400'} ${cart.orderId ? 'opacity-60' : ''}`,
      onclick: () => { if (cart.orderId) { toast('Table locked', 'warn'); return; } onPickTable(); },
    }, [
      el('span', {}, cart.tableId ? `Table: ${store.state.tables.find(x=>x.id===cart.tableId)?.name || '—'}` : 'Select table…'),
      el('span', { class: 'text-xs text-slate-500' }, `${cart.guestCount} pax`),
    ]) : null,
  ].filter(Boolean));

  const lines = el('div', { class: 'flex-1 overflow-y-auto bg-slate-50' });
  if (!cart.items.length) lines.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'Cart is empty'));
  else cart.items.forEach(l => lines.appendChild(buildLine(l)));

  const row = (label, value, cls = '') => el('div', { class: `flex justify-between py-0.5 ${cls}` }, [
    el('span', { class: 'text-slate-500' }, label), el('span', { class: 'text-slate-800 font-medium' }, value),
  ]);

  const totals = el('div', { class: 'bg-white border-t border-slate-200 p-3 text-sm' }, [
    row('Subtotal', fmtMoney(t.gross)),
    t.discount > 0 ? row('Discount', `− ${fmtMoney(t.discount)}`, 'text-emerald-600') : null,
    row('Tax', fmtMoney(t.tax)),
    t.serviceCharge > 0 ? row('Service Charge', fmtMoney(t.serviceCharge)) : null,
    t.roundOff !== 0 ? row('Round Off', fmtMoney(t.roundOff)) : null,
    el('div', { class: 'flex justify-between pt-2 mt-2 border-t border-dashed border-slate-300 text-base font-semibold text-slate-900' }, [
      el('span', {}, 'Total'), el('span', {}, fmtMoney(t.grand)),
    ]),
  ].filter(Boolean));

  const hasNewItems = cart.items.some(l => !l._saved);
  const actions = el('div', { class: 'p-3 bg-white border-t border-slate-200 grid grid-cols-2 gap-2' }, [
    el('button', {
      class: 'col-span-2 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
      onclick: () => {
        if (cart.orderId && !hasNewItems) onClear();
        else if (cart.orderId) { cart.items = cart.items.filter(l => l._saved); _computeTotals(cart); notifyCartChanged(); }
        else onClear();
      },
    }, cart.orderId ? 'Discard New Items' : 'Clear Cart'),
    el('button', {
      class: `col-span-2 py-2.5 rounded-lg text-sm font-semibold transition ${hasNewItems ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`,
      onclick: () => { if (hasNewItems) onSendKOT(); },
    }, hasNewItems ? (cart.orderId ? 'Send New Items (KOT)' : 'Send to Kitchen (KOT)') : 'No New Items'),
    el('button', {
      class: `col-span-2 py-3 rounded-lg text-base font-semibold shadow-sm transition ${cart.orderId ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`,
      onclick: () => { if (cart.orderId) onCheckout(); else toast('Send to kitchen first', 'warn'); },
    }, cart.orderId ? `Checkout • ${fmtMoney(t.grand)}` : 'Checkout • —'),
  ]);

  root.appendChild(header); root.appendChild(lines); root.appendChild(totals); root.appendChild(actions);
}

function buildLine(l) {
  const isSaved = !!l._saved;
  return el('div', { class: `px-3 py-2 border-b border-slate-200 ${isSaved ? 'bg-slate-100/60' : 'bg-white'}` }, [
    el('div', { class: 'flex justify-between items-start gap-2' }, [
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'flex items-center gap-1.5 mb-0.5' }, [
          isSaved ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wide shrink-0' }, 'Sent') : null,
          el('span', { class: 'text-sm font-medium text-slate-800 truncate' }, l.name),
        ].filter(Boolean)),
        l.variantName ? el('div', { class: 'text-xs text-slate-500' }, l.variantName) : null,
        l.notes ? el('div', { class: 'text-xs italic text-slate-500 truncate' }, `"${l.notes}"`) : null,
      ].filter(Boolean)),
      el('div', { class: 'text-sm font-semibold text-slate-800 shrink-0' }, fmtMoney(l.qty * l.unitPrice)),
    ]),
    isSaved
      ? el('div', { class: 'mt-1 text-[10px] text-slate-400 italic' }, `Fired • Qty ${l.qty} (locked)`)
      : el('div', { class: 'mt-1.5 flex items-center justify-between' }, [
          el('div', { class: 'flex items-center gap-1' }, [
            el('button', { class: 'w-6 h-6 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs', onclick: () => updateQty(l.id, l.qty - 1) }, '−'),
            el('span', { class: 'w-7 text-center text-sm font-medium' }, l.qty),
            el('button', { class: 'w-6 h-6 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs', onclick: () => updateQty(l.id, l.qty + 1) }, '+'),
          ]),
          el('button', { class: 'text-xs text-red-500 hover:text-red-700', onclick: () => removeLine(l.id) }, 'Remove'),
        ]),
  ]);
}
