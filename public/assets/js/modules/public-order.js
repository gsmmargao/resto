import { supabase } from '../supabase-client.js';
import { el, fmtMoney, toast } from '../utils.js';

// ============================================================
// ENTRY
// ============================================================
export async function renderPublicOrder(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm' }, 'Loading menu…'));

  const token = getTokenFromUrl();
  if (!token) return renderError(root, 'No table selected', 'Please scan the QR code on your table again.');

  let menu;
  try {
    const { data, error } = await supabase.rpc('get_public_menu', { p_qr_token: token });
    if (error) throw error;
    if (!data) return renderError(root, 'Invalid QR code', 'This table is not accepting orders right now.');
    menu = data;
  } catch (err) {
    console.error('[public-order]', err);
    return renderError(root, 'Could not load the menu', err.message || 'Try again in a moment.');
  }

  const cart = new Map();
  paint(root, menu, cart, token);
}

function getTokenFromUrl() {
  const hash = location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('t');
}

function renderError(root, title, msg) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'min-h-screen flex items-center justify-center bg-slate-50 p-6' }, [
    el('div', { class: 'max-w-sm text-center' }, [
      el('div', { class: 'text-5xl mb-4' }, '⚠️'),
      el('div', { class: 'text-xl font-bold text-slate-800 mb-2' }, title),
      el('div', { class: 'text-sm text-slate-500' }, msg),
    ]),
  ]));
}

// ============================================================
// MAIN LAYOUT
// ============================================================
function paint(root, menu, cart, token) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'min-h-screen bg-slate-100 pb-28' });

  // Header
  const header = el('div', { class: 'sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3' }, [
    el('div', { class: 'flex items-center justify-between gap-3' }, [
      el('div', { class: 'min-w-0' }, [
        el('div', { class: 'font-bold text-slate-900 truncate' }, menu.tenant.name || 'Restaurant'),
        el('div', { class: 'text-xs text-slate-500 truncate' }, `${menu.outlet.name || ''} • Table ${menu.table.name}`),
      ]),
      el('button', {
        class: 'shrink-0 text-xs text-indigo-600 hover:text-indigo-800 font-medium underline',
        onclick: () => { location.href = location.pathname; },
      }, 'Exit'),
    ]),
  ]);
  wrap.appendChild(header);

  // Category chips
  const chips = el('div', { class: 'sticky top-[64px] z-20 bg-white border-b border-slate-200 px-4 py-2 flex gap-2 overflow-x-auto' });
  const itemsList = el('div', { class: 'p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start' });

  const cats = menu.categories || [];
  const current = { cat: 'all' };

  function paintChips() {
    chips.innerHTML = '';
    const chipsArr = [{ id: 'all', name: 'All' }, ...cats];
    chipsArr.forEach(c => {
      const active = current.cat === c.id;
      chips.appendChild(el('button', {
        class: `px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'}`,
        onclick: () => { current.cat = c.id; paintChips(); paintItems(); },
      }, c.name));
    });
  }

  const variantsByItem = new Map();
  (menu.variants || []).forEach(v => {
    if (!variantsByItem.has(v.menu_item_id)) variantsByItem.set(v.menu_item_id, []);
    variantsByItem.get(v.menu_item_id).push(v);
  });

  function paintItems() {
    itemsList.innerHTML = '';
    let items = menu.items || [];
    if (current.cat !== 'all') items = items.filter(i => i.category_id === current.cat);

    if (!items.length) {
      itemsList.appendChild(el('div', { class: 'col-span-full text-center text-slate-400 py-10 text-sm' }, 'No items in this category'));
      return;
    }

    items.forEach(item => {
      const variants = variantsByItem.get(item.id) || [];
      const dotBorder = item.item_type === 'non_veg' ? 'border-red-600' : 'border-emerald-600';
      const dotBg     = item.item_type === 'non_veg' ? 'bg-red-600'    : 'bg-emerald-600';
      const vegMark = el('span', { class: `inline-block w-3 h-3 rounded-sm border-2 ${dotBorder} mr-1.5 align-middle relative shrink-0` }, [
        el('span', { class: `absolute inset-[1.5px] rounded-full ${dotBg}` }),
      ]);

      const card = el('button', {
        class: 'text-left bg-white rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition p-3 flex flex-col gap-2 min-h-[96px]',
        onclick: () => {
          if (!variants.length) addItemToCart(cart, { item, variant: null });
          else if (variants.length === 1) addItemToCart(cart, { item, variant: variants[0] });
          else openVariantPicker(item, variants, (v) => addItemToCart(cart, { item, variant: v }));
          paintBadge();
        },
      }, [
        el('div', { class: 'flex items-start gap-1.5' }, [
          vegMark,
          el('div', { class: 'flex-1 text-sm font-semibold text-slate-800 leading-snug' }, item.name),
        ]),
        item.description ? el('div', { class: 'text-[11px] text-slate-500 line-clamp-2 leading-snug' }, item.description) : null,
        el('div', { class: 'mt-auto flex items-center justify-between' }, [
          el('span', { class: 'text-base font-bold text-slate-900' }, fmtMoney(item.base_price)),
          el('span', { class: 'text-[10px] uppercase tracking-wide text-slate-400' }, item.food_category || ''),
        ]),
      ].filter(Boolean));
      itemsList.appendChild(card);
    });
  }

  paintChips();
  paintItems();

  wrap.appendChild(chips);
  wrap.appendChild(itemsList);

  // Sticky bottom bar
  const bar = el('div', { class: 'fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 p-3 shadow-lg' });
  wrap.appendChild(bar);

  function paintBadge() {
    const count = [...cart.values()].reduce((s, l) => s + l.qty, 0);
    const total = [...cart.values()].reduce((s, l) => s + l.qty * l.unitPrice, 0);

    bar.innerHTML = '';
    if (count === 0) {
      bar.appendChild(el('div', { class: 'text-center text-xs text-slate-400 py-2' }, 'Add items to place your order'));
      return;
    }

    bar.appendChild(el('button', {
      class: 'w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-between px-4 shadow',
      onclick: () => openCartSheet(root, menu, cart, token, paintBadge),
    }, [
      el('span', { class: 'flex items-center gap-2' }, [
        el('span', { class: 'w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-xs font-bold' }, String(count)),
        el('span', {}, 'View Cart'),
      ]),
      el('span', { class: 'text-base font-bold' }, fmtMoney(total)),
    ]));
  }

  paintBadge();
  root.appendChild(wrap);
}

