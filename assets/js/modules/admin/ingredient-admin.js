import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  ingredients: [],
  categories: [],
  units: [],
  search: '',
  catFilter: 'all',
  showInactive: false,
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderIngredientAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading ingredients…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[ingredient-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;
  const [ingRes, catRes, unitRes] = await Promise.all([
    supabase.from('ingredients').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('ingredient_categories').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('units').select('*').eq('tenant_id', tenantId).order('abbreviation'),
  ]);
  state.ingredients = ingRes.data || [];
  state.categories  = catRes.data || [];
  state.units       = unitRes.data || [];
  state.loaded = true;
}

async function refresh() { state.loaded = false; await loadAll(); }

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Ingredients'),
      el('p', { class: 'text-xs text-slate-500' },
        `${state.ingredients.filter(i => i.is_active).length} active · ${state.categories.length} categories`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: () => openCategoryManager(root),
      }, '⚙ Categories'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openIngredientEditor(root, null),
      }, '+ New Ingredient'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderFilterBar(root));
  inner.appendChild(renderTable(root));
}

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });

  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search name / SKU / barcode…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.catFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all' }, 'All categories'),
    ...state.categories.map(c => el('option', { value: c.id, selected: state.catFilter === c.id ? true : null }, c.name)),
  ]));

  bar.appendChild(el('label', { class: 'flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm cursor-pointer' }, [
    el('input', {
      type: 'checkbox', checked: state.showInactive ? true : null,
      onchange: (e) => { state.showInactive = e.target.checked; paint(root); },
    }),
    el('span', { class: 'text-slate-700' }, 'Show inactive'),
  ]));

  return bar;
}

// ============================================================
// TABLE
// ============================================================
function renderTable(root) {
  const filtered = state.ingredients.filter(i => {
    if (!state.showInactive && !i.is_active) return false;
    if (state.catFilter !== 'all' && i.category_id !== state.catFilter) return false;
    if (state.search) {
      const hay = `${i.name || ''} ${i.sku || ''} ${i.barcode || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `${filtered.length} ingredient${filtered.length !== 1 ? 's' : ''}`),
  ]));

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No ingredients match your filters'));
    return card;
  }

  const tbody = el('tbody');
  filtered.forEach(ing => {
    const cat = state.categories.find(c => c.id === ing.category_id);
    const unit = state.units.find(u => u.id === ing.unit_id);

    tbody.appendChild(el('tr', { class: `border-t border-slate-100 hover:bg-slate-50 ${!ing.is_active ? 'opacity-60' : ''}` }, [
      el('td', { class: 'px-4 py-2.5' }, [
        el('div', { class: 'text-sm font-medium text-slate-800' }, ing.name),
        el('div', { class: 'text-[11px] text-slate-400' }, ing.sku || '—'),
      ]),
      el('td', { class: 'px-4 py-2.5 text-xs text-slate-500' }, cat?.name || '—'),
      el('td', { class: 'px-4 py-2.5 text-xs text-slate-500' }, unit?.abbreviation || '—'),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, fmtMoney(ing.avg_cost)),
      el('td', { class: 'px-4 py-2.5 text-right text-xs text-slate-500' }, `${Number(ing.min_stock)} / ${ing.max_stock ? Number(ing.max_stock) : '—'}`),
      el('td', { class: 'px-4 py-2.5 text-xs text-slate-500 capitalize' }, ing.storage_type || 'dry'),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-semibold ${ing.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}` },
          ing.is_active ? 'ACTIVE' : 'INACTIVE'),
      ]),
      el('td', { class: 'px-4 py-2.5 text-right w-28' }, [
        el('div', { class: 'flex justify-end gap-1' }, [
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
            onclick: () => openIngredientEditor(root, ing),
          }, 'Edit'),
          el('button', {
            class: `text-xs px-2 py-1 rounded ${ing.is_active ? 'bg-red-50 hover:bg-red-100 text-red-600' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'}`,
            onclick: async () => {
              const { error } = await supabase.from('ingredients')
                .update({ is_active: !ing.is_active }).eq('id', ing.id);
              if (error) { toast('Failed: ' + error.message, 'error'); return; }
              ing.is_active = !ing.is_active;
              toast(ing.is_active ? 'Activated' : 'Deactivated', 'success', 1200);
              paint(root);
            },
          }, ing.is_active ? 'Disable' : 'Enable'),
        ]),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Name'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Category'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Unit'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Cost'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Min/Max'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Storage'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Status'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

