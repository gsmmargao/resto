import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  pos: [],
  suppliers: [],
  ingredients: [],
  poItems: {}, 
  dateFrom: '',
  dateTo: '',
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

  const [poRes, quickRes, supRes, ingRes, unitRes] = await Promise.all([
    supabase.from('purchase_orders').select('*, suppliers(name)').eq('outlet_id', outletId).order('created_at', { ascending: false }),
    supabase.from('purchases').select('*, suppliers(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabase.from('suppliers').select('id, name, is_active').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('ingredients').select('id, name, unit_id, avg_cost').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    supabase.from('units').select('id, name, abbreviation').eq('tenant_id', tenantId)
  ]);

  const fullPos = (poRes.data || []).map(po => ({ ...po, _isQuickPurchase: false }));
  const quickPurchases = (quickRes.data || []).map(p => ({
      id: p.id,
      po_number: nextPoNumber,
      grand_total: p.total,
      status: p.status,
      created_at: p.created_at,
      supplier_id: p.supplier_id,
      suppliers: p.suppliers,
      _isQuickPurchase: true
  }));

  state.pos = [...fullPos, ...quickPurchases].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  state.suppliers = supRes.data || [];
  
  const unitsMap = new Map((unitRes.data || []).map(u => [u.id, u]));
  state.ingredients = (ingRes.data || []).map(i => ({
    ...i,
    units: unitsMap.get(i.unit_id) || null
  }));

  // Preload PO line items
  state.poItems = {};
  if (state.pos.length) {
    const poIds = state.pos.map(p => p.id);
    const { data: items } = await supabase.from('purchase_order_items').select('*').in('purchase_order_id', poIds);
    (items || []).forEach(it => {
      if (!state.poItems[it.purchase_order_id]) state.poItems[it.purchase_order_id] = [];
      state.poItems[it.purchase_order_id].push(it);
    });
  }

  state.loaded = true;
}

async function refresh() { state.loaded = false; await loadAll(); }

// ============================================================
// UI LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Purchases'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.pos.length} POs recorded`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async (e) => { const b = e.currentTarget; b.disabled = true; await refresh(); paint(root); toast('Refreshed', 'success', 1000); b.disabled = false; },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm',
        onclick: () => openPOEditor(root),
      }, '+ New Purchase'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);

  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  inner.appendChild(renderPOList(root));
}

