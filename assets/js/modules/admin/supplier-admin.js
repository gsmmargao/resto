import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  suppliers: [],
  prices: [],
  ingredients: [],
  search: '',
  activeFilter: 'active',
  selectedId: null,
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderSupplierAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading suppliers…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[supplier-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;
  const [supRes, ingRes, priceRes] = await Promise.all([
    supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('ingredients').select('id, name, unit_id, units(name, abbreviation)')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('supplier_prices').select('*').eq('tenant_id', tenantId)
      .order('effective_from', { ascending: false }),
  ]);
  state.suppliers = supRes.data || [];
  state.ingredients = ingRes.data || [];
  state.prices = priceRes.data || [];
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Suppliers'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.suppliers.length} suppl${state.suppliers.length === 1 ? 'ier' : 'iers'}`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openSupplierEditor(root, null),
      }, '+ New Supplier'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderFilterBar(root));
  inner.appendChild(renderSupplierGrid(root));

  if (state.selectedId) {
    inner.appendChild(renderPriceListFor(state.selectedId, root));
  }
}

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });
  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search name / phone / GSTIN…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));
  const sel = el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.activeFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'active',   selected: state.activeFilter === 'active'   ? true : null }, 'Active only'),
    el('option', { value: 'inactive', selected: state.activeFilter === 'inactive' ? true : null }, 'Inactive only'),
    el('option', { value: 'all',      selected: state.activeFilter === 'all'      ? true : null }, 'All'),
  ]);
  bar.appendChild(sel);
  return bar;
}

// ============================================================
// SUPPLIER GRID
// ============================================================
function renderSupplierGrid(root) {
  const filtered = state.suppliers.filter(s => {
    if (state.activeFilter === 'active' && !s.is_active) return false;
    if (state.activeFilter === 'inactive' && s.is_active) return false;
    if (state.search) {
      const hay = `${s.name || ''} ${s.contact_person || ''} ${s.phone || ''} ${s.gstin || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Suppliers (${filtered.length})`),
  ]));

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No suppliers match'));
    return card;
  }

  const grid = el('div', { class: 'p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' });
  filtered.forEach(s => grid.appendChild(buildSupplierCard(s, root)));
  card.appendChild(grid);
  return card;
}

function buildSupplierCard(s, root) {
  const priceCount = state.prices.filter(p => p.supplier_id === s.id).length;
  const isSelected = state.selectedId === s.id;

  const card = el('div', {
    class: `bg-white rounded-xl border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : s.is_active ? 'border-slate-200' : 'border-dashed border-red-300 opacity-70'} overflow-hidden hover:shadow-md transition cursor-pointer`,
    onclick: () => { state.selectedId = isSelected ? null : s.id; paint(root); },
  });

  card.appendChild(el('div', { class: 'p-4' }, [
    el('div', { class: 'flex items-start justify-between gap-2' }, [
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'font-semibold text-slate-800 truncate' }, s.name),
        s.contact_person ? el('div', { class: 'text-xs text-slate-500 truncate mt-0.5' }, s.contact_person) : null,
      ].filter(Boolean)),
      s.is_active
        ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold shrink-0' }, 'ACTIVE')
        : el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold shrink-0' }, 'INACTIVE'),
    ]),
    el('div', { class: 'mt-3 space-y-1 text-xs text-slate-600' }, [
      s.phone ? el('div', { class: 'truncate' }, '📞 ' + s.phone) : null,
      s.email ? el('div', { class: 'truncate' }, '✉️ ' + s.email) : null,
      s.city  ? el('div', { class: 'truncate' }, '📍 ' + [s.city, s.state].filter(Boolean).join(', ')) : null,
      s.gstin ? el('div', { class: 'font-mono text-[10px] text-slate-400 truncate' }, 'GSTIN: ' + s.gstin) : null,
    ].filter(Boolean)),
  ]));

  card.appendChild(el('div', { class: 'px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between' }, [
    el('span', { class: 'text-[10px] text-slate-500' }, `${priceCount} price${priceCount !== 1 ? 's' : ''} on file`),
    el('div', { class: 'flex items-center gap-1' }, [
      el('button', {
        class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
        onclick: (e) => { e.stopPropagation(); openSupplierEditor(root, s); },
      }, 'Edit'),
      el('button', {
        class: `text-[10px] px-2 py-1 rounded ${s.is_active ? 'bg-red-50 hover:bg-red-100 text-red-600' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600'}`,
        onclick: async (e) => {
          e.stopPropagation();
          const { error } = await supabase.from('suppliers')
            .update({ is_active: !s.is_active }).eq('id', s.id);
          if (error) { toast('Failed: ' + error.message, 'error'); return; }
          s.is_active = !s.is_active;
          toast(s.is_active ? 'Activated' : 'Deactivated', 'success', 1200);
          paint(root);
        },
      }, s.is_active ? 'Disable' : 'Enable'),
    ]),
  ]));

  return card;
}

