import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast, debounce } from '../utils.js';
import { cachedQuerySafe, CACHE_KEYS } from './offline-cache.js';

export async function loadCatalog() {
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!tenantId) return;

  // Load from cache first for instant boot
  const cacheKeys = {
    cats:  CACHE_KEYS.categories(tenantId, outletId),
    items: CACHE_KEYS.items(tenantId),
    vars:  CACHE_KEYS.variants(tenantId),
  };

  // Kick off parallel network + cache queries
  const [catRes, itemRes, varRes] = await Promise.all([
    cachedQuerySafe(cacheKeys.cats, async () => {
      const { data, error } = await supabase.from('menu_categories').select('*')
        .or(`outlet_id.is.null,outlet_id.eq.${outletId}`)
        .eq('tenant_id', tenantId).eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data || [];
    }, []),
    cachedQuerySafe(cacheKeys.items, async () => {
      const { data, error } = await supabase.from('menu_items').select('*')
        .eq('tenant_id', tenantId).eq('is_active', true).eq('is_available', true).order('sort_order');
      if (error) throw error;
      return data || [];
    }, []),
    cachedQuerySafe(cacheKeys.vars, async () => {
      const { data, error } = await supabase.from('menu_item_variants').select('*')
        .eq('tenant_id', tenantId).eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data || [];
    }, []),
  ]);

  const cats  = catRes.data  || [];
  const items = itemRes.data || [];
  const vars  = varRes.data  || [];

  store.set('categories', cats);
  store.set('menuItems',  items);
  store.set('variants',   vars);

  // Surface offline state to the user
  const anyCached = catRes.cached || itemRes.cached || varRes.cached;
  const anyFresh  = !catRes.cached || !itemRes.cached || !varRes.cached;

  if (anyCached && !anyFresh) {
    toast(`Offline — showing cached menu (${items.length} items)`, 'warn', 3000);
  } else if (anyCached && anyFresh) {
    console.log('[menu] loaded (partial cache fallback)');
  }

  console.log('[menu] loaded',
    `categories=${cats.length}`,
    `items=${items.length}`,
    `variants=${vars.length}`,
    anyCached ? '(with cache)' : '(fresh)');
}