// ============================================================
// INGREDIENT EDITOR
// ============================================================
function openIngredientEditor(root, ing) {
  const isNew = !ing;
  const tenantId = store.state.tenant.id;
  const draft = ing ? { ...ing } : {
    tenant_id: tenantId,
    name: '', sku: '', barcode: '',
    category_id: state.categories[0]?.id || null,
    unit_id: state.units.find(u => u.abbreviation === 'kg')?.id || state.units[0]?.id || null,
    purchase_unit_id: null,
    conversion_factor: 1,
    avg_cost: 0,
    last_purchase_cost: null,
    min_stock: 0,
    max_stock: null,
    reorder_qty: null,
    storage_type: 'dry',
    shelf_life_days: null,
    is_batch_tracked: false,
    is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Ingredient' : 'Edit Ingredient'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  body.appendChild(field('Item Name *', el('input', {
    type: 'text', value: draft.name, placeholder: 'e.g. Amul Butter 500g',
    class: inputCls, oninput: e => { draft.name = e.target.value; },
  })));

  // Filter units to just the most common ones (kg, g, ltr, nos)
  const commonUnits = state.units.filter(u => ['kg', 'g', 'ltr', 'nos', 'l', 'pc'].includes(u.abbreviation.toLowerCase()));
  const unitList = commonUnits.length > 0 ? commonUnits : state.units;

  body.appendChild(field('Unit *', el('select', {
    class: inputCls, onchange: e => { draft.unit_id = e.target.value || null; },
  }, [
    el('option', { value: '' }, '— select unit —'),
    ...unitList.map(u => el('option', { value: u.id, selected: draft.unit_id === u.id ? true : null }, `${u.name} (${u.abbreviation})`)),
  ])));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    !isNew
      ? el('button', {
          class: 'px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium',
          onclick: async () => {
            const ok = await confirmDialog(
              `Delete "${ing.name}"? If it's used in any recipe, it will be deactivated instead.`,
              'Delete ingredient?',
            );
            if (!ok) return;
            const { error } = await supabase.from('ingredients').delete().eq('id', ing.id);
            if (!error) { toast('Deleted', 'success'); overlay.remove(); await refresh(); paint(root); return; }
            const { error: sErr } = await supabase.from('ingredients').update({ is_active: false }).eq('id', ing.id);
            if (sErr) { toast('Failed: ' + sErr.message, 'error'); return; }
            toast('Deactivated (in use)', 'success');
            overlay.remove(); await refresh(); paint(root);
          },
        }, 'Delete')
      : el('span', {}),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        id: 'btn-save-ing',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, isNew ? 'Create' : 'Save'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => card.querySelector('input[type="text"]')?.focus(), 50);

  footer.querySelector('#btn-save-ing').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
    if (!draft.unit_id) { toast('Select a unit', 'warn'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        tenant_id: tenantId,
        name: draft.name.trim(),
        unit_id: draft.unit_id,
        is_active: true,
        // Defaults for simplified form
        avg_cost: 0,
        min_stock: 0,
        storage_type: 'dry',
        is_batch_tracked: false
      };

      if (isNew) {
        const { error } = await supabase.from('ingredients').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ingredients').update(payload).eq('id', ing.id);
        if (error) throw error;
      }
      toast(isNew ? 'Ingredient created' : 'Ingredient saved', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = isNew ? 'Create' : 'Save';
    }
  });
}

// ============================================================
// CATEGORY MANAGER
// ============================================================
function openCategoryManager(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Ingredient Categories'));

  const list = el('div', { class: 'space-y-1 max-h-64 overflow-y-auto' });

  function paintList() {
    list.innerHTML = '';
    if (!state.categories.length) {
      list.appendChild(el('div', { class: 'text-center text-slate-400 text-sm py-4' }, 'No categories yet'));
    }
    state.categories.forEach(c => {
      const count = state.ingredients.filter(i => i.category_id === c.id && i.is_active).length;
      list.appendChild(el('div', { class: 'flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 border border-slate-100' }, [
        el('div', {}, [
          el('div', { class: 'text-sm font-medium text-slate-800' }, c.name),
          el('div', { class: 'text-[10px] text-slate-400' }, `${count} ingredient${count !== 1 ? 's' : ''}`),
        ]),
        el('button', {
          class: 'text-xs text-red-500 hover:text-red-700',
          onclick: async () => {
            const { error } = await supabase.from('ingredient_categories').delete().eq('id', c.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            state.categories = state.categories.filter(x => x.id !== c.id);
            toast('Category deleted', 'success');
            paintList();
          },
        }, 'Delete'),
      ]));
    });
  }

  card.appendChild(list);

  const nameIn = el('input', { type: 'text', placeholder: 'New category name', class: inputCls });
  const addRow = el('div', { class: 'flex gap-2' }, [
    nameIn,
    el('button', {
      class: 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold whitespace-nowrap',
      onclick: async () => {
        const name = nameIn.value.trim();
        if (!name) { toast('Enter a name', 'warn'); return; }
        const { data, error } = await supabase.from('ingredient_categories')
          .insert({ tenant_id: store.state.tenant.id, name }).select().single();
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        state.categories.push(data);
        state.categories.sort((a, b) => a.name.localeCompare(b.name));
        nameIn.value = '';
        toast('Category added', 'success');
        paintList();
      },
    }, 'Add'),
  ]);
  card.appendChild(addRow);

  card.appendChild(el('div', { class: 'flex justify-end pt-2' }, [
    el('button', {
      class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
      onclick: () => { overlay.remove(); paint(root); },
    }, 'Done'),
  ]));

  paintList();
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// SHARED
// ============================================================
const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
