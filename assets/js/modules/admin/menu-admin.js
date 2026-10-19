import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  items: [],
  search: '',
  catFilter: 'all',
  loaded: false,
};

// ============================================================
// HELPERS
// ============================================================
function generateShortcut(name) {
  if (!name) return '';
  return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('');
}

function autoCategorize(name) {
  const beverageKeywords = ['chai', 'coffee', 'tea', 'juice', 'soda', 'water', 'coke', 'pepsi', 'lassi', 'shake', 'mocktail', 'cocktail', 'beer', 'wine', 'drink', 'beverage', 'milk', 'smoothie'];
  const lower = name.toLowerCase();
  return beverageKeywords.some(kw => lower.includes(kw)) ? 'beverage' : 'food';
}

// ============================================================
// ENTRY
// ============================================================
export async function renderMenuAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading menu…'));

  try {
    if (!state.loaded) await loadItems();
    paint(root);
  } catch (err) {
    console.error('[menu-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadItems() {
  const { data, error } = await supabase.from('menu_items')
    .select('*')
    .eq('tenant_id', store.state.tenant.id)
    .order('name');
  
  if (error) throw error;
  state.items = data || [];
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadItems();
}

// ============================================================
// UI LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Menu Management'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.items.length} items`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm',
        onclick: () => openCSVImporter(root),
      }, '📥 Import CSV'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm',
        onclick: () => openItemEditor(root, null),
      }, '+ Add Item'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-5xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  // Filters
  const filterBar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex gap-2 items-center' });
  filterBar.appendChild(el('input', {
    type: 'search', placeholder: 'Search items…', value: state.search,
    class: 'flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));
  filterBar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.catFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' }, 'All Categories'),
    el('option', { value: 'food', selected: state.catFilter === 'food' ? true : null }, 'Food'),
    el('option', { value: 'beverage', selected: state.catFilter === 'beverage' ? true : null }, 'Beverage'),
  ]));
  inner.appendChild(filterBar);

  // Table
  const filtered = state.items.filter(i => {
    if (state.search && !i.name.toLowerCase().includes(state.search)) return false;
    if (state.catFilter !== 'all' && i.food_category !== state.catFilter) return false;
    return true;
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No items found'));
  } else {
    const tbody = el('tbody');
    filtered.forEach(item => {
      tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
        el('td', { class: 'px-4 py-3' }, [
          el('div', { class: 'text-sm font-medium text-slate-800' }, item.name),
          el('div', { class: 'text-[10px] text-slate-400 uppercase tracking-wide' }, item.short_name || '—'),
        ]),
        el('td', { class: 'px-4 py-3' }, [
          el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${item.food_category === 'beverage' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}` }, item.food_category),
        ]),
        el('td', { class: 'px-4 py-3 text-right text-sm font-semibold text-slate-800' }, fmtMoney(item.base_price)),
        el('td', { class: 'px-4 py-3 text-right' }, [
          el('div', { class: 'flex justify-end gap-1' }, [
            el('button', {
              class: 'text-xs px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium',
              onclick: () => openItemEditor(root, item),
            }, 'Edit'),
            el('button', {
              class: 'text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-medium',
              onclick: async (e) => {
                const btn = e.currentTarget;
                const ok = await confirmDialog(`Delete "${item.name}"?`, 'Delete Item?');
                if (!ok) return;
                
                btn.disabled = true;
                btn.textContent = '...';
                
                try {
                  // Try to hard delete first
                  const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
                  if (error) {
                    // If it fails due to foreign key (used in past orders), soft delete (hide) it
                    if (error.code === '23503') { // Postgres foreign key violation code
                      await supabase.from('menu_items').update({ is_active: false }).eq('id', item.id);
                      toast('Item has past orders. It has been hidden instead of deleted.', 'warn', 4000);
                    } else {
                      throw error;
                    }
                  } else {
                    toast('Item deleted', 'success');
                  }
                  
                  await refresh();
                  paint(root);
                } catch (err) {
                  console.error(err);
                  toast('Failed to delete: ' + err.message, 'error');
                  btn.disabled = false;
                  btn.textContent = 'Delete';
                }
              },
            }, 'Delete'),
          ]),
        ]),
      ]));
    });

    card.appendChild(el('table', { class: 'w-full' }, [
      el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
        el('tr', {}, [
          el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Item Name'),
          el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Category'),
          el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Amount'),
          el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
        ]),
      ]),
      tbody,
    ]));
  }
  inner.appendChild(card);
}

// ============================================================
// EDIT MODAL
// ============================================================
function openItemEditor(root, item) {
  const isNew = !item;
  const draft = item ? { ...item } : {
    tenant_id: store.state.tenant.id,
    name: '', short_name: '', food_category: 'food', base_price: 0, is_active: true
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4' });
  
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Item' : 'Edit Item'));

  const nameIn = el('input', {
    type: 'text', value: draft.name, placeholder: 'Item Name (e.g. Lepo Rava Fry)', class: inputCls,
    oninput: e => { 
      draft.name = e.target.value; 
      if (isNew) { 
        draft.short_name = generateShortcut(draft.name);
        draft.food_category = autoCategorize(draft.name);
        shortIn.value = draft.short_name;
        catIn.value = draft.food_category;
      }
    }
  });

  const shortIn = el('input', {
    type: 'text', value: draft.short_name, placeholder: 'Shortcut (e.g. LRF)', class: inputCls,
    oninput: e => { draft.short_name = e.target.value.toUpperCase(); }
  });

  const catIn = el('select', {
    class: inputCls, onchange: e => { draft.food_category = e.target.value; }
  }, [
    el('option', { value: 'food', selected: draft.food_category === 'food' ? true : null }, 'Food'),
    el('option', { value: 'beverage', selected: draft.food_category === 'beverage' ? true : null }, 'Beverage')
  ]);

  const priceIn = el('input', {
    type: 'number', step: '1', min: '0', value: draft.base_price, placeholder: 'Amount', class: inputCls,
    oninput: e => { draft.base_price = Number(e.target.value || 0); }
  });

  card.appendChild(field('Item Name', nameIn));
  card.appendChild(field('Shortcut (KOT)', shortIn));
  card.appendChild(field('Category', catIn));
  card.appendChild(field('Amount', priceIn));

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!draft.name || !draft.name.trim()) { toast('Name required', 'warn'); return; }
        
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: draft.tenant_id,
            name: draft.name.trim(),
            short_name: draft.short_name.trim().toUpperCase() || null,
            food_category: draft.food_category,
            base_price: Number(draft.base_price) || 0,
            is_active: true
          };
          if (isNew) {
            const { error } = await supabase.from('menu_items').insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('menu_items').update(payload).eq('id', item.id);
            if (error) throw error;
          }
          toast('Saved', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      },
    }, isNew ? 'Create' : 'Save'),
  ]);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => nameIn.focus(), 50);
}

// ============================================================
// CSV IMPORTER
// ============================================================
function openCSVImporter(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4' });
  
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Import Menu from CSV'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, 'Upload a CSV with two columns: Item Name and Amount. We will auto-generate shortcuts and categories.'));
  
  const fileIn = el('input', {
    type: 'file', accept: '.csv', 
    class: 'w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100'
  });

  card.appendChild(fileIn);

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      id: 'btn-import',
      class: 'py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const file = fileIn.files[0];
        if (!file) { toast('Select a CSV file', 'warn'); return; }
        
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Importing…';

        try {
          const text = await file.text();
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          
          const rows = [];
          for (let i = 0; i < lines.length; i++) {
            // Split by comma and handle quotes loosely
            const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
            if (parts.length < 2) continue;
            
            const name = parts[0];
            const price = parseFloat(parts[1]);
            
            // Skip headers
            if (i === 0 && isNaN(price)) continue;
            if (!name || isNaN(price)) continue;

            rows.push({
              tenant_id: store.state.tenant.id,
              name: name,
              short_name: generateShortcut(name),
              food_category: autoCategorize(name),
              base_price: price,
              is_active: true
            });
          }

          if (!rows.length) throw new Error('No valid rows found. Format: Item Name, Amount');

          // Bulk insert in chunks of 100 to avoid payload limits
          for (let i = 0; i < rows.length; i += 100) {
            const chunk = rows.slice(i, i + 100);
            const { error } = await supabase.from('menu_items').insert(chunk);
            if (error) throw error;
          }

          toast(`Successfully imported ${rows.length} items!`, 'success', 4000);
          overlay.remove();
          await refresh();
          paint(root);

        } catch (err) {
          toast('Import failed: ' + err.message, 'error', 5000);
          btn.disabled = false; btn.textContent = 'Import Data';
        }
      },
    }, 'Import Data'),
  ]);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