// ============================================================
// CART OPERATIONS
// ============================================================
function addItemToCart(cart, { item, variant, addons = [], notes = '' }) {
  const price = Number(variant?.price ?? item.base_price);
  const key = `${item.id}::${variant?.id || ''}`;
  const existing = cart.get(key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.set(key, {
      key,
      menuItemId: item.id,
      variantId: variant?.id || null,
      name: item.name,
      variantName: variant?.name || null,
      qty: 1,
      unitPrice: price,
      addons,
      notes,
    });
  }
  toast(`Added ${item.name}`, 'success', 900);
}

// ============================================================
// VARIANT PICKER
// ============================================================
function openVariantPicker(item, variants, onPick) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[70] flex items-end sm:items-center justify-center' });
  const card = el('div', { class: 'bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-4 space-y-2' });
  card.appendChild(el('h3', { class: 'font-semibold text-slate-800 mb-2' }, item.name));
  variants.forEach(v => {
    card.appendChild(el('button', {
      class: 'w-full flex justify-between items-center px-3 py-3 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 text-sm',
      onclick: () => { overlay.remove(); onPick(v); },
    }, [
      el('span', { class: 'font-medium text-slate-800' }, v.name),
      el('span', { class: 'text-slate-700' }, fmtMoney(v.price)),
    ]));
  });
  card.appendChild(el('button', {
    class: 'w-full py-2.5 text-sm text-slate-500 hover:text-slate-800',
    onclick: () => overlay.remove(),
  }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// CART SHEET
// ============================================================
function openCartSheet(root, menu, cart, token, onChanged) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center' });
  const card = el('div', { class: 'bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col' });

  card.appendChild(el('div', { class: 'px-4 py-3 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('div', { class: 'font-bold text-slate-800' }, 'Your Order'),
      el('div', { class: 'text-xs text-slate-500' }, `Table ${menu.table.name}`),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-800 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 space-y-2' });
  const footer = el('div', { class: 'p-4 border-t border-slate-200 space-y-3 bg-slate-50' });

  const nameIn = el('input', {
    type: 'text', placeholder: 'Your name (optional)',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });
  const phoneIn = el('input', {
    type: 'tel', placeholder: 'Phone (optional)',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });
  const notesIn = el('textarea', {
    rows: '2', placeholder: 'Any special requests? (optional)',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none',
  });

  let total = 0;

  function repaint() {
    body.innerHTML = '';
    total = 0;

    if (cart.size === 0) {
      body.appendChild(el('div', { class: 'text-center text-slate-400 py-10 text-sm' }, 'Your cart is empty'));
      footer.innerHTML = '';
      footer.appendChild(el('button', {
        class: 'w-full py-3 rounded-lg bg-slate-200 text-slate-500 text-sm font-medium cursor-not-allowed',
      }, 'Place Order'));
      return;
    }

    [...cart.values()].forEach(line => {
      const lineTotal = line.qty * line.unitPrice;
      total += lineTotal;
      body.appendChild(el('div', { class: 'flex items-start gap-3 py-2 border-b border-slate-100' }, [
        el('div', { class: 'flex-1 min-w-0' }, [
          el('div', { class: 'text-sm font-medium text-slate-800' }, line.name),
          line.variantName ? el('div', { class: 'text-xs text-slate-500' }, line.variantName) : null,
          el('div', { class: 'text-xs text-slate-500 mt-0.5' }, fmtMoney(line.unitPrice) + ' each'),
        ].filter(Boolean)),
        el('div', { class: 'flex items-center gap-1 shrink-0' }, [
          el('button', {
            class: 'w-7 h-7 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm',
            onclick: () => { line.qty = Math.max(0, line.qty - 1); if (line.qty === 0) cart.delete(line.key); repaint(); },
          }, '−'),
          el('span', { class: 'w-7 text-center text-sm font-medium' }, line.qty),
          el('button', {
            class: 'w-7 h-7 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm',
            onclick: () => { line.qty += 1; repaint(); },
          }, '+'),
          el('div', { class: 'w-20 text-right text-sm font-semibold text-slate-800' }, fmtMoney(lineTotal)),
        ]),
      ]));
    });

    footer.innerHTML = '';

    footer.appendChild(el('div', { class: 'space-y-2' }, [nameIn, phoneIn, notesIn]));

    footer.appendChild(el('div', { class: 'flex justify-between text-base font-bold text-slate-900 pt-1' }, [
      el('span', {}, 'Total'),
      el('span', {}, fmtMoney(total)),
    ]));

    const btn = el('button', {
      class: 'w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow',
    }, `Place Order • ${fmtMoney(total)}`);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await placeOrder(token, { name: nameIn.value.trim(), phone: phoneIn.value.trim() }, cart, notesIn.value.trim());
        overlay.remove();
        showSuccess(root, menu);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + (err.message || err), 'error');
        btn.disabled = false;
        btn.textContent = `Place Order • ${fmtMoney(total)}`;
      }
    });
    footer.appendChild(btn);
  }

  card.appendChild(body);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Watch for external cart mutations
  repaint();
  const t = setInterval(() => {
    if (!document.body.contains(overlay)) clearInterval(t);
    else if (onChanged) onChanged();
  }, 1000);
}