// ============================================================
// PRICE LIST PANEL
// ============================================================
function renderPriceListFor(supplierId, root) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) return el('div', { class: 'hidden' });

  const rows = state.prices.filter(p => p.supplier_id === supplierId);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('div', {}, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Price List — ${supplier.name}`),
      el('p', { class: 'text-[11px] text-slate-500' }, `${rows.length} ingredient${rows.length !== 1 ? 's' : ''}`),
    ]),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
      onclick: () => openPriceEditor(root, supplierId, null),
    }, '+ Add Price'),
  ]));

  if (!rows.length) {
    card.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No prices recorded yet — click "+ Add Price"'));
    return card;
  }

  const tbody = el('tbody');
  rows.sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id)).forEach(p => {
    const ing = state.ingredients.find(i => i.id === p.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2.5 text-sm text-slate-800' }, ing?.name || '—'),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700 font-semibold' }, `${fmtMoney(p.price)} / ${unit}`),
      el('td', { class: 'px-4 py-2.5 text-right text-xs text-slate-500' }, p.min_qty ? `min ${Number(p.min_qty)}` : '—'),
      el('td', { class: 'px-4 py-2.5 text-xs text-slate-500' }, new Date(p.effective_from).toLocaleDateString('en-IN')),
      el('td', { class: 'px-4 py-2.5 text-right w-24' }, [
        el('div', { class: 'flex justify-end gap-1' }, [
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700',
            onclick: () => openPriceEditor(root, supplierId, p),
          }, 'Edit'),
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600',
            onclick: async () => {
              const ok = await confirmDialog(`Remove this price?`, 'Remove price?');
              if (!ok) return;
              const { error } = await supabase.from('supplier_prices').delete().eq('id', p.id);
              if (error) { toast('Failed: ' + error.message, 'error'); return; }
              toast('Price removed', 'success');
              await refresh();
              paint(root);
            },
          }, '×'),
        ]),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Price'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Min Qty'),
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Effective From'),
        el('th', { class: 'text-right px-4 py-2 font-semibold w-24' }, ''),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

// ============================================================
// SUPPLIER EDITOR MODAL
// ============================================================
function openSupplierEditor(root, supplier) {
  const isNew = !supplier;
  const draft = supplier ? { ...supplier } : {
    tenant_id: store.state.tenant.id,
    name: '', contact_person: '', phone: '', email: '',
    gstin: '', address: '', city: '', state: '', pincode: '',
    payment_terms: 'Net 15', credit_days: 15, is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Supplier' : 'Edit Supplier'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  body.appendChild(field('Supplier name *', el('input', {
    type: 'text', value: draft.name, placeholder: 'e.g. Fresh Farm Veggies',
    class: inputCls, oninput: e => { draft.name = e.target.value; },
  })));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Contact person', el('input', {
      type: 'text', value: draft.contact_person || '', class: inputCls,
      oninput: e => { draft.contact_person = e.target.value; },
    })),
    field('Phone', el('input', {
      type: 'tel', value: draft.phone || '', class: inputCls,
      oninput: e => { draft.phone = e.target.value; },
    })),
  ]));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Email', el('input', {
      type: 'email', value: draft.email || '', class: inputCls,
      oninput: e => { draft.email = e.target.value; },
    })),
    field('GSTIN', el('input', {
      type: 'text', value: draft.gstin || '', class: inputCls,
      oninput: e => { draft.gstin = e.target.value; },
    })),
  ]));

  body.appendChild(field('Address', el('input', {
    type: 'text', value: draft.address || '', class: inputCls,
    oninput: e => { draft.address = e.target.value; },
  })));

  body.appendChild(el('div', { class: 'grid grid-cols-3 gap-3' }, [
    field('City', el('input', {
      type: 'text', value: draft.city || '', class: inputCls,
      oninput: e => { draft.city = e.target.value; },
    })),
    field('State', el('input', {
      type: 'text', value: draft.state || '', class: inputCls,
      oninput: e => { draft.state = e.target.value; },
    })),
    field('Pincode', el('input', {
      type: 'text', value: draft.pincode || '', class: inputCls,
      oninput: e => { draft.pincode = e.target.value; },
    })),
  ]));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Payment terms', el('input', {
      type: 'text', value: draft.payment_terms || '', placeholder: 'e.g. Net 15',
      class: inputCls, oninput: e => { draft.payment_terms = e.target.value; },
    })),
    field('Credit days', el('input', {
      type: 'number', min: 0, value: draft.credit_days || 0, class: inputCls,
      oninput: e => { draft.credit_days = Number(e.target.value) || 0; },
    })),
  ]));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    !isNew
      ? el('button', {
          class: 'px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 text-sm font-medium',
          onclick: async () => {
            const ok = await confirmDialog(
              `Delete supplier "${supplier.name}"? Their purchase orders and price history will remain, but you won't see them in pickers anymore.`,
              'Delete supplier?',
            );
            if (!ok) return;
            const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', supplier.id);
            if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
            toast('Supplier deactivated', 'success');
            overlay.remove();
            await refresh();
            paint(root);
          },
        }, 'Deactivate')
      : el('span', {}),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        id: 'btn-save-supplier',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, isNew ? 'Create' : 'Save'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  footer.querySelector('#btn-save-supplier').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!draft.name || !draft.name.trim()) { toast('Name is required', 'warn'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        tenant_id:      draft.tenant_id,
        name:           draft.name.trim(),
        contact_person: draft.contact_person?.trim() || null,
        phone:          draft.phone?.trim() || null,
        email:          draft.email?.trim() || null,
        gstin:          draft.gstin?.trim() || null,
        address:        draft.address?.trim() || null,
        city:           draft.city?.trim() || null,
        state:          draft.state?.trim() || null,
        pincode:        draft.pincode?.trim() || null,
        payment_terms:  draft.payment_terms?.trim() || null,
        credit_days:    Number(draft.credit_days) || 0,
        is_active:      draft.is_active !== false,
      };

      if (isNew) {
        const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
        if (error) throw error;
        state.suppliers.push(data);
        state.selectedId = data.id;
      } else {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', supplier.id);
        if (error) throw error;
        Object.assign(supplier, payload);
      }
      toast(isNew ? 'Supplier created' : 'Supplier saved', 'success');
      overlay.remove();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = isNew ? 'Create' : 'Save';
    }
  });
}

