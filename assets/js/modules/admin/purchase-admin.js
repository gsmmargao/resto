import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  tab: 'pos',       // 'pos' | 'grns'
  pos: [],
  grns: [],
  suppliers: [],
  ingredients: [],
  poItems: {},      // poId -> items[]
  search: '',
  statusFilter: 'open',
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderPurchaseAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading purchases…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[purchase-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;
  const outletId = store.state.outlet.id;

  const [poRes, grnRes, supRes, ingRes] = await Promise.all([
    supabase.from('purchase_orders').select('*, suppliers(name)').eq('outlet_id', outletId).order('created_at', { ascending: false }),
    supabase.from('goods_receipts').select('*, suppliers(name)').eq('outlet_id', outletId).order('received_at', { ascending: false }),
    supabase.from('suppliers').select('id, name, is_active').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('ingredients').select('id, name, unit_id, avg_cost, units(name, abbreviation)')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
  ]);

  state.pos = poRes.data || [];
  state.grns = grnRes.data || [];
  state.suppliers = supRes.data || [];
  state.ingredients = ingRes.data || [];

  // Preload PO line items
  state.poItems = {};
  if (state.pos.length) {
    const poIds = state.pos.map(p => p.id);
    const { data: items } = await supabase.from('purchase_order_items')
      .select('*').in('purchase_order_id', poIds);
    (items || []).forEach(it => {
      if (!state.poItems[it.purchase_order_id]) state.poItems[it.purchase_order_id] = [];
      state.poItems[it.purchase_order_id].push(it);
    });
  }

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
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Purchases'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.pos.length} PO · ${state.grns.length} GRN`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
        onclick: () => openPOEditor(root, null),
      }, '+ New PO'),
    ]),
  ]);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1' },
    [['pos', 'Purchase Orders'], ['grns', 'Goods Receipts']].map(([key, label]) =>
      el('button', {
        class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
        onclick: () => { state.tab = key; paint(root); },
      }, label)));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);

  wrap.appendChild(header);
  wrap.appendChild(tabs);
  wrap.appendChild(body);
  root.appendChild(wrap);

  if (state.tab === 'pos')  inner.appendChild(renderPOList(root));
  else                      inner.appendChild(renderGRNList(root));
}

// ============================================================
// PURCHASE ORDERS
// ============================================================
function renderPOList(root) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Purchase Orders'),
    el('div', { class: 'flex items-center gap-2' }, [
      el('input', {
        type: 'search', placeholder: 'Search PO# / supplier…', value: state.search,
        class: 'px-3 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500',
        oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
      }),
      el('select', {
        class: 'px-3 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500',
        onchange: (e) => { state.statusFilter = e.target.value; paint(root); },
      }, [
        ['open',           'Open (draft/sent/partial)'],
        ['draft',          'Draft'],
        ['sent',           'Sent'],
        ['partially_received', 'Partially received'],
        ['received',       'Received'],
        ['cancelled',      'Cancelled'],
        ['all',            'All'],
      ].map(([v, l]) => el('option', { value: v, selected: state.statusFilter === v ? true : null }, l))),
    ]),
  ]));

  const filtered = state.pos.filter(po => {
    if (state.search) {
      const hay = `${po.po_number || ''} ${po.suppliers?.name || ''}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    if (state.statusFilter === 'open' && !['draft', 'sent', 'partially_received'].includes(po.status)) return false;
    if (state.statusFilter !== 'open' && state.statusFilter !== 'all' && po.status !== state.statusFilter) return false;
    return true;
  });

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No purchase orders yet — click "+ New PO" to create one'));
    return card;
  }

  const tbody = el('tbody');
  filtered.forEach(po => {
    const itemCount = (state.poItems[po.id] || []).length;
    const badge = statusBadge(po.status);

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50 cursor-pointer', onclick: () => openPODetail(root, po) }, [
      el('td', { class: 'px-4 py-2.5' }, [
        el('div', { class: 'font-mono text-sm text-slate-800' }, po.po_number),
        el('div', { class: 'text-[11px] text-slate-500' }, new Date(po.created_at).toLocaleDateString('en-IN')),
      ]),
      el('td', { class: 'px-4 py-2.5 text-sm text-slate-700' }, po.suppliers?.name || '—'),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-600' }, `${itemCount} item${itemCount !== 1 ? 's' : ''}`),
      el('td', { class: 'px-4 py-2.5 text-right text-sm font-semibold text-slate-800' }, fmtMoney(po.grand_total)),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${badge.cls}` }, badge.label),
      ]),
      el('td', { class: 'px-4 py-2.5 text-right w-24' }, [
        el('div', { class: 'flex justify-end gap-1' }, [
          po.status === 'draft' || po.status === 'sent' || po.status === 'partially_received'
            ? el('button', {
                class: 'text-xs px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-medium',
                onclick: (e) => { e.stopPropagation(); openGRNEditor(root, po); },
              }, 'Receive')
            : null,
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700',
            onclick: (e) => { e.stopPropagation(); openPODetail(root, po); },
          }, 'View'),
        ].filter(Boolean)),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'PO #'),
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Supplier'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Items'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Total'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Status'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