async function placeOrder(token, customer, cart, notes) {
  const items = [...cart.values()].map(l => ({
    menu_item_id: l.menuItemId,
    variant_id:   l.variantId,
    qty:          l.qty,
    notes:        l.notes || null,
  }));

  const { data, error } = await supabase.rpc('place_public_order', {
    p_qr_token: token,
    p_customer: customer,
    p_items:    items,
    p_notes:    notes || null,
  });
  if (error) throw error;
  return data;
}

// ============================================================
// SUCCESS
// ============================================================
function showSuccess(root, menu) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'min-h-screen bg-slate-100 flex items-center justify-center p-6' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-sm p-6 text-center' });

  card.appendChild(el('div', { class: 'w-16 h-16 rounded-full bg-emerald-100 mx-auto flex items-center justify-center mb-4' }, [
    el('span', { class: 'text-3xl' }, '✓'),
  ]));
  card.appendChild(el('h2', { class: 'text-xl font-bold text-slate-800' }, 'Order Placed!'));
  card.appendChild(el('p', { class: 'text-sm text-slate-500 mt-2' }, 'Your order has been sent to the kitchen. We\'ll serve you shortly.'));
  card.appendChild(el('div', { class: 'mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-left' }, [
    el('div', { class: 'text-xs text-slate-500' }, 'Table'),
    el('div', { class: 'text-sm font-semibold text-slate-800' }, menu.table.name),
  ]));
  card.appendChild(el('div', { class: 'mt-4 text-[11px] text-slate-400' }, `Serving from ${menu.outlet.name || 'Restaurant'}`));

  card.appendChild(el('button', {
    class: 'mt-6 w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold',
    onclick: () => { location.reload(); },
  }, 'Order More'));

  wrap.appendChild(card);
  root.appendChild(wrap);
}