export function renderMenuPanel(root, { onAddItem }) {
  root.innerHTML = '';

  const header = el('div', { class: 'p-3 border-b border-slate-200 flex items-center gap-2 bg-white' }, [
    el('input', {
      type: 'search', placeholder: 'Search menu…',
      class: 'flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
      oninput: debounce(e => {
        store.patch('ui', { search: e.target.value.trim().toLowerCase() });
        renderItems();
      }, 150),
    }),
  ]);

  const filterBar = el('div', { class: 'px-3 py-2 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white' });
  const list = el('div', { class: 'flex-1 overflow-y-auto p-3 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 content-start bg-slate-50' });

  root.appendChild(header);
  root.appendChild(filterBar);
  root.appendChild(list);

  const cats = store.state.categories || [];

  const chip = (id, name) => {
    const active = (store.state.ui.activeCategory ?? 'all') === id;
    return el('button', {
      class: `px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'}`,
      onclick: () => {
        store.patch('ui', { activeCategory: id });
        renderFilters();
        renderItems();
      },
    }, name);
  };

  function renderFilters() {
    filterBar.innerHTML = '';
    filterBar.appendChild(chip('all', 'All'));
    cats.forEach(c => filterBar.appendChild(chip(c.id, c.name)));
  }

  function renderItems() {
    const { activeCategory, search } = store.state.ui;
    const vByItem = new Map();
    (store.state.variants || []).forEach(v => {
      if (!vByItem.has(v.menu_item_id)) vByItem.set(v.menu_item_id, []);
      vByItem.get(v.menu_item_id).push(v);
    });

    let items = store.state.menuItems || [];
    if (activeCategory && activeCategory !== 'all') items = items.filter(i => i.category_id === activeCategory);
    if (search) items = items.filter(i => (i.name || '').toLowerCase().includes(search) || (i.short_name || '').toLowerCase().includes(search));

    list.innerHTML = '';

    if (!items.length) {
      list.appendChild(el('div', { class: 'col-span-full flex flex-col items-center justify-center text-slate-400 py-10' }, [
        el('div', { class: 'text-4xl mb-2 opacity-40' }, '🍽️'),
        el('div', { class: 'text-sm font-medium' }, 'No items'),
        el('div', { class: 'text-xs mt-1' }, store.state.menuItems?.length ? 'Nothing matches your filter' : 'Menu not cached — reconnect once to prime offline mode'),
      ]));
      return;
    }

    items.forEach(item => {
      const vars = vByItem.get(item.id) || [];
      const dotColor = item.item_type === 'non_veg' ? 'bg-red-600' : 'bg-emerald-600';
      const dotBorder = item.item_type === 'non_veg' ? 'border-red-600' : 'border-emerald-600';
      const vegDot = el('span', { class: `inline-block w-3 h-3 rounded-sm mr-1.5 align-middle border ${dotBorder}` }, [
        el('span', { class: `block w-1.5 h-1.5 rounded-full m-auto ${dotColor}` }),
      ]);

      // Check if item is in cart to highlight it
      const isInCart = store.state.cart.items.some(l => l.menuItemId === item.id);
      const cardClass = `text-left ${isInCart ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'} rounded-lg border hover:border-indigo-400 hover:shadow-sm transition p-2.5 flex flex-col gap-1 min-h-[78px]`;

      const qtyInCart = window.store.state.cart.items.filter(l => l.menuItemId === item.id).reduce((s, l) => s + l.qty, 0);

      const card = el('div', {
        'data-item-id': item.id,
        class: `text-left ${qtyInCart > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'} rounded-lg border hover:border-indigo-400 hover:shadow-sm transition p-2.5 flex flex-col justify-between min-h-[78px] cursor-pointer relative group`,
        onclick: (e) => {
          // Ignore clicks on the +/- buttons
          if (e.target.closest('.qty-btn')) return; 
          
          const triggerAdd = (v) => {
              openItemModal(item, v, 1, '', false, (data) => {
                  if (typeof onAddItem === 'function') onAddItem(data);
              });
          };

          if (vars.length === 0) triggerAdd(null);
          else if (vars.length === 1) triggerAdd(vars[0]);
          else openVariantPicker(item, vars, (data) => triggerAdd(data.variant));
        },
      }, [
        el('div', { class: 'flex items-start gap-2' }, [
          vegDot,
          el('div', { class: 'font-medium text-slate-800 text-sm leading-tight' }, item.name)
        ]),
        
        qtyInCart > 0 ? 
          // Controls appear when item is added
          el('div', { class: 'flex items-center justify-between mt-2 bg-white rounded-lg border border-amber-200 p-0.5 shadow-sm w-full' }, [
              el('button', { 
                  class: 'qty-btn w-7 h-7 flex items-center justify-center text-red-600 hover:bg-red-50 rounded font-bold text-lg transition', 
                  onclick: (e) => {
                      e.stopPropagation();
                      const cartItem = window.store.state.cart.items.find(l => l.menuItemId === item.id);
                      if (cartItem) {
                          import('./cart.js').then(({ updateQty }) => {
                              if (cartItem.qty > 1) updateQty(cartItem.id, cartItem.qty - 1);
                              else updateQty(cartItem.id, 0);
                          });
                      }
                  }
              }, '-'),
              el('span', { class: 'text-xs font-bold text-slate-800 w-6 text-center' }, qtyInCart),
              el('button', { 
                  class: 'qty-btn w-7 h-7 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded font-bold text-lg transition', 
                  onclick: (e) => {
                      e.stopPropagation();
                      if (vars.length === 0) onAddItem({ item, variant: null });
                      else if (vars.length === 1) onAddItem({ item, variant: vars[0] });
                      else openVariantPicker(item, vars, onAddItem);
                  }
              }, '+')
          ]) 
        : 
          // Normal price/category display
          el('div', { class: 'flex justify-between items-end mt-auto w-full' }, [
              el('div', { class: 'text-xs font-semibold text-slate-700' }, `₹${item.base_price}`),
              el('span', { class: 'text-[10px] text-slate-400 font-medium' }, 'FOOD')
          ])
      ]);
      list.appendChild(card);
    });
  }

  renderFilters();
  renderItems();

  // INSTANT HIGHLIGHT LISTENER
  window.addEventListener('cart:changed', () => {
      // Save scroll position so the screen doesn't jump
      const scrollPos = list.scrollTop;
      
      // Instantly re-render the items to show/hide the +/- buttons
      renderItems();
      
      // Restore scroll position
      list.scrollTop = scrollPos;
  });
}