function statusBadge(status) {
  return {
    draft:              { label: 'Draft',      cls: 'bg-slate-100 text-slate-700' },
    sent:               { label: 'Sent',       cls: 'bg-blue-100 text-blue-700' },
    partially_received: { label: 'Partial',    cls: 'bg-amber-100 text-amber-700' },
    received:           { label: 'Received',   cls: 'bg-emerald-100 text-emerald-700' },
    cancelled:          { label: 'Cancelled',  cls: 'bg-red-100 text-red-700' },
    closed:             { label: 'Closed',     cls: 'bg-slate-200 text-slate-600' },
  }[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
}

// ============================================================
// PO CREATOR / EDITOR
// ============================================================
async function openPOEditor(root, po) {
  const isNew = !po;
  const draft = po ? { ...po } : {
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    supplier_id: null,
    status: 'draft',
    order_date: new Date().toISOString().slice(0, 10),
    expected_date: null,
    notes: '',
  };
  let lines = po ? (state.poItems[po.id] || []).map(l => ({ ...l })) : [];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col max-h-[92vh]' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Purchase Order' : `PO ${po.po_number}`),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4 overflow-y-auto' });

  // Header fields
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Supplier *', el('select', {
      class: inputCls,
      onchange: e => { draft.supplier_id = e.target.value || null; },
      disabled: !isNew ? true : null,
    }, [
      el('option', { value: '' }, 'Select supplier…'),
      ...state.suppliers.map(s => el('option', { value: s.id, selected: draft.supplier_id === s.id ? true : null }, s.name)),
    ])),
    field('Order date', el('input', {
      type: 'date', value: draft.order_date || '', class: inputCls, disabled: !isNew ? true : null,
      oninput: e => { draft.order_date = e.target.value; },
    })),
  ]));

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Expected delivery', el('input', {
      type: 'date', value: draft.expected_date || '', class: inputCls,
      oninput: e => { draft.expected_date = e.target.value || null; },
    })),
    field('Notes', el('input', {
      type: 'text', value: draft.notes || '', placeholder: 'Optional', class: inputCls,
      oninput: e => { draft.notes = e.target.value; },
    })),
  ]));

  // Line items
  const linesCard = el('div', { class: 'border border-slate-200 rounded-xl overflow-hidden' });
  linesCard.appendChild(el('div', { class: 'px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between' }, [
    el('h4', { class: 'font-semibold text-slate-700 text-sm' }, 'Line Items'),
    el('button', {
      class: 'text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold',
      onclick: () => {
        lines.push({ ingredient_id: null, quantity: 0, unit_id: null, unit_price: 0, tax_rate: 0.05, discount_amount: 0, line_total: 0, received_qty: 0 });
        renderLines();
      },
    }, '+ Add Line'),
  ]));

  const linesBody = el('div', { class: 'divide-y divide-slate-100' });
  linesCard.appendChild(linesBody);
  body.appendChild(linesCard);

  // Totals
  const totalsBox = el('div', { class: 'bg-slate-50 rounded-lg p-4 space-y-1 text-sm' });
  body.appendChild(totalsBox);

  function renderLines() {
    linesBody.innerHTML = '';
    if (!lines.length) {
      linesBody.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No line items yet'));
    }
    lines.forEach((l, i) => {
      const ing = state.ingredients.find(x => x.id === l.ingredient_id);
      const unit = ing?.units?.abbreviation || '';

      const row = el('div', { class: 'p-3 grid grid-cols-12 gap-2 items-end' });

      // Ingredient picker
      row.appendChild(el('div', { class: 'col-span-5' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Ingredient'),
        el('select', {
          class: inputCls + ' text-xs py-1.5',
          onchange: (e) => {
            l.ingredient_id = e.target.value || null;
            const freshIng = state.ingredients.find(x => x.id === l.ingredient_id);
            l.unit_id = freshIng?.unit_id || null;
            if (freshIng && (!l.unit_price || l.unit_price === 0)) l.unit_price = Number(freshIng.avg_cost) || 0;
            renderLines();
          },
        }, [
          el('option', { value: '' }, '— select —'),
          ...state.ingredients.map(x => el('option', { value: x.id, selected: l.ingredient_id === x.id ? true : null }, x.name)),
        ]),
      ]));

      // Qty
      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Qty ${unit}`),
        el('input', {
          type: 'number', step: '0.001', min: 0, value: l.quantity,
          class: inputCls + ' text-xs py-1.5',
          oninput: e => { l.quantity = Number(e.target.value || 0); updateTotals(); },
        }),
      ]));

      // Price
      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Price/${unit}`),
        el('input', {
          type: 'number', step: '0.01', min: 0, value: l.unit_price,
          class: inputCls + ' text-xs py-1.5',
          oninput: e => { l.unit_price = Number(e.target.value || 0); updateTotals(); },
        }),
      ]));

      // Line total
      const total = l.quantity * l.unit_price;
      row.appendChild(el('div', { class: 'col-span-2 text-right pb-1' }, [
        el('div', { class: 'text-[10px] uppercase text-slate-500 mb-0.5' }, 'Total'),
        el('div', { class: 'text-sm font-semibold text-slate-800' }, fmtMoney(total)),
      ]));

      // Remove
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
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
    const tax = lines.reduce((s, l) => s + (l.quantity * l.unit_price * (l.tax_rate || 0.05)), 0);
    const grand = subtotal + tax;

    totalsBox.innerHTML = '';
    totalsBox.appendChild(totalsRow('Subtotal', subtotal));
    totalsBox.appendChild(totalsRow('Tax',      tax));
    totalsBox.appendChild(el('div', { class: 'flex justify-between pt-2 mt-1 border-t border-slate-200 font-semibold text-slate-900' }, [
      el('span', {}, 'Grand Total'),
      el('span', {}, fmtMoney(grand)),
    ]));
  }

  function totalsRow(label, val) {
    return el('div', { class: 'flex justify-between text-slate-600' }, [
      el('span', {}, label),
      el('span', { class: 'font-medium' }, fmtMoney(val)),
    ]);
  }

  card.appendChild(body);

  // Footer
  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl shrink-0' }, [
    el('span', {}),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      isNew
        ? el('button', {
            id: 'btn-save-draft',
            class: 'px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium',
          }, 'Save as Draft')
        : null,
      el('button', {
        id: 'btn-save-po',
        class: 'px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow',
      }, isNew ? 'Create & Send' : 'Save Changes'),
    ].filter(Boolean)),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  renderLines();

  // Handlers
  footer.querySelector('#btn-save-po').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await savePO({ draft, lines, isNew, existingPo: po, send: isNew ? 'sent' : 'keep' });
      toast(isNew ? 'PO created & sent' : 'PO updated', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = isNew ? 'Create & Send' : 'Save Changes';
    }
  });

  if (isNew) {
    footer.querySelector('#btn-save-draft').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await savePO({ draft, lines, isNew, existingPo: null, send: 'draft' });
        toast('PO saved as draft', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Save as Draft';
      }
    });
  }
}

