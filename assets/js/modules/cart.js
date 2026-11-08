import { CONFIG } from '../../../config.js';
import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import {el, fmtMoney, uuid, toast, confirmDialog} from '../utils.js';

// Standalone Pre-Bill Printer (avoids circular dependency with billing.js)
async function printPreBill(cart, t) {
    try {
        const tableObj = window.store.state.tables.find(tbl => tbl.id === cart.tableId);
        const tableName = cart.orderType === 'takeaway' ? 'Takeaway' : (tableObj ? tableObj.name : 'Takeaway');
        
        const payload = {
            header: {
                name: window.store.state.tenant?.name || 'Restaurant',
                address: window.store.state.outlet?.address_line1 || '',
                phone: window.store.state.outlet?.phone || ''
            },
            invoice: {
                number: 'PRE-' + (cart.orderId ? cart.orderId.slice(0,4).toUpperCase() : 'NEW'),
                date: new Date().toLocaleString('en-GB'),
                table: tableName
            },
            items: cart.items.map(it => ({
                name: it.name,
                qty: it.qty,
                rate: Number(it.unitPrice),
                amount: Number(it.qty * it.unitPrice)
            })),
            totals: { grand: t.grand },
            payments: [], 
            customer: { name: cart.customerName || '' }
        };

        if (CONFIG.LOCAL_SERVER_IP) {
            const res = await fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-bill`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Print server error: ' + res.status);
            if (window.toast) window.toast('Pre-bill printed', 'success');
        } else {
            if (window.toast) window.toast('Printer not configured', 'warn');
        }
    } catch (e) { 
        console.error('Print error:', e); 
        if (window.toast) window.toast('Print failed: ' + e.message, 'error');
    }
}



function notifyCartChanged() { window.dispatchEvent(new CustomEvent('cart:changed')); }

export function addToCart({ item, variant, addons = [], notes = '', qty = 1, custom_price = null }) {
  const cart = store.state.cart;
  const price = custom_price !== null && custom_price !== undefined ? custom_price : (variant?.price ?? item.base_price);
  const taxRate = item.tax_rate ?? 0.05;
  const customPriceStr = custom_price !== null && custom_price !== undefined ? `::${custom_price}` : '';
  const key = `${item.id}::${variant?.id || ''}::${notes}${customPriceStr}`;
  const existing = cart.items.find(l => l._key === key && !l._saved);
  if (existing) {
    existing.qty += qty;
  } else {
    const category = store.state.categories.find(c => c.id === item.category_id);
    const catName = item.category_name || (category ? category.name : 'Unknown');
    const categoryName = category ? category.name : 'Unknown';
    
    cart.items.push({
      id: uuid(), _key: key, _saved: false, _dbId: null,
      menuItemId: item.id, variantId: variant?.id || null,
      name: item.name, variantName: variant?.name || null,
      qty: qty, unitPrice: Number(price), taxRate: Number(taxRate),
      taxInclusive: !!item.tax_inclusive, stationId: item.station_id || null,
      categoryName: catName,
      print_kot: item.print_kot !== false, // <--- SAVES THE CATEGORY
      addons, notes,
    });
  }
  _computeTotals(cart);
  notifyCartChanged();
}

export function updateItemLine(lineId, qty, notes) {
  const cart = store.state.cart;
  const line = cart.items.find(l => l.id === lineId);
  if (!line) return;
  
  if (qty <= 0) {
      cart.items = cart.items.filter(l => l.id !== lineId);
  } else {
      line.qty = qty;
      line.notes = notes;
      line._key = `${line.menuItemId}::${line.variantId || ''}::${notes}`;
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
    discountType: 'amount',
    discountValue: 0,
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
    .from('order_items').select('*').eq('order_id', orderId).neq('status', 'void')
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
    discountType: 'amount',
    discountValue: 0,
    orderId: order.id, orderType: order.order_type, tableId: order.table_id,
    guestCount: order.guest_count || 1, items: lines,
    customerId: order.customer_id || null,
    customerName: order.customer_name_snapshot || '',
    customerPhone: order.customer_phone_snapshot || '',
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
  let gross = 0;
  let foodGross = 0;
  let bevGross = 0;

  (cart.items || []).forEach(l => {
    const lineTotal = l.qty * l.unitPrice;
    gross += lineTotal;
    
    let isBeverage = false;
    let catName = '';

    // 1. Direct match on the cart line
    const directCat = String(l.categoryName || l.category_name || l.category || '').toLowerCase();
    if (directCat.includes('beverage') || directCat.includes('drink') || directCat.includes('bar') || directCat.includes('mocktail')) {
        isBeverage = true;
        catName = directCat;
    } 
    
    // 2. If not found, look up the menu item by ID or Name
    if (!isBeverage) {
        const menuItem = (store.state.menuItems || []).find(m => String(m.id) === String(l.menuItemId) || m.name === l.name);
        if (menuItem) {
            // First check the text category
            const textCat = String(menuItem.food_category || menuItem.category_name || menuItem.categoryName || '').toLowerCase();
            if (textCat.includes('beverage') || textCat.includes('drink') || textCat.includes('bar') || textCat.includes('mocktail')) {
                isBeverage = true;
                catName = textCat;
            } 
            // Then check the UUID category
            else if (menuItem.category_id) {
                const catObj = (store.state.categories || []).find(c => c.id === menuItem.category_id);
                if (catObj) {
                    const uuidCat = String(catObj.name || '').toLowerCase();
                    if (uuidCat.includes('beverage') || uuidCat.includes('drink') || uuidCat.includes('bar') || uuidCat.includes('mocktail')) {
                        isBeverage = true;
                        catName = uuidCat;
                    }
                }
            }
        }
    }

    if (isBeverage) {
        bevGross += lineTotal;
    } else {
        foodGross += lineTotal;
    }
  });

  let manualDiscount = 0;
  const dType = cart.discountType || 'amount';
  const dVal = Number(cart.discountValue) || 0;

  // Apply discount ONLY to food
  if (dType === 'percent') {
    manualDiscount = foodGross * (Math.min(dVal, 100) / 100);
  } else {
    manualDiscount = Math.min(dVal, foodGross);
  }

  const finalTaxable = gross - manualDiscount;
  const serviceCharge = finalTaxable * (cart.serviceChargePct || 0);
  
  let grand = finalTaxable + serviceCharge + (cart.deliveryCharge || 0) + (cart.tipAmount || 0);
  const roundOff = Math.round(grand) - grand;
  grand = Math.round(grand);
  
  cart.totals = { gross, foodGross, bevGross, taxable: finalTaxable, tax: 0, discount: manualDiscount, serviceCharge, roundOff, grand };
}

export function recalcCart() { _computeTotals(store.state.cart); notifyCartChanged(); }

export function renderCartPanel(root, { onCheckout, onSendKOT, onClear, onPickTable, onEditItem }) {
  root.innerHTML = '';
  // Force the container to fill the height and use flexbox
  root.className = 'h-full flex flex-col bg-white';
  const cart = store.state.cart;
  const t = cart.totals || { gross:0, taxable:0, tax:0, discount:0, serviceCharge:0, roundOff:0, grand:0 };

  const header = el('div', { class: 'p-3 border-b border-slate-200 bg-white' }, [
    cart.orderId ? el('div', { class: 'mb-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between' }, [
      el('span', { class: 'font-medium' }, 'Editing existing order'),
      el('span', { class: 'text-[10px] opacity-80 font-mono' }, cart.orderId.slice(0, 8)),
    ]) : null,
    
    cart.orderType === 'dine_in' ? el('button', {
      class: `w-full text-left px-3 py-2 rounded-md border text-sm flex justify-between items-center ${cart.tableId ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-600 hover:border-indigo-400'} ${cart.orderId ? 'opacity-60' : ''}`,
      onclick: () => { if (cart.orderId) { toast('Table locked', 'warn'); return; } onPickTable(); },
    }, [
      el('span', {}, cart.orderType === 'takeaway' ? (cart.tableName || 'Take-away') : (cart.tableId ? `Table: ${store.state.tables.find(x=>x.id===cart.tableId)?.name || '—'}` : 'Select table…')),
      el('span', { class: 'text-xs text-slate-500' }, `${cart.guestCount} pax`),
    ]) : null,
  ].filter(Boolean));

  const lines = el('div', { class: 'bg-slate-50', id: 'cart-scroll-area', style: 'flex: 1; overflow-y: auto; min-height: 0;' });
  if (!cart.items.length) lines.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'Cart is empty'));
  else cart.items.forEach(l => lines.appendChild(buildLine(l, onEditItem)));

  const row = (label, value, cls = '') => el('div', { class: `flex justify-between py-0.5 ${cls}` }, [
    el('span', { class: 'text-slate-500' }, label), el('span', { class: 'text-slate-800 font-medium' }, value),
  ]);



  const totals = el('div', { class: 'bg-white border-t border-slate-200 p-3 text-sm shrink-0' }, [
    t.foodGross > 0 ? row('Food Total', fmtMoney(t.foodGross)) : null,
    t.bevGross > 0 ? row('Beverage Total', fmtMoney(t.bevGross)) : null,
    t.discount > 0 ? row(window.store.state.cart.discountType === 'percent' ? 'Food Discount' : 'Special Discount', '− ' + fmtMoney(t.discount), 'text-emerald-600') : null,
    t.serviceCharge > 0 ? row('Service Charge', fmtMoney(t.serviceCharge)) : null,
    t.roundOff !== 0 ? row('Round Off', fmtMoney(t.roundOff)) : null,
    el('div', { class: 'flex justify-between pt-2 mt-2 border-t border-dashed border-slate-300 text-base font-semibold text-slate-900' }, [
      el('span', {}, 'Total'), el('span', {}, fmtMoney(t.grand)),
    ]),
  ].filter(Boolean));

  const hasNewItems = cart.items.some(l => !l._saved);
  
  const actions = el('div', { class: 'p-2 bg-white border-t border-slate-200 grid grid-cols-2 gap-2 shrink-0 z-10' }, [
      // 1. Discard / Clear
      el('button', {
        class: 'py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition',
        onclick: () => {
          if (cart.orderId) {
            if (!hasNewItems) { toast('No new items to discard', 'warn'); return; }
            confirmDialog('Discard new items?', 'Confirm').then(ok => {
              if (ok) { cart.items = cart.items.filter(l => l._saved); _computeTotals(cart); window.dispatchEvent(new CustomEvent('cart:changed')); }
            });
          } else { onClear(); }
        }
      }, hasNewItems ? 'Discard' : 'Clear'),

      // 2. Send KOT (if new items) OR Print Bill (if sent)
      hasNewItems ? el('button', {
        class: 'py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition',
        onclick: () => { onSendKOT(); },
      }, cart.orderId ? 'Send KOT' : 'Send KOT') : 
      
      el('button', {
        class: 'py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition',
        onclick: async () => { 
            // 1. Trigger the actual print
            printPreBill(cart, t); 
            
            // 2. Mark the table as BILLED (grey) and save the discount
            if (cart.orderId) {
                try {
                    const { supabase } = await import('../supabase-client.js');
                    await supabase.from('orders').update({
                        status: 'billed',
                        discount_type: cart.discountType,
                        discount_value: cart.discountValue,
                        discount_total: cart.totals.discount
                    }).eq('id', cart.orderId);
                    
                    // Update local state so the floor plan turns grey instantly
                    const orderIndex = window.store.state.openOrders.findIndex(o => o.id === cart.orderId);
                    if (orderIndex !== -1) {
                        window.store.state.openOrders[orderIndex].status = 'billed';
                    }
                    window.dispatchEvent(new CustomEvent('floorplan:reload'));
                } catch (err) {
                    console.error('Failed to mark table as billed:', err);
                }
            }
        },
      }, 'Print Bill'),

      // 3. Checkout (Full width, only if order exists and no new items)
      (cart.orderId && !hasNewItems) ? el('button', {
        class: 'col-span-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition',
        onclick: () => { onCheckout(); },
      }, `Checkout • ${fmtMoney(t.grand)}`) : null,
      
      // 4. Cancel Entire Order (Small text link)
      cart.orderId ? el('button', {
        class: 'col-span-2 text-[10px] text-red-500 hover:underline mt-1 py-1',
        onclick: () => openCancelOrderModal(onClear),
      }, 'Cancel Entire Order') : null
    ].filter(Boolean));

  

  root.appendChild(header);
  root.appendChild(lines);
  root.appendChild(totals);
  


  root.appendChild(actions);

  // Absolute arrows inside the cart panel
  if (window.innerWidth < 1024) {
      const existing = document.getElementById('floating-scroll-btns');
      if (existing) existing.remove();
      
      const scrollControls = el('div', { 
        id: 'floating-scroll-btns',
        class: 'flex flex-col gap-1',
        style: 'position: absolute; right: 12px; bottom: 120px; z-index: 50;'
      }, [
          el('button', { 
            class: 'w-8 h-8 rounded-full bg-slate-800/80 text-white flex items-center justify-center shadow-md hover:bg-slate-900 text-sm',
            onclick: () => { const c = document.getElementById('cart-scroll-area'); if (c) c.scrollBy({ top: -200, behavior: 'smooth' }); } 
          }, '↑'),
          el('button', { 
            class: 'w-8 h-8 rounded-full bg-slate-800/80 text-white flex items-center justify-center shadow-md hover:bg-slate-900 text-sm',
            onclick: () => { const c = document.getElementById('cart-scroll-area'); if (c) c.scrollBy({ top: 200, behavior: 'smooth' }); } 
          }, '↓')
      ]);
      root.appendChild(scrollControls);
  }










}