export function openItemModal(item, variant, initialQty = 1, initialNotes = '', isEdit = false, onSave) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col' });
  
  const price = variant?.price ?? item.base_price;
  let qty = initialQty;
  
  // Header
  card.appendChild(el('div', { class: 'p-4 border-b border-slate-100' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, `${item.name} ${variant ? '(' + variant.name + ')' : ''}`),
    el('div', { class: 'text-slate-500 font-medium' }, `₹ ${Number(price).toFixed(2)}`)
  ]));

  // Body
  const notesIn = el('input', { type: 'text', placeholder: 'Cooking instructions (optional)', class: 'w-full mt-4 p-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400', value: initialNotes });
  const qtyDisplay = el('div', { class: 'text-xl font-bold w-12 text-center' }, '1');
  
  card.appendChild(el('div', { class: 'p-4' }, [
    notesIn,
    el('div', { class: 'flex items-center justify-center gap-4 mt-6' }, [
      el('button', { 
        class: 'w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xl flex items-center justify-center', 
        onclick: () => { if (qty > 0) { qty--; qtyDisplay.innerText = qty; if(isEdit) document.getElementById('modal-confirm-btn').innerText = qty === 0 ? 'Remove Item' : 'Save'; } } 
      }, '−'),
      qtyDisplay,
      el('button', { 
        class: 'w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xl flex items-center justify-center', 
        onclick: () => { qty++; qtyDisplay.innerText = qty; if(isEdit) document.getElementById('modal-confirm-btn').innerText = 'Save'; } 
      }, '+')
    ])
  ]));

  // Footer
  const actions = el('div', { class: 'p-4 border-t border-slate-100 grid grid-cols-2 gap-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', { 
      id: 'modal-confirm-btn',
      class: 'py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: () => {
        if (typeof onSave === 'function') {
            onSave({ item, variant, qty, notes: notesIn.value.trim() });
        }
        overlay.remove();
      }
    }, isEdit ? (qty === 0 ? 'Remove Item' : 'Save') : 'Confirm')
  ]);
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function openVariantPicker(item, variants, onAddItem) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-sm p-4' }, [
    el('h3', { class: 'font-semibold text-slate-800 mb-3' }, item.name),
    el('div', { class: 'space-y-2' },
      variants.map(v => el('button', {
        class: 'w-full flex justify-between items-center px-3 py-2.5 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 text-sm',
        onclick: () => { overlay.remove(); onAddItem({ item, variant: v }); },
      }, [
        el('span', { class: 'font-medium text-slate-800' }, v.name),
        el('span', { class: 'text-slate-600' }, `₹${Number(v.price).toFixed(2)}`),
      ])),
    ),
    el('button', {
      class: 'mt-4 w-full py-2 text-sm text-slate-500 hover:text-slate-800',
      onclick: () => overlay.remove(),
    }, 'Cancel'),
  ]);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