async function savePO({ draft, lines, isNew, existingPo, send }) {
  if (!draft.supplier_id) throw new Error('Select a supplier');
  const validLines = lines.filter(l => l.ingredient_id && l.quantity > 0);
  if (!validLines.length) throw new Error('Add at least one line item');

  const subtotal = validLines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
  const taxTotal = validLines.reduce((s, l) => s + (l.quantity * l.unit_price * (l.tax_rate || 0.05)), 0);
  const grandTotal = subtotal + taxTotal;

  let poId = existingPo?.id;

  if (isNew) {
    const { data: poNo } = await supabase.rpc('next_doc_number', {
      p_outlet: draft.outlet_id,
      p_doc_type: 'po',
    });

    const payload = {
      tenant_id: draft.tenant_id,
      outlet_id: draft.outlet_id,
      supplier_id: draft.supplier_id,
      po_number: poNo || 'PO-' + Date.now(),
      status: send === 'draft' ? 'draft' : 'sent',
      order_date: draft.order_date,
      expected_date: draft.expected_date || null,
      subtotal,
      tax_total: taxTotal,
      grand_total: grandTotal,
      notes: draft.notes || null,
      created_by: store.state.session?.user?.id || null,
    };
    const { data, error } = await supabase.from('purchase_orders').insert(payload).select().single();
    if (error) throw error;
    poId = data.id;
  } else {
    const { error } = await supabase.from('purchase_orders').update({
      expected_date: draft.expected_date || null,
      subtotal, tax_total: taxTotal, grand_total: grandTotal,
      notes: draft.notes || null,
    }).eq('id', poId);
    if (error) throw error;
  }

  // Replace line items
  await supabase.from('purchase_order_items').delete().eq('purchase_order_id', poId);

  const rows = validLines.map(l => ({
    tenant_id: draft.tenant_id,
    purchase_order_id: poId,
    ingredient_id: l.ingredient_id,
    quantity: Number(l.quantity),
    unit_id: l.unit_id,
    unit_price: Number(l.unit_price),
    tax_rate: Number(l.tax_rate) || 0.05,
    discount_amount: Number(l.discount_amount) || 0,
    line_total: l.quantity * l.unit_price * (1 + (l.tax_rate || 0.05)),
    received_qty: 0,
  }));
  const { error: iErr } = await supabase.from('purchase_order_items').insert(rows);
  if (iErr) throw iErr;
}

