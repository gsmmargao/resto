import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  recipes: [],
  ingredients: [],
  units: [],
  items: [],
  variants: [],
  search: '',
  filterType: 'all',       // 'all' | 'with' | 'without'
  catFilter: 'all',
  categories: [],
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderRecipeAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading recipes…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[recipe-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;

  const [recRes, ingRes, unitRes, itemRes, varRes, catRes] = await Promise.all([
    supabase.from('recipes').select('*, recipe_ingredients(id, ingredient_id, quantity, unit_id, wastage_percent, notes)')
      .eq('tenant_id', tenantId).order('computed_cost', { ascending: false }),
    supabase.from('ingredients').select('id, name, unit_id, avg_cost, is_active')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('units').select('id, name, abbreviation').eq('tenant_id', tenantId),
    supabase.from('menu_items').select('id, name, base_price, cost_price, category_id, item_type')
      .eq('tenant_id', tenantId).order('name'),
    supabase.from('menu_item_variants').select('id, menu_item_id, name, price, cost_price, is_active')
      .eq('tenant_id', tenantId).eq('is_active', true),
    supabase.from('menu_categories').select('id, name').eq('tenant_id', tenantId).order('sort_order'),
  ]);

  if (recRes.error)  console.error('[recipe] recipes', recRes.error);
  if (ingRes.error)  console.error('[recipe] ingredients', ingRes.error);
  if (unitRes.error) console.error('[recipe] units', unitRes.error);
  if (itemRes.error) console.error('[recipe] items', itemRes.error);
  if (varRes.error)  console.error('[recipe] variants', varRes.error);

  state.recipes     = recRes.data || [];
  state.ingredients = ingRes.data || [];
  state.units       = unitRes.data || [];
  state.items       = itemRes.data || [];
  state.variants    = varRes.data || [];
  state.categories  = catRes.data || [];

  console.log('[recipe] loaded', {
    recipes: state.recipes.length,
    ingredients: state.ingredients.length,
    items: state.items.length,
    variants: state.variants.length,
  });

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
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Recipes'),
      el('p', { class: 'text-xs text-slate-500' },
        `${state.recipes.length} recipe${state.recipes.length !== 1 ? 's' : ''} · ${state.items.length} menu items`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openRecipeEditor(root, null, null),
      }, '+ New Recipe'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderFilterBar(root));
  inner.appendChild(renderGrid(root));
}

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });

  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search item name…', value: state.search,
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

  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.filterType = e.target.value; paint(root); },
  }, [
    el('option', { value: 'all',     selected: state.filterType === 'all'     ? true : null }, 'All items'),
    el('option', { value: 'with',    selected: state.filterType === 'with'    ? true : null }, 'With recipe'),
    el('option', { value: 'without', selected: state.filterType === 'without' ? true : null }, 'Without recipe'),
  ]));

  return bar;
}