// ============================================================
// PRICE EDITOR
// ============================================================
function openPriceEditor(root, supplierId, price) {
  const isNew = !price;
  const draft = price ? { ...price } : {
    tenant_id: store.state.tenant.id,
    supplier_id: supplierId,
    ingredient_id: null,
    unit_id: null,
    price: 0,
    min_qty: 1,
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: null,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'Add Price' : 'Edit Price'));

  const ingSel = el('select', {
    class: inputCls,
    onchange: (e) => {
      draft.ingredient_id = e.target.value || null;
      const ing = state.ingredients.find(i => i.id === draft.ingredient_id);
      draft.unit_id = ing?.unit_id || null;
    },
  }, [
    el('option', { value: '' }, 'Select ingredient…'),
    ...state.ingredients.map(i => el('option', { value: i.id, selected: draft.ingredient_id === i.id ? true : null },
      i.name + (i.units?.abbreviation ? ` (${i.units.abbreviation})` : ''))),
  ]);
  card.appendChild(field('Ingredient *', ingSel));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Price per unit *', el('input', {
      type: 'number', step: '0.01', min: 0, value: draft.price,
      class: inputCls, oninput: e => { draft.price = Number(e.target.value || 0); },
    })),
    field('Min qty', el('input', {
      type: 'number', step: '0.001', min: 0, value: draft.min_qty,
      class: inputCls, oninput: e => { draft.min_qty = Number(e.target.value || 0); },
    })),
  ]));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Effective from', el('input', {
      type: 'date', value: draft.effective_from?.slice(0, 10) || '',
      class: inputCls, oninput: e => { draft.effective_from = e.target.value; },
    })),
    field('Effective to', el('input', {
      type: 'date', value: draft.effective_to?.slice(0, 10) || '',
      class: inputCls, oninput: e => { draft.effective_to = e.target.value || null; },
    })),
  ]));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!draft.ingredient_id) { toast('Select ingredient', 'warn'); return; }
        if (!draft.price || draft.price <= 0) { toast('Enter valid price', 'warn'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: draft.tenant_id,
            supplier_id: draft.supplier_id,
            ingredient_id: draft.ingredient_id,
            unit_id: draft.unit_id,
            price: Number(draft.price),
            min_qty: Number(draft.min_qty) || 1,
            effective_from: draft.effective_from || new Date().toISOString().slice(0, 10),
            effective_to: draft.effective_to || null,
          };
          if (isNew) {
            const { error } = await supabase.from('supplier_prices').insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('supplier_prices').update(payload).eq('id', price.id);
            if (error) throw error;
          }
          toast('Price saved', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      },
    }, isNew ? 'Add' : 'Save'),
  ]);
  card.appendChild(footer);

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