// ============================================================
// PO DETAIL
// ============================================================
function openPODetail(root, po) {
  const items = state.poItems[po.id] || [];
  const badge = statusBadge(po.status);

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('div', { class: 'font-mono text-sm text-slate-500' }, po.po_number),
      el('h3', { class: 'font-bold text-lg text-slate-800' }, po.suppliers?.name || '—'),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${badge.cls}` }, badge.label),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
    ]),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3 text-sm' }, [
    kv('Order date', new Date(po.order_date).toLocaleDateString('en-IN')),
    kv('Expected', po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-IN') : '—'),
  ]));

  const tbody = el('tbody');
  items.forEach(it => {
    const ing = state.ingredients.find(x => x.id === it.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, ing?.name || '—'),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, `${Number(it.quantity)} ${unit}`),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, fmtMoney(it.unit_price)),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, `${Number(it.received_qty || 0)} / ${Number(it.quantity)}`),
      el('td', { class: 'px-4 py-2 text-right text-sm font-semibold text-slate-800' }, fmtMoney(it.line_total)),
    ]));
  });

  body.appendChild(el('table', { class: 'w-full border border-slate-200 rounded-lg overflow-hidden' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Ordered'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Unit Price'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Received'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Total'),
      ]),
    ]),
    tbody,
  ]));

  body.appendChild(el('div', { class: 'bg-slate-50 rounded-lg p-4 space-y-1 text-sm' }, [
    el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-600' }, 'Subtotal'),  el('span', { class: 'font-medium' }, fmtMoney(po.subtotal))]),
    el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-600' }, 'Tax'),       el('span', { class: 'font-medium' }, fmtMoney(po.tax_total))]),
    el('div', { class: 'flex justify-between pt-2 mt-1 border-t border-slate-200 font-semibold text-slate-900 text-base' }, [
      el('span', {}, 'Grand Total'), el('span', {}, fmtMoney(po.grand_total)),
    ]),
  ]));

  if (po.notes) body.appendChild(el('div', { class: 'text-xs text-slate-500 italic' }, 'Notes: ' + po.notes));

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 rounded-b-2xl' }, [
    ['draft', 'sent', 'partially_received'].includes(po.status) ? el('button', {
      class: 'px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium',
      onclick: async () => {
        const ok = await confirmDialog(`Cancel PO ${po.po_number}?`, 'Cancel PO?');
        if (!ok) return;
        const { error } = await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', po.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast('PO cancelled', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      },
    }, 'Cancel PO') : null,
    ['draft', 'sent', 'partially_received'].includes(po.status) ? el('button', {
      class: 'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow',
      onclick: () => { overlay.remove(); openGRNEditor(root, po); },
    }, 'Receive Goods') : null,
    el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Close'),
  ].filter(Boolean));

  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function kv(label, value) {
  return el('div', {}, [
    el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, label),
    el('div', { class: 'text-sm font-medium text-slate-800 mt-0.5' }, value),
  ]);
}

// ============================================================
// GRN EDITOR
// ============================================================
function openGRNEditor(root, po) {
  const items = state.poItems[po.id] || [];
  const remaining = items.map(it => ({
    ...it,
    remaining_qty: Number(it.quantity) - Number(it.received_qty || 0),
  })).filter(it => it.remaining_qty > 0);

  if (!remaining.length) { toast('Nothing left to receive', 'warn'); return; }

  const draft = {
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    supplier_id: po.supplier_id,
    purchase_order_id: po.id,
    supplier_invoice_no: '',
    supplier_invoice_date: new Date().toISOString().slice(0, 10),
    received_at: new Date().toISOString(),
    notes: '',
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col max-h-[92vh]' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 shrink-0' }, [
    el('div', { class: 'font-mono text-xs text-slate-500' }, po.po_number),
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Receive Goods'),
    el('p', { class: 'text-xs text-slate-500 mt-0.5' }, po.suppliers?.name || ''),
  ]));

  const body = el('div', { class: 'p-5 space-y-4 overflow-y-auto' });

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Supplier invoice #', el('input', {
      type: 'text', value: draft.supplier_invoice_no, class: inputCls,
      oninput: e => { draft.supplier_invoice_no = e.target.value; },
    })),
    field('Invoice date', el('input', {
      type: 'date', value: draft.supplier_invoice_date, class: inputCls,
      oninput: e => { draft.supplier_invoice_date = e.target.value; },
    })),
  ]));

  body.appendChild(field('Notes', el('input', {
    type: 'text', value: draft.notes, placeholder: 'Optional', class: inputCls,
    oninput: e => { draft.notes = e.target.value; },
  })));

  // Receive lines
  const receiveCard = el('div', { class: 'border border-slate-200 rounded-xl overflow-hidden' });
  receiveCard.appendChild(el('div', { class: 'px-4 py-2.5 bg-slate-50 border-b border-slate-200' }, [
    el('h4', { class: 'font-semibold text-slate-700 text-sm' }, 'Items'),
  ]));

  const linesBody = el('div', { class: 'divide-y divide-slate-100' });

  remaining.forEach(r => {
    const ing = state.ingredients.find(x => x.id === r.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    const lineCtx = {
      order_item_id: r.id,
      ingredient_id: r.ingredient_id,
      unit_id: r.unit_id,
      unit_cost: Number(r.unit_price),
      quantity: r.remaining_qty,
      batch_no: '',
      expiry_date: '',
    };
    r.__ctx = lineCtx;

    const row = el('div', { class: 'p-3 grid grid-cols-12 gap-2 items-end' });

    row.appendChild(el('div', { class: 'col-span-4' }, [
      el('div', { class: 'text-sm font-medium text-slate-800' }, ing?.name || '—'),
      el('div', { class: 'text-[11px] text-slate-500' }, `Remaining: ${r.remaining_qty} ${unit} @ ${fmtMoney(r.unit_price)}`),
    ]));

    row.appendChild(el('div', { class: 'col-span-3' }, [
      el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Received ${unit}`),
      el('input', {
        type: 'number', step: '0.001', min: 0, max: r.remaining_qty, value: r.remaining_qty,
        class: inputCls + ' text-sm py-1.5',
        oninput: e => { lineCtx.quantity = Number(e.target.value || 0); },
      }),
    ]));

    row.appendChild(el('div', { class: 'col-span-2' }, [
      el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Batch #'),
      el('input', {
        type: 'text', value: '', class: inputCls + ' text-xs py-1.5',
        oninput: e => { lineCtx.batch_no = e.target.value; },
      }),
    ]));

    row.appendChild(el('div', { class: 'col-span-3' }, [
      el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Expiry'),
      el('input', {
        type: 'date', value: '', class: inputCls + ' text-xs py-1.5',
        oninput: e => { lineCtx.expiry_date = e.target.value; },
      }),
    ]));

    linesBody.appendChild(row);
  });

  receiveCard.appendChild(linesBody);
  body.appendChild(receiveCard);

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl shrink-0' }, [
    el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      id: 'btn-save-grn',
      class: 'px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow',
    }, 'Record Receipt'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  footer.querySelector('#btn-save-grn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const validLines = remaining.filter(r => r.__ctx.quantity > 0);
    if (!validLines.length) { toast('Enter at least one received quantity', 'warn'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await recordGRN({ draft, po, lines: validLines });
      toast('Goods received — stock updated', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Record Receipt';
    }
  });
}