// ============================================================
// GRID — rows are menu items (with or without recipes)
// ============================================================
function renderGrid(root) {
  // Build a lookup of recipes by menu_item_id + variant_id
  const recipesByItem = new Map();   // key: `${menuItemId}::${variantId||'base'}`
  state.recipes.forEach(r => {
    const key = `${r.menu_item_id}::${r.variant_id || 'base'}`;
    recipesByItem.set(key, r);
  });

  // Flatten: base items + their variants
  const rows = [];
  state.items.forEach(item => {
    const cat = state.categories.find(c => c.id === item.category_id);
    if (state.catFilter !== 'all' && item.category_id !== state.catFilter) return;
    if (state.search && !item.name.toLowerCase().includes(state.search)) return;

    const baseRecipe = recipesByItem.get(`${item.id}::base`);
    rows.push({ type: 'item', item, variant: null, recipe: baseRecipe, category: cat });

    state.variants
      .filter(v => v.menu_item_id === item.id)
      .forEach(v => {
        const vRecipe = recipesByItem.get(`${item.id}::${v.id}`);
        rows.push({ type: 'variant', item, variant: v, recipe: vRecipe, category: cat });
      });
  });

  // Apply "with / without" filter
  const filtered = rows.filter(r => {
    if (state.filterType === 'with'    && !r.recipe) return false;
    if (state.filterType === 'without' && r.recipe)  return false;
    return true;
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `${filtered.length} row${filtered.length !== 1 ? 's' : ''}`),
    el('span', { class: 'text-xs text-slate-500' }, `${state.recipes.length} recipe${state.recipes.length !== 1 ? 's' : ''} defined`),
  ]));

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'Nothing matches your filters'));
    return card;
  }

  const tbody = el('tbody');
  filtered.forEach(r => tbody.appendChild(buildRow(r, root)));

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Menu Item'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Category'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Sell Price'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Cost'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Margin'),
        el('th', { class: 'text-center px-4 py-2.5 font-semibold' }, 'Ingredients'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-28' }, ''),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

function buildRow(r, root) {
  const sellPrice = Number(r.variant?.price ?? r.item.base_price ?? 0);
  const ingCount = r.recipe?.recipe_ingredients?.length || 0;

  // Compute live cost from linked ingredients
  const cost = r.recipe
    ? r.recipe.recipe_ingredients.reduce((s, ri) => {
        const ing = state.ingredients.find(i => i.id === ri.ingredient_id);
        const waste = 1 + (Number(ri.wastage_percent || 0) / 100);
        return s + (Number(ri.quantity) * waste * Number(ing?.avg_cost || 0));
      }, 0)
    : null;

  const margin = cost != null && sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : null;

  const variantLabel = r.variant ? ` (${r.variant.name})` : '';

  return el('tr', { class: `border-t border-slate-100 hover:bg-slate-50 ${!r.recipe ? 'bg-amber-50/30' : ''}` }, [
    el('td', { class: 'px-4 py-2.5' }, [
      el('div', { class: 'flex items-center gap-2' }, [
        el('span', { class: `inline-block w-3 h-3 rounded-sm border-2 ${r.item.item_type === 'non_veg' ? 'border-red-600' : 'border-emerald-600'}` }, [
          el('span', { class: `block w-1.5 h-1.5 rounded-full m-auto ${r.item.item_type === 'non_veg' ? 'bg-red-600' : 'bg-emerald-600'}` }),
        ]),
        el('span', { class: 'text-sm font-medium text-slate-800' }, r.item.name + variantLabel),
      ]),
      !r.recipe ? el('div', { class: 'text-[10px] text-amber-600 mt-0.5' }, 'No recipe — stock won\'t deduct') : null,
    ].filter(Boolean)),
    el('td', { class: 'px-4 py-2.5 text-xs text-slate-500 hidden md:table-cell' }, r.category?.name || '—'),
    el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, fmtMoney(sellPrice)),
    el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, cost != null ? fmtMoney(cost) : '—'),
    el('td', { class: 'px-4 py-2.5 text-right text-sm font-semibold' }, [
      margin != null
        ? el('span', { class: margin < 20 ? 'text-red-600' : margin < 40 ? 'text-amber-600' : 'text-emerald-600' }, margin.toFixed(1) + '%')
        : el('span', { class: 'text-slate-400' }, '—'),
    ]),
    el('td', { class: 'px-4 py-2.5 text-center text-xs text-slate-600' }, String(ingCount)),
    el('td', { class: 'px-4 py-2.5 text-right' }, [
      el('button', {
        class: r.recipe
          ? 'text-xs px-2.5 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium'
          : 'text-xs px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium',
        onclick: () => openRecipeEditor(root, r.item, r.variant, r.recipe),
      }, r.recipe ? 'Edit' : 'Add Recipe'),
    ]),
  ]);
}