// ============================================================
// PURCHASE LIST
// ============================================================
function renderPOList(root) {
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  
  const filterBar = el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Purchase History'),
    el('div', { class: 'flex items-center gap-2 text-xs' }, [
      el('label', { class: 'text-slate-500 font-medium' }, 'From:'),
      el('input', { 
        type: 'date', value: state.dateFrom, 
        class: 'px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500',
        onchange: (e) => { state.dateFrom = e.target.value; paint(root); }
      }),
      el('label', { class: 'text-slate-500 font-medium ml-1' }, 'To:'),
      el('input', { 
        type: 'date', value: state.dateTo, 
        class: 'px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500',
        onchange: (e) => { state.dateTo = e.target.value; paint(root); }
      }),
      el('button', {
        class: 'text-indigo-600 hover:text-indigo-800 ml-1 font-medium underline',
        onclick: () => { state.dateFrom = ''; state.dateTo = ''; paint(root); }
      }, 'Clear')
    ])
  ]);
  card.appendChild(filterBar);

  // Apply Date Filter
  let filteredPos = state.pos;
  if (state.dateFrom) {
    filteredPos = filteredPos.filter(po => new Date(po.created_at) >= new Date(state.dateFrom));
  }
  if (state.dateTo) {
    const toDate = new Date(state.dateTo);
    toDate.setDate(toDate.getDate() + 1); // Include the whole end day
    filteredPos = filteredPos.filter(po => new Date(po.created_at) < toDate);
  }

  if (!filteredPos.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No purchases recorded yet. Click "+ New Purchase" to add stock.'));
    return card;
  }

  const tbody = el('tbody');
  filteredPos.forEach(po => {
    const itemCount = (state.poItems[po.id] || []).length;
    
    // Payment badge (Bulletproof logic)
    let status = po.payment_status;
    let mode = po.payment_mode;
    
    // Auto-detect status for old/legacy records
    if (!status || status === 'unknown') {
        status = (mode && mode !== 'unknown') ? 'paid' : 'credit';
    }
    
    let payBadge;
    if (status === 'paid') {
      payBadge = el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold uppercase' }, `PAID (${mode || 'CASH'})`);
    } else {
      payBadge = el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold uppercase' }, 'CREDIT');
    }

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'font-mono text-sm text-slate-800 font-semibold' }, po.po_number),
        el('div', { class: 'text-[11px] text-slate-500' }, new Date(po.created_at).toLocaleDateString('en-IN')),
      ]),
      el('td', { class: 'px-4 py-3 text-sm text-slate-700' }, po.suppliers?.name || '—'),
      el('td', { class: 'px-4 py-3 text-sm text-slate-600 text-center' }, `${itemCount} item${itemCount !== 1 ? 's' : ''}`),
      el('td', { class: 'px-4 py-3 text-right text-sm font-bold text-slate-900' }, fmtMoney(po.grand_total)),
      el('td', { class: 'px-4 py-3 text-right' }, [payBadge]),
      el('td', { class: 'px-4 py-3 text-right' }, [
        el('div', { class: 'flex justify-end gap-2' }, [
          el('button', {
            class: 'text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition',
            onclick: () => openPODetail(root, po),
          }, 'View'),
          ['admin', 'owner', 'super-admin'].includes(store.state.member?.role) ? el('button', {
            class: 'text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-bold transition',
            onclick: async (e) => {
              if (!confirm('Are you sure you want to delete this Purchase Order? This cannot be undone.')) return;
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = '...';
              try {
                // 1. Delete associated Cash Movements (Expenses)
                if (po.po_number) {
                    await supabase.from('cash_movements').delete().ilike('reason', `%Purchase PO ${po.po_number}%`);
                    await supabase.from('cash_movements').delete().ilike('reason', `%PO ${po.po_number}%`);
                }

                // 2. Delete associated Supplier Payments
                if (po.po_number) {
                    await supabase.from('supplier_payments').delete().ilike('notes', `%PO ${po.po_number}%`);
                }

                // 3. Delete associated PO Items (if table exists)
                await supabase.from('purchase_order_items').delete().eq('purchase_order_id', po.id);

                // 4. Delete the PO itself
                const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id);
                if (error) throw error;
                
                if (window.toast) window.toast('Purchase Order and related payments deleted', 'success');
                
                // Reload the data and refresh the UI
                await loadAll();
                paint(root);
              } catch (err) {
                if (window.toast) window.toast('Failed to delete: ' + err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Delete';
              }
            }
          }, 'Delete') : null
        ].filter(Boolean))
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'PO #'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Supplier'),
        el('th', { class: 'text-center px-4 py-2.5 font-semibold' }, 'Items'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Total'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Payment'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

// ============================================================
// CREATE PURCHASE (Direct to Stock)
// ============================================================
function openPOEditor(root) {
  const draft = {
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    supplier_id: null,
    order_date: new Date().toISOString().slice(0, 10),
    payment_status: 'credit',
    payment_mode: null,
    notes: '',
  };
  
  let lines = [{ ingredient_id: null, quantity: 0, unit_id: null, unit_price: 0 }];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col max-h-[92vh]' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Record New Purchase'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4 overflow-y-auto' });

  // Header fields
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', {}, [
      field('Supplier *', el('input', {
        type: 'text',
        list: 'supplier-list',
        class: inputCls,
        placeholder: 'Search or select supplier...',
        oninput: (e) => {
            const val = e.target.value.trim().toLowerCase();
            const match = state.suppliers.find(s => s.name.toLowerCase() === val);
            draft.supplier_id = match ? match.id : null;
        }
      })),
      el('datalist', { id: 'supplier-list' }, state.suppliers.map(s => el('option', { value: s.name })))
    ]),
    field('Purchase Date', el('input', {
      type: 'date', 
      value: draft.order_date, 
      class: inputCls, 
      onchange: e => { draft.order_date = e.target.value; }
    })),
  ]));

  // Payment UI Block
  const paymentModeBox = el('div', { class: 'hidden' });
  
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Payment Status', el('select', {
      class: inputCls,
      onchange: e => {
        draft.payment_status = e.target.value;
        if (draft.payment_status === 'paid') {
          paymentModeBox.classList.remove('hidden');
          if (!draft.payment_mode) draft.payment_mode = 'cash'; // Auto-fill default
        } else {
          paymentModeBox.classList.add('hidden');
          draft.payment_mode = null;
        }
      }
    }, [
      el('option', { value: 'credit' }, 'Credit (Pay Later)'),
      el('option', { value: 'paid' }, 'Paid (Immediate)')
    ])),
    field('Notes', el('input', {
      type: 'text', value: draft.notes, placeholder: 'Optional', class: inputCls,
      oninput: e => { draft.notes = e.target.value; },
    })),
  ]));

  paymentModeBox.appendChild(field('Payment Mode', el('select', {
    class: inputCls,
    onchange: e => { draft.payment_mode = e.target.value; }
  }, [
    el('option', { value: 'cash' }, 'Cash'),
    el('option', { value: 'upi' }, 'UPI'),
    el('option', { value: 'card' }, 'Card'),
    el('option', { value: 'bank' }, 'Bank Transfer')
  ])));
  body.appendChild(paymentModeBox);

  // Line items
  const linesCard = el('div', { class: 'border border-slate-200 rounded-xl overflow-hidden' });
  linesCard.appendChild(el('div', { class: 'px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between' }, [
    el('h4', { class: 'font-semibold text-slate-700 text-sm' }, 'Items Purchased'),
    el('button', {
      class: 'text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold',
      onclick: () => {
        lines.push({ ingredient_id: null, quantity: '', unit_id: null, unit_price: '', total_temp: null });
        renderLines();
      },
    }, '+ Add Item'),
  ]));

  const linesBody = el('div', { class: 'divide-y divide-slate-100' });
  linesCard.appendChild(linesBody);
  body.appendChild(linesCard);

  const totalsBox = el('div', { class: 'bg-slate-50 rounded-lg p-4 space-y-1 text-sm' });
  body.appendChild(totalsBox);

  function renderLines() {
    linesBody.innerHTML = '';
    lines.forEach((l, i) => {
      const ing = state.ingredients.find(x => x.id === l.ingredient_id);
      const unit = ing?.units?.abbreviation || '';

      const row = el('div', { class: 'p-3 grid grid-cols-12 gap-2 items-end' });

      // INGREDIENT
      row.appendChild(el('div', { class: 'col-span-5' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Ingredient'),
        el('input', {
          type: 'text',
          list: `ing-list-${i}`,
          class: inputCls + ' text-xs py-1.5',
          value: l.ingredient_name || (state.ingredients.find(x => x.id === l.ingredient_id)?.name || ''),
          placeholder: 'Search or type new...',
          oninput: (e) => {
            const val = e.target.value.trim();
            l.ingredient_name = val;
            const freshIng = state.ingredients.find(x => x.name.toLowerCase() === val.toLowerCase());
            if (freshIng) {
                l.ingredient_id = freshIng.id;
                l.unit_id = freshIng.unit_id;
                l.total_temp = null;
                if (!l.unit_price) {
                    l.unit_price = Number(freshIng.avg_cost) || 0;
                    const priceIn = document.getElementById(`price-input-${i}`);
                    if (priceIn) priceIn.value = l.unit_price;
                    const totalIn = document.getElementById(`total-input-${i}`);
                    if (totalIn) totalIn.value = (l.quantity * l.unit_price).toFixed(2);
                    updateTotals();
                }
            } else {
                l.ingredient_id = null;
            }
          },
          onchange: () => renderLines() // Only re-render when done typing
        }),
        el('datalist', { id: `ing-list-${i}` }, state.ingredients.map(x => el('option', { value: x.name })))
      ]));

      // QTY
      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Qty ${unit}`),
        el('input', {
          type: 'number', step: '0.001', min: 0, value: l.quantity || '', id: `qty-input-${i}`,
          class: inputCls + ' text-xs py-1.5',
          oninput: (e) => { 
              l.quantity = Number(e.target.value || 0); 
              const totalIn = document.getElementById(`total-input-${i}`);
              const priceIn = document.getElementById(`price-input-${i}`);
              
              if (l.quantity > 0) {
                  if (l.total_temp !== null) {
                      // User entered Total first
                      l.unit_price = l.total_temp / l.quantity;
                      if (priceIn) priceIn.value = l.unit_price.toFixed(2);
                  } else if (l.unit_price > 0) {
                      // User entered Price first
                      if (totalIn) totalIn.value = (l.quantity * l.unit_price).toFixed(2);
                  }
              }
              updateTotals(); 
          },
        }),
      ]));

      // PRICE
      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, `Price/${unit}`),
        el('input', {
          type: 'number', step: '0.01', min: 0, value: l.unit_price || '', id: `price-input-${i}`,
          class: inputCls + ' text-xs py-1.5',
          oninput: (e) => { 
              l.unit_price = Number(e.target.value || 0); 
              l.total_temp = null; // Clear temp total if price is manually changed
              const totalIn = document.getElementById(`total-input-${i}`);
              if (totalIn) totalIn.value = (l.quantity * l.unit_price).toFixed(2);
              updateTotals(); 
          },
        }),
      ]));

      // EDITABLE TOTAL
      row.appendChild(el('div', { class: 'col-span-2' }, [
        el('label', { class: 'block text-[10px] uppercase text-slate-500 mb-0.5' }, 'Total'),
        el('input', {
          type: 'number', step: '0.01', min: 0, value: (l.quantity * l.unit_price) > 0 ? (l.quantity * l.unit_price).toFixed(2) : '', id: `total-input-${i}`,
          class: inputCls + ' text-xs py-1.5 font-bold text-right text-indigo-700',
          oninput: (e) => {
             const newTotal = Number(e.target.value || 0);
             l.total_temp = newTotal; // Remember what was typed here
             
             if (l.quantity > 0) {
                 l.unit_price = newTotal / l.quantity;
                 const priceIn = document.getElementById(`price-input-${i}`);
                 if (priceIn) priceIn.value = l.unit_price.toFixed(2);
                 updateTotals();
             }
          }
        }),
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
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
    totalsBox.innerHTML = '';
    totalsBox.appendChild(el('div', { class: 'flex justify-between pt-2 mt-1 border-t border-slate-200 font-bold text-slate-900 text-base' }, [
      el('span', {}, 'Total Bill'),
      el('span', {}, fmtMoney(subtotal)),
    ]));
  }

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl shrink-0' }, [
    el('p', { class: 'text-xs text-slate-500 max-w-xs' }, 'Saving this will automatically add the items to your stock levels.'),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', {
        id: 'btn-save-po',
        class: 'px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow',
      }, 'Save & Add to Stock'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  renderLines();

  footer.querySelector('#btn-save-po').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!draft.supplier_id) { toast('Select a supplier', 'warn'); return; }
    let validLines = lines.filter(l => (l.ingredient_id || (l.ingredient_name && l.ingredient_name.trim() !== '')) && l.quantity > 0);
    if (!validLines.length) { toast('Add at least one item', 'warn'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // --- AUTO-CREATE NEW INGREDIENTS ---
      for (let i = 0; i < validLines.length; i++) {
          let l = validLines[i];
          if (!l.ingredient_id && l.ingredient_name) {
              // Check if it already exists in state (case-insensitive)
              let existing = state.ingredients.find(x => x.name.toLowerCase() === l.ingredient_name.trim().toLowerCase());
              
              if (!existing) {
                  // Create new ingredient in DB
                  const { data: newIng, error: ingErr } = await supabase.from('ingredients').insert({
                      tenant_id: draft.tenant_id,
                      name: l.ingredient_name.trim(),
                      unit_id: l.unit_id || null, // Use selected unit or null
                      avg_cost: Number(l.unit_price) || 0,
                      is_active: true
                  }).select().single();
                  
                  if (ingErr) throw new Error('Failed to create ingredient: ' + ingErr.message);
                  existing = newIng;
                  
                  // Add to local state so it appears next time without refresh
                  state.ingredients.push(existing);
              }
              
              // Update the line with the new ID
              l.ingredient_id = existing.id;
              if (!l.unit_id) l.unit_id = existing.unit_id;
          }
      }
      // -----------------------------------

      const subtotal = validLines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
      
      const { data: poNo } = await supabase.rpc('next_doc_number', { p_outlet: draft.outlet_id, p_doc_type: 'po' });

      // 1. Create PO
      
      // Generate sequential PO Number
      const { data: existingPOs } = await supabase.from('purchase_orders').select('po_number').eq('tenant_id', draft.tenant_id);
      let maxPO = 0;
      if (existingPOs) {
          existingPOs.forEach(po => {
              const num = parseInt((po.po_number || '').replace(/\D/g, ''), 10);
              if (!isNaN(num) && num > maxPO) maxPO = num;
          });
      }
      const nextPoNumber = 'PO-' + (maxPO + 1);

      const payload = {
        tenant_id: draft.tenant_id,
        outlet_id: draft.outlet_id,
        supplier_id: draft.supplier_id,
        po_number: nextPoNumber,
        status: 'received', // Instantly mark as received since we are stocking it
        order_date: draft.order_date,
        subtotal: subtotal,
        tax_total: 0,
        grand_total: subtotal,
        payment_status: draft.payment_status,
        payment_mode: draft.payment_mode || 'cash',
        notes: draft.notes || null,
        created_by: store.state.session?.user?.id || null,
      };
      let { data: po, error: poErr } = await supabase.from('purchase_orders').insert(payload).select().single();
      
      
      
      if (poErr) throw poErr;

      // 1. Auto-record the supplier payment if marked as paid
      if (payload.payment_status === 'paid') {
        const { error: payErr } = await supabase.from('supplier_payments').insert({
          tenant_id: draft.tenant_id,
          supplier_id: draft.supplier_id,
          amount: payload.grand_total,
          payment_mode: (draft.payment_mode || 'cash').toLowerCase(),
          notes: `Auto-payment for PO ${po.po_number}`,
          created_by: store.state.session?.user?.id || null
        });
        if (payErr) console.error("Failed to record auto-payment:", payErr);

        // Record in cash_movements if cash
        if (payload.payment_mode === 'cash') {
            try {
                const { addCashMovement } = await import('../cash.js');
                await addCashMovement({ 
                    type: 'cash_out', 
                    amount: payload.grand_total, 
                    reason: `Purchase PO ${po.po_number}`, 
                    person_name: null 
                });
            } catch (err) {
                console.error('Failed to record cash movement:', err);
                toast('Warning: Could not deduct from counter. Ensure shift is open.', 'warn');
            }
        }
      }

      // 2. Create PO Items
      const rows = validLines.map(l => ({
        tenant_id: draft.tenant_id,
        purchase_order_id: po.id,
        ingredient_id: l.ingredient_id,
        quantity: Number(l.quantity),
        unit_id: l.unit_id,
        unit_price: Number(l.unit_price),
        tax_rate: 0,
        discount_amount: 0,
        line_total: l.quantity * l.unit_price,
        received_qty: Number(l.quantity), // Mark as fully received
      }));
      const { error: itemsErr } = await supabase.from('purchase_order_items').insert(rows);
      if (itemsErr) throw itemsErr;

      // 3. Insert Stock Movements (Triggers DB to update stock levels & avg_cost)
      const movements = validLines.map(l => ({
        tenant_id: draft.tenant_id,
        outlet_id: draft.outlet_id,
        ingredient_id: l.ingredient_id,
        movement_type: 'purchase',
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_price),
        total_cost: l.quantity * l.unit_price,
        reference_type: 'po',
        reference_id: po.id,
        notes: `Direct purchase from ${poNo}`,
        created_by: store.state.session?.user?.id || null,
      }));
      const { error: moveErr } = await supabase.from('stock_movements').insert(movements);
      if (moveErr) throw moveErr;

      toast('Purchase saved and stock updated!', 'success');
      overlay.remove();
      await refresh();
      paint(root);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save & Add to Stock';
    }
  });
}

// ============================================================
// VIEW DETAILS
// ============================================================
function openPODetail(root, po) {
  const items = state.poItems[po.id] || [];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('div', { class: 'font-mono text-sm text-slate-500' }, po.po_number),
      el('h3', { class: 'font-bold text-lg text-slate-800' }, po.suppliers?.name || '—'),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3 text-sm' }, [
    kv('Date', new Date(po.order_date).toLocaleDateString('en-IN')),
    kv('Payment Status', po.payment_status === 'paid' ? `PAID (${po.payment_mode})` : 'CREDIT'),
  ]));

  const tbody = el('tbody');
  items.forEach(it => {
    const ing = state.ingredients.find(x => x.id === it.ingredient_id);
    const unit = ing?.units?.abbreviation || '';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100' }, [
      el('td', { class: 'px-4 py-2 text-sm text-slate-800' }, ing?.name || '—'),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, `${Number(it.quantity)} ${unit}`),
      el('td', { class: 'px-4 py-2 text-right text-sm text-slate-700' }, fmtMoney(it.unit_price)),
      el('td', { class: 'px-4 py-2 text-right text-sm font-semibold text-slate-800' }, fmtMoney(it.line_total)),
    ]));
  });

  body.appendChild(el('table', { class: 'w-full border border-slate-200 rounded-lg overflow-hidden' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2 font-semibold' }, 'Ingredient'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Qty'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Unit Price'),
        el('th', { class: 'text-right px-4 py-2 font-semibold' }, 'Total'),
      ]),
    ]),
    tbody,
  ]));

  body.appendChild(el('div', { class: 'bg-slate-50 rounded-lg p-4 space-y-1 text-sm' }, [
    el('div', { class: 'flex justify-between pt-2 mt-1 font-bold text-slate-900 text-base' }, [
      el('span', {}, 'Total Bill'), el('span', {}, fmtMoney(po.grand_total)),
    ]),
  ]));

  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function kv(label, value) {
  return el('div', {}, [
    el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, label),
    el('div', { class: 'text-sm font-medium text-slate-800 mt-0.5' }, value),
  ]);
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
