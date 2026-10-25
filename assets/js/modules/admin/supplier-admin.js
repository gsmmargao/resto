import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  suppliers: [],
  purchases: [],
  payments: [],
  search: '',
  activeFilter: 'active',
  selectedId: null,
  loaded: false,
};

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
  const [supRes, poRes, payRes] = await Promise.all([
    supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('purchases').select('id, notes, total, created_at, supplier_id').eq('tenant_id', tenantId),
    supabase.from('supplier_payments').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  ]);

  state.suppliers = supRes.data || [];
  state.purchases = poRes.data || [];
  state.payments = payRes.data || [];
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Suppliers'),
      el('p', { class: 'text-xs text-slate-500' }, `${state.suppliers.length} suppliers`),
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
    inner.appendChild(renderLedgerFor(state.selectedId, root));
  }
}

function renderFilterBar(root) {
  const bar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });
  bar.appendChild(el('input', {
    type: 'search', placeholder: 'Search name / phone…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));
  bar.appendChild(el('select', {
    class: 'px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { state.activeFilter = e.target.value; paint(root); },
  }, [
    el('option', { value: 'active',   selected: state.activeFilter === 'active'   ? true : null }, 'Active only'),
    el('option', { value: 'inactive', selected: state.activeFilter === 'inactive' ? true : null }, 'Inactive only'),
    el('option', { value: 'all',      selected: state.activeFilter === 'all'      ? true : null }, 'All'),
  ]));
  return bar;
}

function renderSupplierGrid(root) {
  const filtered = state.suppliers.filter(s => {
    if (state.activeFilter === 'active' && !s.is_active) return false;
    if (state.activeFilter === 'inactive' && s.is_active) return false;
    if (state.search) {
      const hay = `${s.name || ''} ${s.contact_person || ''} ${s.phone || ''}`.toLowerCase();
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
  const isSelected = state.selectedId === s.id;
  
  // Calculate Balance
  const totalPurchases = state.purchases.filter(p => p.supplier_id === s.id).reduce((sum, p) => sum + Number(p.grand_total), 0);
  const totalPayments = state.payments.filter(p => p.supplier_id === s.id).reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = totalPurchases - totalPayments;

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
      el('div', { class: 'text-right shrink-0' }, [
        el('div', { class: 'text-[10px] uppercase text-slate-500 font-semibold' }, 'Balance'),
        el('div', { class: `text-sm font-bold ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}` }, fmtMoney(balance))
      ])
    ]),
    el('div', { class: 'mt-3 space-y-1 text-xs text-slate-600' }, [
      s.phone ? el('div', { class: 'truncate' }, '📞 ' + s.phone) : null,
      el('div', { class: 'text-slate-400' }, `Purchases: ${fmtMoney(totalPurchases)}`)
    ].filter(Boolean)),
  ]));

  card.appendChild(el('div', { class: 'px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between' }, [
    s.is_active
      ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold' }, 'ACTIVE')
      : el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold' }, 'INACTIVE'),
    el('button', {
      class: 'text-[10px] px-2 py-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium',
      onclick: (e) => { e.stopPropagation(); openSupplierEditor(root, s); },
    }, 'Edit'),
  ]));

  return card;
}