// ============================================================
// RECIPE EDITOR
// ============================================================
async function openRecipeEditor(root, item, variant, recipe) {
  const isNew = !recipe;
  const tenantId = store.state.tenant.id;

  // If creating a new recipe, either the caller passed an item or we need to pick one
  let selectedItemId = item?.id || null;
  let selectedVariantId = variant?.id || null;

  const draft = {
    tenant_id: tenantId,
    menu_item_id: selectedItemId,
    variant_id: selectedVariantId,
    yield_quantity: recipe?.yield_quantity || 1,
    instructions: recipe?.instructions || '',
    is_active: recipe?.is_active !== false,
  };

  // Line items
  let lines = recipe?.recipe_ingredients?.map(ri => ({
    id: ri.id,
    ingredient_id: ri.ingredient_id,
    quantity: Number(ri.quantity),
    unit_id: ri.unit_id,
    wastage_percent: Number(ri.wastage_percent || 0),
    notes: ri.notes || '',
  })) || [];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col max-h-[92vh]' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
    el('div', {}, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Recipe' : 'Edit Recipe'),
      el('p', { class: 'text-xs text-slate-500 mt-0.5' }, recipe ? `Recipe ID ${recipe.id.slice(0, 8)}` : 'Link ingredients to a menu item'),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4 overflow-y-auto' });

  // ----- Item & variant picker -----
  const itemSel = el('select', {
    class: inputCls,
    disabled: !isNew ? true : null,
    onchange: (e) => {
      selectedItemId = e.target.value || null;
      draft.menu_item_id = selectedItemId;
      // Clear variant if item changes
      selectedVariantId = null;
      draft.variant_id = null;
      renderVariantPicker();
    },
  }, [
    el('option', { value: '' }, 'Select menu item…'),
    ...state.items.map(i => el('option', { value: i.id, selected: draft.menu_item_id === i.id ? true : null }, i.name)),
  ]);

  const variantContainer = el('div', { id: 'variant-picker-container' });

  function renderVariantPicker() {
    variantContainer.innerHTML = '';

    if (!selectedItemId) return;

    const variants = state.variants.filter(v => v.menu_item_id === selectedItemId);

    // Show "already exists" banner based on current item+variant
    const match = state.recipes.find(r =>
      r.menu_item_id === selectedItemId &&
      (r.variant_id || null) === (selectedVariantId || null)
    );
    if (match && isNew) {
      variantContainer.appendChild(el('div', { class: 'mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800' }, [
        'This item + variant already has a recipe. Saving will ',
        el('strong', {}, 'update the existing recipe'),
        ' instead of creating a duplicate.',
      ]));
    }

    if (!variants.length) {
      variantContainer.appendChild(el('div', { class: 'text-[11px] text-slate-500 mt-1' }, 'This item has no variants — recipe applies to the base item.'));
      return;
    }

    variantContainer.appendChild(el('label', { class: 'block text-xs font-medium text-slate-600 mb-1 mt-1' }, 'Variant (leave blank for base recipe)'));
    variantContainer.appendChild(el('select', {
      class: inputCls,
      disabled: !isNew ? true : null,
      onchange: (e) => {
        selectedVariantId = e.target.value || null;
        draft.variant_id = selectedVariantId;
        renderVariantPicker();
      },
    }, [
      el('option', { value: '' }, '— Base (no variant) —'),
      ...variants.map(v => el('option', { value: v.id, selected: draft.variant_id === v.id ? true : null }, v.name)),
    ]));
  }

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [fieldLabel('Menu item *'), itemSel]),
    el('div', {}, [fieldLabel('Yield (portions)'), el('input', {
      type: 'number', step: '0.01', min: '0.01', value: draft.yield_quantity, class: inputCls,
      oninput: e => { draft.yield_quantity = Number(e.target.value) || 1; },
    })]),
  ]));

  body.appendChild(variantContainer);
  renderVariantPicker();

  // ----- Ingredient lines -----
  const linesCard = el('div', { class: 'border border-slate-200 rounded-xl overflow-hidden' });
  linesCard.appendChild(el('div', { class: 'px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('h4', { class: 'font-semibold text-slate-700 text-sm' }, 'Ingredients'),
      el('p', { class: 'text-[11px] text-slate-500' }, 'Quantity consumed per portion'),
    ]),
    el('button', {
      class: 'text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold',
      onclick: () => {
        lines.push({ ingredient_id: null, quantity: 0, unit_id: null, wastage_percent: 0, notes: '' });
        renderLines();
      },
    }, '+ Add Ingredient'),
  ]));

  const linesBody = el('div', { class: 'divide-y divide-slate-100' });
  const totalsBox = el('div', { class: 'bg-slate-50 rounded-lg p-4 mt-4 space-y-1 text-sm' });

  function renderLines() {
    linesBody.innerHTML = '';
    if (!lines.length) {
      linesBody.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No ingredients yet — click "+ Add Ingredient"'));
    }

    lines.forEach((l, i) => {
      const ing = state.ingredients.find(x => x.id === l.ingredient_id);
      const unit = state.units.find(u => u.id === l.unit_id) || (ing?.unit_id ? state.units.find(u => u.id === ing.unit_id) : null);

      const row = el('div', { class: 'p-3 grid grid-cols-12 gap-2 items-end' });

      row.appendChild(el('div', { class: 'col-span-5' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Ingredient'),
        el('select', {
          class: inputCls + ' text-xs py-1.5',
          onchange: (e) => {
            l.ingredient_id = e.target.value || null;
            const fresh = state.ingredients.find(x => x.id === l.ingredient_id);
            l.unit_id = fresh?.unit_id || null;
            renderLines();
          },
        }, [
          el('option', { value: '' }, '— select —'),
          ...state.ingredients.map(x => el('option', { value: x.id, selected: l.ingredient_id === x.id ? true : null }, x.name)),
        ]),
      ]));

      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Qty ${unit?.abbreviation || ''}`),
        el('input', {
          type: 'number', step: '0.0001', min: 0, value: l.quantity,
          class: inputCls + ' text-xs py-1.5',
          oninput: e => { l.quantity = Number(e.target.value || 0); renderLines(); },
        }),
      ]));

      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Wastage %'),
        el('input', {
          type: 'number', step: '0.1', min: 0, max: 100, value: l.wastage_percent,
          class: inputCls + ' text-xs py-1.5',
          oninput: e => { l.wastage_percent = Number(e.target.value || 0); renderLines(); },
        }),
      ]));

      const lineCost = (Number(l.quantity) * (1 + Number(l.wastage_percent || 0) / 100) * Number(ing?.avg_cost || 0));
      row.appendChild(el('div', { class: 'col-span-2 text-right pb-1' }, [
        el('div', { class: 'text-[10px] uppercase text-slate-500 mb-0.5' }, 'Cost'),
        el('div', { class: 'text-sm font-semibold text-slate-800' }, fmtMoney(lineCost)),
      ]));

      row.appendChild(el('div', { class: 'col-span-1 flex justify-end pb-1' }, [
        el('button', {
          class: 'text-red-500 hover:text-red-700 text-lg leading-none',
          onclick: () => { lines.splice(i, 1); renderLines(); },
        }, '×'),
      ]));

      linesBody.appendChild(row);
    });

    updateTotals();
  }

  function updateTotals() {
    const totalCost = lines.reduce((s, l) => {
      const ing = state.ingredients.find(x => x.id === l.ingredient_id);
      return s + (Number(l.quantity) * (1 + Number(l.wastage_percent || 0) / 100) * Number(ing?.avg_cost || 0));
    }, 0);

    const sellPrice = Number(
      (selectedVariantId ? state.variants.find(v => v.id === selectedVariantId)?.price : null)
      ?? state.items.find(i => i.id === selectedItemId)?.base_price
      ?? 0
    );

    const margin = sellPrice > 0 ? ((sellPrice - totalCost) / sellPrice) * 100 : null;

    totalsBox.innerHTML = '';
    totalsBox.appendChild(totalsRow('Ingredient cost', fmtMoney(totalCost)));
    totalsBox.appendChild(totalsRow('Selling price', fmtMoney(sellPrice)));
    if (margin != null) {
      totalsBox.appendChild(el('div', { class: 'flex justify-between pt-2 mt-1 border-t border-slate-200 font-semibold' }, [
        el('span', { class: 'text-slate-900' }, 'Margin'),
        el('span', { class: margin < 20 ? 'text-red-600' : margin < 40 ? 'text-amber-600' : 'text-emerald-600' }, margin.toFixed(1) + '%'),
      ]));
    }
  }

  function totalsRow(label, val) {
    return el('div', { class: 'flex justify-between text-slate-600' }, [
      el('span', {}, label),
      el('span', { class: 'font-medium' }, val),
    ]);
  }

  linesCard.appendChild(linesBody);
  body.appendChild(linesCard);
  body.appendChild(totalsBox);

  // Instructions
  body.appendChild(fieldLabel('Instructions'));
  body.appendChild(el('textarea', {
    rows: '2', placeholder: 'Optional cooking notes…', value: draft.instructions,
    class: inputCls + ' resize-none',
    oninput: e => { draft.instructions = e.target.value; },
  }));

  card.appendChild(body);

  // Footer
  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl shrink-0' }, [
    !isNew
      ? el('button', {
          class: 'px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium',
          onclick: async () => {
            const ok = await confirmDialog(
              'Delete this recipe? Stock will stop deducting for this item.',
              'Delete recipe?',
            );
            if (!ok) return;
            const { error } = await supabase.from('recipes').delete().eq('id', recipe.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            toast('Recipe deleted', 'success');
            overlay.remove();
            await refresh();
            paint(root);
          },
        }, 'Delete')
      : el('span', {}),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        id: 'btn-save-recipe',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, isNew ? 'Create Recipe' : 'Save Changes'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  renderLines();

  footer.querySelector('#btn-save-recipe').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!draft.menu_item_id) { toast('Select a menu item', 'warn'); return; }
    const validLines = lines.filter(l => l.ingredient_id && l.quantity > 0);
    if (!validLines.length) { toast('Add at least one ingredient', 'warn'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveRecipe({ draft, lines: validLines, isNew, existingRecipe: recipe });
      toast(isNew ? 'Recipe created' : 'Recipe saved', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = isNew ? 'Create Recipe' : 'Save Changes';
    }
  });
}

async function saveRecipe({ draft, lines, isNew, existingRecipe }) {
  // Compute cost from current ingredient avg_cost
  const computedCost = lines.reduce((s, l) => {
    const ing = state.ingredients.find(x => x.id === l.ingredient_id);
    return s + (Number(l.quantity) * (1 + Number(l.wastage_percent || 0) / 100) * Number(ing?.avg_cost || 0));
  }, 0);

  // ---- Detect existing recipe for this exact item + variant combo ----
  // Handles the case where the seed already created one (e.g. Butter Chicken Half).
  const existing = state.recipes.find(r =>
    r.menu_item_id === draft.menu_item_id &&
    (r.variant_id || null) === (draft.variant_id || null)
  );

  let recipeId = existingRecipe?.id || existing?.id || null;
  const shouldUpdate = !!recipeId;

  if (!shouldUpdate) {
    // ---- Fresh insert ----
    const payload = {
      tenant_id: draft.tenant_id,
      menu_item_id: draft.menu_item_id,
      variant_id: draft.variant_id || null,
      yield_quantity: Number(draft.yield_quantity) || 1,
      instructions: draft.instructions?.trim() || null,
      computed_cost: computedCost,
      is_active: true,
    };
    const { data, error } = await supabase.from('recipes').insert(payload).select('id').single();
    if (error) throw error;
    recipeId = data.id;
  } else {
    // ---- Update existing ----
    const { error } = await supabase.from('recipes').update({
      yield_quantity: Number(draft.yield_quantity) || 1,
      instructions: draft.instructions?.trim() || null,
      computed_cost: computedCost,
      is_active: draft.is_active !== false,
    }).eq('id', recipeId);
    if (error) throw error;
  }

  // Wipe and re-insert ingredient lines
  await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);

  const rows = lines.map(l => ({
    tenant_id: draft.tenant_id,
    recipe_id: recipeId,
    ingredient_id: l.ingredient_id,
    quantity: Number(l.quantity),
    unit_id: l.unit_id || null,
    wastage_percent: Number(l.wastage_percent) || 0,
    notes: l.notes || null,
  }));
  const { error: riErr } = await supabase.from('recipe_ingredients').insert(rows);
  if (riErr) throw riErr;

  // Update the menu item / variant cost_price
  if (!draft.variant_id) {
    await supabase.from('menu_items')
      .update({ cost_price: computedCost })
      .eq('id', draft.menu_item_id);
  } else {
    await supabase.from('menu_item_variants')
      .update({ cost_price: computedCost })
      .eq('id', draft.variant_id);
  }
}

// ============================================================
// SHARED
// ============================================================
const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function fieldLabel(text) {
  return el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, text);
}