async function recordGRN({ draft, po, lines }) {
  const subtotal = lines.reduce((s, l) => s + (l.__ctx.quantity * l.__ctx.unit_cost), 0);
  const taxTotal = lines.reduce((s, l) => s + (l.__ctx.quantity * l.__ctx.unit_cost * (Number(l.tax_rate) || 0.05)), 0);
  const grandTotal = subtotal + taxTotal;

  const { data: grnNo } = await supabase.rpc('next_doc_number', {
    p_outlet: draft.outlet_id,
    p_doc_type: 'grn',
  });

  // 1. Create GRN
  const { data: grn, error: gErr } = await supabase.from('goods_receipts').insert({
    tenant_id: draft.tenant_id,
    outlet_id: draft.outlet_id,
    purchase_order_id: po.id,
    supplier_id: draft.supplier_id,
    grn_number: grnNo || 'GRN-' + Date.now(),
    supplier_invoice_no: draft.supplier_invoice_no || null,
    supplier_invoice_date: draft.supplier_invoice_date || null,
    received_at: draft.received_at,
    subtotal, tax_total: taxTotal, grand_total: grandTotal,
    status: 'received',
    notes: draft.notes || null,
    received_by: store.state.member?.id || null,
  }).select().single();
  if (gErr) throw gErr;

  // 2. Create GRN items
  const grnItems = lines.map(l => ({
    tenant_id: draft.tenant_id,
    goods_receipt_id: grn.id,
    ingredient_id: l.__ctx.ingredient_id,
    quantity: l.__ctx.quantity,
    unit_id: l.__ctx.unit_id,
    unit_cost: l.__ctx.unit_cost,
    tax_rate: Number(l.tax_rate) || 0.05,
    line_total: l.__ctx.quantity * l.__ctx.unit_cost,
    batch_no: l.__ctx.batch_no || null,
    expiry_date: l.__ctx.expiry_date || null,
  }));
  const { error: giErr } = await supabase.from('goods_receipt_items').insert(grnItems);
  if (giErr) throw giErr;

  // 3. Stock movements (this triggers avg_cost + stock_levels updates in the DB)
  const movements = lines.map(l => ({
    tenant_id: draft.tenant_id,
    outlet_id: draft.outlet_id,
    ingredient_id: l.__ctx.ingredient_id,
    movement_type: 'purchase',
    quantity: l.__ctx.quantity,
    unit_cost: l.__ctx.unit_cost,
    total_cost: l.__ctx.quantity * l.__ctx.unit_cost,
    reference_type: 'grn',
    reference_id: grn.id,
    notes: `Received from ${po.po_number}${l.__ctx.batch_no ? ' · Batch ' + l.__ctx.batch_no : ''}`,
    created_by: store.state.session?.user?.id || null,
  }));
  const { error: mErr } = await supabase.from('stock_movements').insert(movements);
  if (mErr) throw mErr;

  // 4. Update PO received_qty
  for (const l of lines) {
    const item = state.poItems[po.id].find(it => it.id === l.__ctx.order_item_id);
    if (item) {
      const newReceived = Number(item.received_qty || 0) + l.__ctx.quantity;
      await supabase.from('purchase_order_items')
        .update({ received_qty: newReceived })
        .eq('id', item.id);
    }
  }

  // 5. Determine new PO status
  const { data: freshItems } = await supabase.from('purchase_order_items')
    .select('quantity, received_qty').eq('purchase_order_id', po.id);

  const allReceived = (freshItems || []).every(i => Number(i.received_qty) >= Number(i.quantity));
  const anyReceived = (freshItems || []).some(i => Number(i.received_qty) > 0);
  const newStatus = allReceived ? 'received' : (anyReceived ? 'partially_received' : 'sent');

  await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', po.id);

  // 6. Batch tracking for expiry (optional)
  for (const l of lines) {
    if (l.__ctx.batch_no || l.__ctx.expiry_date) {
      await supabase.from('stock_batches').insert({
        tenant_id: draft.tenant_id,
        outlet_id: draft.outlet_id,
        ingredient_id: l.__ctx.ingredient_id,
        batch_no: l.__ctx.batch_no || null,
        expiry_date: l.__ctx.expiry_date || null,
        quantity_received: l.__ctx.quantity,
        quantity_remaining: l.__ctx.quantity,
        unit_cost: l.__ctx.unit_cost,
      });
    }
  }
}

// ============================================================
// GRN LIST
// ============================================================
function renderGRNList(root) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Goods Receipts (${state.grns.length})`),
  ]));

  if (!state.grns.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No goods receipts yet'));
    return card;
  }

  const tbody = el('tbody');
  state.grns.forEach(g => {
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-2.5' }, [
        el('div', { class: 'font-mono text-sm text-slate-800' }, g.grn_number),
        el('div', { class: 'text-[11px] text-slate-500' }, new Date(g.received_at).toLocaleDateString('en-IN')),
      ]),
      el('td', { class: 'px-4 py-2.5 text-sm text-slate-700' }, g.suppliers?.name || '—'),
      el('td', { class: 'px-4 py-2.5 text-sm text-slate-500' }, g.supplier_invoice_no || '—'),
      el('td', { class: 'px-4 py-2.5 text-right text-sm font-semibold text-slate-800' }, fmtMoney(g.grand_total)),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700' }, 'RECEIVED'),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'GRN #'),
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Supplier'),
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Invoice #'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Total'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Status'),
      ]),
    ]),
    tbody,
  ]));
  return card;
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
