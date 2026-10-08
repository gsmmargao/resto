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

      const card = el('button', {
        class: 'text-left bg-white rounded-lg border border-slate-200 hover:border-indigo-400 hover:shadow-sm transition p-2.5 flex flex-col gap-1 min-h-[78px]',
        onclick: () => {
          if (vars.length === 0) onAddItem({ item, variant: null });
          else if (vars.length === 1) onAddItem({ item, variant: vars[0] });
          else openVariantPicker(item, vars, onAddItem);
        },
      }, [
        el('div', { class: 'text-[13px] font-medium text-slate-800 leading-snug line-clamp-2' }, [vegDot, item.name]),
        el('div', { class: 'mt-auto flex items-center justify-between text-[11px] text-slate-500' }, [
          el('span', {}, `₹${Number(item.base_price).toFixed(0)}`),
          el('span', { class: 'uppercase tracking-wide' }, item.food_category || ''),
        ]),
      ]);
      list.appendChild(card);
    });
  }

  renderFilters();
  renderItems();
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