function renderLedgerFor(supplierId, root) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  if (!supplier) return el('div', { class: 'hidden' });

  const purchases = state.purchases.filter(p => p.supplier_id === supplierId);
  const payments = state.payments.filter(p => p.supplier_id === supplierId);

  const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.grand_total), 0);
  const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = totalPurchases - totalPayments;

  // Combine into a single ledger
  const ledger = [];
  purchases.forEach(p => ledger.push({ date: p.created_at, type: 'purchase', desc: `Bill ${p.po_number}`, amount: p.grand_total }));
  payments.forEach(p => ledger.push({ date: p.created_at, type: 'payment', desc: `Payment (${p.payment_mode})`, amount: p.amount, mode: p.payment_mode, notes: p.notes }));
  
  ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  
  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3' }, [
    el('div', {}, [
      el('h3', { class: 'font-semibold text-slate-800 text-base' }, `Ledger — ${supplier.name}`),
      el('p', { class: 'text-xs text-slate-500' }, `Total Outstanding: `, el('span', { class: `font-bold ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}` }, fmtMoney(balance)))
    ]),
    el('div', { class: 'flex gap-2' }, [
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm',
        onclick: () => openPurchaseModal(root, supplier.id),
      }, '+ Record Purchase'),
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm',
        onclick: () => openPaymentModal(root, supplier.id, balance),
      }, '+ Record Payment')
    ]),
  ]));

  if (!ledger.length) {
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No transactions with this supplier yet'));
    return card;
  }

  const tbody = el('tbody');
  ledger.forEach(l => {
    const isPurchase = l.type === 'purchase';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-3 text-xs text-slate-500 whitespace-nowrap' }, new Date(l.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
      el('td', { class: 'px-5 py-3' }, [
        el('div', { class: 'text-sm font-medium text-slate-800' }, l.desc),
        l.notes ? el('div', { class: 'text-[10px] text-slate-400 italic' }, l.notes) : null
      ].filter(Boolean)),
      el('td', { class: 'px-5 py-3 text-center' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${isPurchase ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}` }, isPurchase ? 'BILL' : 'PAID')
      ]),
      el('td', { class: `px-5 py-3 text-sm text-right font-semibold ${isPurchase ? 'text-red-600' : 'text-emerald-600'}` }, 
        (isPurchase ? '+' : '-') + fmtMoney(l.amount)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Description'),
        el('th', { class: 'text-center px-5 py-2 font-semibold' }, 'Type'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Amount'),
      ]),
    ]),
    tbody,
  ]));

  return card;
}

function openSupplierEditor(root, supplier) {
  const isNew = !supplier;
  const draft = supplier ? { ...supplier } : {
    tenant_id: store.state.tenant.id,
    name: '', contact_person: '', phone: '', credit_days: 0, is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Supplier' : 'Edit Supplier'));
  
  const nameIn = el('input', { type: 'text', value: draft.name, placeholder: 'Supplier name', class: inputCls, oninput: e => draft.name = e.target.value });
  const contactIn = el('input', { type: 'text', value: draft.contact_person || '', placeholder: 'Contact person', class: inputCls, oninput: e => draft.contact_person = e.target.value });
  const phoneIn = el('input', { type: 'tel', value: draft.phone || '', placeholder: 'Phone number', class: inputCls, oninput: e => draft.phone = e.target.value });
  const creditIn = el('input', { type: 'number', value: draft.credit_days || 0, placeholder: 'Credit days', class: inputCls, oninput: e => draft.credit_days = Number(e.target.value) });

  card.appendChild(field('Supplier Name *', nameIn));
  card.appendChild(field('Contact Person', contactIn));
  card.appendChild(field('Contact Number', phoneIn));
  card.appendChild(field('Credit Terms (Days)', creditIn));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!draft.name) { toast('Name required', 'warn'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: draft.tenant_id, name: draft.name.trim(), contact_person: draft.contact_person?.trim() || null,
            phone: draft.phone?.trim() || null, credit_days: Number(draft.credit_days) || 0, is_active: true
          };
          if (isNew) {
            const { error } = await supabase.from('suppliers').insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('suppliers').update(payload).eq('id', supplier.id);
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
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => nameIn.focus(), 50);
}

function openPaymentModal(root, supplierId, maxBalance) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Record Payment'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, `Outstanding balance: ${fmtMoney(maxBalance)}`));
  
  const amtIn = el('input', { type: 'number', step: '0.01', placeholder: 'Amount to pay', class: inputCls });
  const modeIn = el('select', { class: inputCls }, [
    el('option', { value: 'cash' }, 'Cash'),
    el('option', { value: 'upi' }, 'UPI'),
    el('option', { value: 'bank' }, 'Bank Transfer'),
    el('option', { value: 'card' }, 'Card'),
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes (optional)', class: inputCls });

  const amtContainer = el('div', { class: 'flex gap-2 items-end' });
  amtContainer.appendChild(field('Amount *', amtIn));
  amtContainer.appendChild(el('button', {
    type: 'button',
    class: 'px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 mb-1 transition whitespace-nowrap',
    onclick: () => { 
      amtIn.value = maxBalance; 
      if (amtIn.dispatchEvent) amtIn.dispatchEvent(new Event('input'));
    }
  }, 'Pay Full'));
  card.appendChild(amtContainer);
  card.appendChild(field('Payment Mode *', modeIn));
  card.appendChild(field('Notes', notesIn));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amtIn.value);
        if (!amount || amount <= 0) { toast('Enter valid amount', 'warn'); return; }

        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const { error } = await supabase.from('supplier_payments').insert({
            tenant_id: store.state.tenant.id,
            supplier_id: supplierId,
            amount: amount,
            payment_mode: modeIn.value,
            notes: notesIn.value.trim() || null,
            created_by: store.state.session?.user?.id || null
          });
          if (error) throw error;
          toast('Payment recorded!', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save Payment';
        }
      },
    }, 'Save Payment'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => amtIn.focus(), 50);
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}


function openPurchaseModal(root, supplierId) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Record Purchase'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, 'Select Credit to add this amount to the outstanding balance.'));
  
  const amtIn = el('input', { type: 'number', step: '0.01', placeholder: 'Amount', class: inputCls });
  const modeIn = el('select', { class: inputCls }, [
    el('option', { value: 'credit' }, 'Credit (Add to Outstanding)'),
    el('option', { value: 'cash' }, 'Cash (Paid immediately)'),
    el('option', { value: 'upi' }, 'UPI (Paid immediately)'),
    el('option', { value: 'bank' }, 'Bank Transfer (Paid immediately)'),
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes / Invoice Number (optional)', class: inputCls });

  card.appendChild(field('Amount *', amtIn));
  card.appendChild(field('Payment Mode *', modeIn));
  card.appendChild(field('Notes', notesIn));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' },[
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amtIn.value);
        if (!amount || amount <= 0) { toast('Enter valid amount', 'warn'); return; }

        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          // Insert into purchases table (assuming standard table name 'purchases')
          const payload = {
            tenant_id: store.state.tenant.id,
            supplier_id: supplierId,
            total: amount,
            payment_mode: modeIn.value,
            notes: notesIn.value.trim() || null,
            status: modeIn.value === 'credit' ? 'pending' : 'paid'
          };
          
          const { error } = await supabase.from('purchases').insert(payload);
          if (error) throw error;
          
          toast('Purchase recorded!', 'success');
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save Purchase';
        }
      },
    }, 'Save Purchase'),
  ]);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