function buildLine(l, onEditItem) {
  const isSaved = !!l._saved;
  return el('div', {
    class: `px-3 py-2 border-b border-slate-200 ${isSaved ? 'bg-slate-100/60' : 'bg-white'}`,
  }, [
    el('div', { class: 'flex items-center justify-between gap-2' }, [
      
      // LEFT: Qty x Name + Notes
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'flex items-center gap-1.5 mb-0.5' }, [
          isSaved ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wide shrink-0' }, 'Sent') : null,
          el('span', { class: 'text-sm font-semibold text-slate-800 truncate' }, `${l.qty} x ${l.name}`),
        ].filter(Boolean)),
        l.variantName ? el('div', { class: 'text-[10px] text-slate-500' }, l.variantName) : null,
        l.notes ? el('div', { class: 'text-[10px] italic text-slate-500 truncate' }, `* ${l.notes}`) : null,
      ]),

      // RIGHT: Price and Edit/Del Buttons
      el('div', { class: 'flex items-center gap-2 shrink-0' }, [
        el('div', { class: 'text-sm font-bold text-slate-800 text-right w-16' }, fmtMoney(l.qty * l.unitPrice)),
        
        el('button', { 
            class: 'px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-bold transition', 
            onclick: () => { if (typeof onEditItem === 'function') onEditItem(l); } 
        }, 'Edit'),
              ])
    ])
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
          
          // Trim inputs to avoid hidden spaces breaking the match
          const enteredPass = passIn.value.trim();
          const expectedPass = correctPass.trim();
          
          // Password verification happens silently in production

          // 2. Check password
          if (enteredPass !== expectedPass) {
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


// Highlight menu items that are currently in the cart
window.highlightCartItems = function() {
    const cart = window.store.state.cart;
    const cartItemIds = new Set((cart.items || []).map(l => l.menuItemId));
    
    document.querySelectorAll('[data-menu-item-id]').forEach(el => {
        const itemId = el.getAttribute('data-menu-item-id');
        if (cartItemIds.has(itemId)) {
            el.classList.add('menu-item-added');
        } else {
            el.classList.remove('menu-item-added');
        }
    });
};

// Auto-highlight on cart changes
window.addEventListener('cart:changed', () => {
    setTimeout(() => window.highlightCartItems(), 50);
});


// ============================================================
// CART PERSISTENCE (Fixes mobile refresh losing orders)
// ============================================================

// 1. Save cart to localStorage whenever it changes
window.addEventListener('cart:changed', () => {
    try {
        if (window.store && window.store.state && window.store.state.cart) {
            localStorage.setItem('pos_active_cart', JSON.stringify(window.store.state.cart));
        }
    } catch (e) {
        console.error('[Cart Persistence] Failed to save:', e);
    }
});

// 2. Restore cart on page load
setTimeout(() => {
    try {
        const savedCart = localStorage.getItem('pos_active_cart');
        if (savedCart && window.store && window.store.state) {
            const parsed = JSON.parse(savedCart);
            
            // Only restore if the current cart is actually empty
            if (!window.store.state.cart || !window.store.state.cart.items || window.store.state.cart.items.length === 0) {
                window.store.state.cart = parsed;
                // Recalculate totals to ensure math is perfect
                if (typeof _computeTotals === 'function') {
                    _computeTotals(window.store.state.cart);
                }
                console.log('[Cart Persistence] Restored active cart from memory. Items:', parsed.items.length);
                // We do NOT dispatch cart:changed here to avoid an infinite loop.
            }
        }
    } catch (e) {
        console.error('[Cart Persistence] Failed to restore:', e);
    }
}, 100); // 100ms delay ensures store is fully initialized

