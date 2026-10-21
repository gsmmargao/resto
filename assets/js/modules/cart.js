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
        if (cart.orderId && !hasNewItems) {
          onClear(); // Cancels DB order and clears UI
        } else if (cart.orderId) {
          cart.items = cart.items.filter(l => l._saved);
          _computeTotals(cart);
          notifyCartChanged();
        } else {
          onClear();
        }
      },
    }, cart.orderId ? 'Discard New Items' : 'Clear Cart'),

    cart.orderId ? el('button', {
      class: 'col-span-2 py-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-sm font-medium',
      onclick: () => openCancelOrderModal(onClear),
    }, 'Cancel Entire Order') : null,

    el('button', {
      class: `col-span-2 py-2.5 rounded-lg text-sm font-semibold transition ${hasNewItems ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`,
      onclick: () => { if (hasNewItems) onSendKOT(); },
    }, hasNewItems ? (cart.orderId ? 'Send New Items (KOT)' : 'Send to Kitchen (KOT)') : 'No New Items'),

    el('button', {
      class: `col-span-2 py-3 rounded-lg text-base font-semibold shadow-sm transition ${cart.orderId ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`,
      onclick: () => { if (cart.orderId) onCheckout(); else toast('Send to kitchen first', 'warn'); },
    }, cart.orderId ? `Checkout • ${fmtMoney(t.grand)}` : 'Checkout • —'),
  ].filter(Boolean));

  root.appendChild(header);
  root.appendChild(lines);
  root.appendChild(totals);
  root.appendChild(actions);
}

function buildLine(l) {
  const isSaved = !!l._saved;
  return el('div', {
    class: `px-3 py-2 border-b border-slate-200 ${isSaved ? 'bg-slate-100/60' : 'bg-white'}`,
  }, [
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
      ? el('div', { class: 'mt-1 flex justify-between items-center' }, [
          el('div', { class: 'text-[10px] text-slate-400 italic' }, `Fired • Qty ${l.qty} (locked)`),
          el('button', {
            class: 'text-[10px] font-bold text-red-500 hover:text-red-700 underline',
            onclick: () => voidSavedItem(l),
          }, 'Void Item'),
        ])
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

async function voidSavedItem(l) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4' });
  
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Void Item'));
  card.appendChild(el('p', { class: 'text-sm text-slate-600' }, `Are you sure you want to remove ${l.qty}x ${l.name} from the order?`));
  
  const reasonIn = el('select', { class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500' }, [
    el('option', { value: 'Customer changed mind' }, 'Customer changed mind'),
    el('option', { value: 'Out of stock' }, 'Out of stock'),
    el('option', { value: 'Wrong item punched' }, 'Wrong item punched'),
    el('option', { value: 'Quality issue' }, 'Quality issue'),
    el('option', { value: 'Other' }, 'Other')
  ]);
  
  const notesIn = el('input', { type: 'text', placeholder: 'Additional notes (optional)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500' });

  card.appendChild(el('label', { class: 'block text-xs font-medium text-slate-600 mt-2 mb-1' }, 'Reason *'));
  card.appendChild(reasonIn);
  card.appendChild(notesIn);

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Voiding…';
        
        const finalReason = notesIn.value.trim() 
          ? `${reasonIn.value} - ${notesIn.value.trim()}` 
          : reasonIn.value;

        try {
          const { error } = await supabase.rpc('void_order_item', { 
            p_item_id: l._dbId, 
            p_reason: finalReason 
          });
          if (error) throw error;
          
          toast('Item voided successfully', 'success');
          overlay.remove();
          
          const cart = store.state.cart;
          cart.items = cart.items.filter(item => item.id !== l.id);
          _computeTotals(cart);
          notifyCartChanged();
          
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Void Item';
        }
      }
    }, 'Confirm Void')
  ]);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// CANCEL ENTIRE ORDER MODAL (Password Protected)
// ============================================================
async function openCancelOrderModal(onClear) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center' });
  
  card.appendChild(el('div', { class: 'w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto text-xl mb-2' }, '⚠️'));
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Cancel Entire Order?'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, 'This will void all items, cancel the KOTs, and free the table.'));
  
  const reasonIn = el('select', { class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500' }, [
    el('option', { value: 'Customer left without ordering' }, 'Customer left without ordering'),
    el('option', { value: 'Wrong table selected' }, 'Wrong table selected'),
    el('option', { value: 'Duplicate order' }, 'Duplicate order'),
    el('option', { value: 'Other' }, 'Other')
  ]);

  const passIn = el('input', { type: 'password', placeholder: 'Enter Admin Password (1234)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 text-center tracking-widest' });

  card.appendChild(el('label', { class: 'block text-left text-xs font-medium text-slate-600 mb-1 mt-2' }, 'Reason for cancellation'));
  card.appendChild(reasonIn);
  card.appendChild(el('label', { class: 'block text-left text-xs font-medium text-slate-600 mb-1' }, 'Admin Password'));
  card.appendChild(passIn);

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Go Back'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        
        // Simple hardcoded password check for admin override
        if (passIn.value !== '1234') {
          toast('Incorrect Admin Password', 'error');
          passIn.focus();
          return;
        }

        btn.disabled = true; btn.textContent = 'Verifying…';
        
        try {
          // 1. Fetch the LATEST password from the database to avoid cache issues
          const { data: tenantData, error: tErr } = await supabase
            .from('tenants')
            .select('settings')
            .eq('id', store.state.tenant.id)
            .single();
            
          if (tErr) throw tErr;

          const correctPass = tenantData?.settings?.cancel_password || '1234';
          
          // 2. Check password
          if (passIn.value !== correctPass) {
            toast('Incorrect Admin Password', 'error');
            btn.disabled = false; 
            btn.textContent = 'Confirm Cancel';
            passIn.focus();
            return;
          }

          btn.textContent = 'Cancelling…';

          // 3. Proceed with cancellation
          const { error } = await supabase.rpc('cancel_entire_order', { 
            p_order_id: store.state.cart.orderId, 
            p_reason: reasonIn.value 
          });
          
          if (error) throw error;
          
          toast('Order cancelled and table cleared', 'success');
          overlay.remove();
          await onClear(); // Calls the clear logic in dashboard.js
          
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Confirm Cancel';
        }
      }
    }, 'Confirm Cancel')
  ]);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => passIn.focus(), 50);
}
