import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function field(label, input) {
  return el('div', { class: 'mb-3' }, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    input
  ]);
}

const state = {
  suppliers: [],
  purchases: [],
  payments: [],
  loaded: false,
  selectedId: null
};

async function loadAll() {
  const tenantId = store.state.tenant?.id;
  if (!tenantId) return;

  const [supRes, poRes, quickRes, payRes] = await Promise.all([
    supabase.from('suppliers').select('*').eq('tenant_id', tenantId).order('name'),
    supabase.from('purchase_orders').select('*').eq('tenant_id', tenantId),
    supabase.from('purchases').select('*').eq('tenant_id', tenantId),
    supabase.from('supplier_payments').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  ]);

  state.suppliers = supRes.data || [];
  
  const pos = (poRes.data || []).map(p => ({
      id: p.id, po_number: p.po_number, grand_total: Number(p.grand_total || 0),
      created_at: p.created_at, supplier_id: p.supplier_id,
      payment_status: p.payment_status || (p.payment_mode === 'credit' ? 'credit' : 'paid'),
      payment_mode: p.payment_mode || 'cash', notes: p.notes
  }));

  const quick = (quickRes.data || []).map(p => ({
      id: p.id, po_number: p.notes || 'Quick Purchase', grand_total: Number(p.total || 0),
      created_at: p.created_at, supplier_id: p.supplier_id,
      payment_status: p.status === 'pending' ? 'credit' : 'paid',
      payment_mode: p.payment_mode || 'cash', notes: p.notes
  }));

  state.purchases = [...pos, ...quick];
  state.payments = payRes.data || [];
  state.loaded = true;
}

export async function renderSuppliersView(root) {
  // ROOT CAUSE FIX: Unlock body scroll and force the main container to be scrollable
  document.body.style.overflow = 'auto';
  document.body.style.overflowY = 'auto';
  document.body.style.position = 'static';
  document.documentElement.style.overflow = 'auto';
  
  root.style.overflowY = 'auto';
  root.style.height = '100%';
  root.style.paddingBottom = '4rem'; // Add space at the bottom so the last item isn't cut off

  if (!state.loaded) {
    root.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Suppliers...</div>';
    await loadAll();
  }
  paint(root);
}

// Also export as renderSupplierAdmin just in case the router uses that name
export const renderSupplierAdmin = renderSuppliersView;

function paint(root) {
  // Preserve focus and cursor position
  const activeEl = document.activeElement;
  const isSearchFocused = activeEl && activeEl.id === 'supplier-search-input';
  const cursorPos = isSearchFocused ? activeEl.selectionStart : 0;
  const currentSearch = document.getElementById('supplier-search-input')?.value || '';

  root.innerHTML = '';

  // Calculate Total Outstanding across all suppliers
  let globalOutstanding = 0;
  state.suppliers.forEach(s => {
      const purchases = (state.purchases || []).filter(p => p.supplier_id === s.id);
      const payments = (state.payments || []).filter(p => p.supplier_id === s.id);
      const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.grand_total || p.total || 0), 0);
      const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const balance = totalPurchases - totalPayments;
      if (balance > 0) globalOutstanding += balance;
  });

    // 1. Colorful KPI Grid (Matches Overview)
  const kpi = (label, value, gradient, sub = '') => el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-5 shadow-sm` }, [
      el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
      el('div', { class: 'text-2xl font-bold mt-1' }, String(value)),
      sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ]);

  // Calculate total purchases for the KPI
  let globalPurchases = 0;
  state.suppliers.forEach(s => {
      const purchases = (state.purchases || []).filter(p => p.supplier_id === s.id);
      globalPurchases += purchases.reduce((sum, p) => sum + Number(p.grand_total || p.total || 0), 0);
  });

  const kpiGrid = el('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-4 mb-6' }, [
      kpi('Total Suppliers', state.suppliers.length, 'from-slate-700 to-slate-800', 'Active Vendors'),
      kpi('Total Purchases', fmtMoney(globalPurchases), 'from-indigo-500 to-indigo-600', 'All Time Value'),
      kpi('Outstanding Payables', fmtMoney(globalOutstanding), 'from-red-500 to-rose-600', 'Amount Owed')
  ]);
  root.appendChild(kpiGrid);

  // 2. Top Header
  const topHeader = el('div', { class: 'flex items-center justify-between mb-4' }, [
     el('div', {}, [
        el('h2', { class: 'text-xl font-bold text-slate-800' }, 'Suppliers'),
        el('p', { class: 'text-sm text-slate-500' }, `${state.suppliers.length} suppliers`)
     ]),
     el('div', { class: 'flex gap-2' }, [
        el('button', { class: 'px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200 transition', onclick: async () => { await loadAll(); paint(root); } }, 'Refresh'),
        el('button', { class: 'px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition', onclick: () => openSupplierEditor(root, null) }, '+ New Supplier')
     ])
  ]);
  root.appendChild(topHeader);

  // 3. Toolbar (Search only)
  const toolbar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap items-center justify-between gap-3 shadow-sm' }, [
    el('div', { class: 'flex-1 min-w-[200px]' }, [
      el('input', {
        type: 'text',
        id: 'supplier-search-input',
        placeholder: 'Search name / phone...',
        class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
        value: currentSearch,
        oninput: () => paint(root)
      })
    ])
  ]);
  root.appendChild(toolbar);

  // Filter (Search only)
  let filtered = state.suppliers || [];
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    filtered = filtered.filter(s => s.name.toLowerCase().includes(q) || (s.phone && s.phone.includes(q)));
  }

  // 4. List View Container
  const listContainer = el('div', { class: 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden' });
  
  // List Header (Visible on Desktop)
  const listHeader = el('div', { class: 'hidden md:flex bg-slate-50 text-slate-500 text-[10px] uppercase tracking-widest font-bold border-b border-slate-200 px-6 py-3' }, [
      el('div', { class: 'flex-1' }, 'Supplier Details'),
      el('div', { class: 'w-48 text-right' }, 'Total Purchases'),
      el('div', { class: 'w-48 text-right' }, 'Balance'),
      el('div', { class: 'w-32 text-right' }, 'Actions')
  ]);
  listContainer.appendChild(listHeader);

  if (!filtered.length) {
     listContainer.appendChild(el('div', { class: 'text-center py-10 text-slate-500' }, 'No suppliers found.'));
  }

  // 5. List Rows
  filtered.forEach(s => {
    const purchases = (state.purchases || []).filter(p => p.supplier_id === s.id);
    const payments = (state.payments || []).filter(p => p.supplier_id === s.id);
    const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.grand_total || p.total || 0), 0);
    const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const balance = totalPayments - totalPurchases; // Positive = Advance Paid

    const row = el('div', {
        class: 'flex flex-col md:flex-row md:items-center px-6 py-4 border-b border-slate-100 hover:bg-slate-50 transition cursor-pointer',
        onclick: () => openLedgerModal(root, s)
    }, [
        // Name & Contact
        el('div', { class: 'flex-1 mb-2 md:mb-0' }, [
            el('div', { class: 'font-bold text-slate-800 text-base flex items-center gap-2' }, [
                s.name,
                !s.is_active ? el('span', { class: 'px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-red-100 text-red-700' }, 'Inactive') : null
            ].filter(Boolean)),
            el('div', { class: 'text-xs text-slate-500 mt-1 flex items-center gap-3' }, [
                s.contact_person ? el('span', {}, s.contact_person) : null,
                s.phone ? el('span', { class: 'flex items-center gap-1' }, ['📞', s.phone]) : null
            ].filter(Boolean))
        ]),
        
        // Total Purchases
        el('div', { class: 'w-full md:w-48 text-left md:text-right mb-2 md:mb-0' }, [
            el('div', { class: 'text-[10px] md:hidden text-slate-400 uppercase font-bold' }, 'Total Purchases'),
            el('div', { class: 'text-sm text-slate-600 font-medium' }, `₹${totalPurchases.toLocaleString('en-IN', {minimumFractionDigits: 2})}`)
        ]),
        
        // Balance
        el('div', { class: 'w-full md:w-48 text-left md:text-right mb-2 md:mb-0' }, [
            el('div', { class: 'text-[10px] md:hidden text-slate-400 uppercase font-bold' }, 'Balance'),
            el('div', { class: `font-bold ${balance > 0 ? 'text-emerald-600' : (balance < 0 ? 'text-red-600' : 'text-slate-500')}` },
                balance > 0 ? `+₹${balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}` : `₹${Math.abs(balance).toLocaleString('en-IN', {minimumFractionDigits: 2})}`
            ),
            balance > 0 ? el('div', { class: 'text-[10px] text-emerald-600 font-semibold' }, 'Advance Paid') : null
        ].filter(Boolean)),
        
        // Actions
        el('div', { class: 'w-full md:w-32 flex justify-end gap-2' }, [
            el('button', {
                class: 'text-indigo-600 hover:text-indigo-800 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition border border-indigo-100',
                onclick: (e) => { e.stopPropagation(); openSupplierEditor(root, s); }
            }, 'Edit')
        ])
    ]);
    listContainer.appendChild(row);
  });

  root.appendChild(listContainer);

  // Restore focus
  if (isSearchFocused) {
      const newInput = document.getElementById('supplier-search-input');
      if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(cursorPos, cursorPos);
      }
  }
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

  const closeModal = () => {
      overlay.remove();
      document.body.style.overflow = 'auto'; // FORCE UNLOCK SCROLL
  };

  const isAdmin = ['admin', 'owner', 'super-admin'].includes(store.state.member?.role);
  const showDelete = !isNew && isAdmin;

  const footer = el('div', { class: `grid ${showDelete ? 'grid-cols-3' : 'grid-cols-2'} gap-2 pt-2` },[
    showDelete ? el('button', { 
      class: 'py-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-sm transition',
      onclick: async (e) => {
        if (!confirm('Are you sure you want to delete this supplier? This cannot be undone.')) return;
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Deleting…';
        try {
          const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
          if (error) throw error;
          toast('Supplier deleted', 'success');
          closeModal();
          await loadAll();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Delete';
        }
      }
    }, 'Delete') : null,
    
    el('button', { 
      class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', 
      onclick: closeModal 
    }, 'Cancel'),
    
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
          closeModal();
          await loadAll();
          paint(root);
        } catch (err) {
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      },
    }, isNew ? 'Create' : 'Save'),
  ].filter(Boolean));
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => nameIn.focus(), 50);
}

function openLedgerModal(root, supplier) {
  const closeLedgerModal = () => { overlay.remove(); document.body.style.overflow = 'auto'; };
  const isAdmin = ['admin', 'owner', 'super-admin'].includes(store.state.member?.role);
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden' });

  const purchases = (state.purchases || []).filter(p => p.supplier_id === supplier.id);
  const payments = (state.payments || []).filter(p => p.supplier_id === supplier.id);
  const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.grand_total || p.total || 0), 0);
  const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const balance = totalPayments - totalPurchases; // Positive = Advance Paid to Supplier

  const header = el('div', { class: 'px-6 py-5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white' });
  header.innerHTML = `
    <div>
      <h3 class="font-bold text-xl text-slate-800">${supplier.name}</h3>
      <div class="text-sm text-slate-500 mt-1">
        Total ${balance > 0 ? 'Advance' : 'Outstanding'}: <span class="font-bold ${balance > 0 ? 'text-emerald-600' : 'text-red-600'} text-lg ml-1">₹${Math.abs(balance).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
      </div>
    </div>
    <button class="text-slate-400 hover:text-slate-700 text-3xl leading-none focus:outline-none" id="close-ledger">&times;</button>
  `;
  const closeModal = () => {
      overlay.remove();
      document.body.style.overflow = 'auto'; // Force unlock scroll
  };
  header.querySelector('#close-ledger').onclick = closeModal;
  card.appendChild(header);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-6 bg-white' });
  const grid = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-0 border border-slate-200 rounded-lg overflow-hidden' });

  const leftCol = el('div', { class: 'border-b md:border-b-0 md:border-r border-slate-200' });
  leftCol.innerHTML = `
    <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm">Purchases (Bills)</div>
    <table class="w-full">
      <thead>
        <tr class="text-xs text-slate-400 uppercase border-b border-slate-100">
          <th class="text-left px-4 py-2 font-medium">Date</th>
          <th class="text-left px-4 py-2 font-medium">Description</th>
          <th class="text-right px-4 py-2 font-medium">Amount</th>
          ${isAdmin ? '<th class="text-center px-4 py-2 font-medium">Action</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${purchases.length ? purchases.sort((a,b)=> new Date(b.created_at) - new Date(a.created_at)).map(p => `
          <tr class="border-b border-slate-50 hover:bg-slate-50">
            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(p.created_at).toLocaleDateString('en-GB')}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${p.notes || 'Purchase Bill'}</td>
            <td class="px-4 py-3 text-sm text-right font-medium text-red-600">+₹${Number(p.grand_total || p.total || 0).toFixed(2)}</td>
            ${isAdmin ? `<td class="px-4 py-3 text-center">
                <button class="btn-del-purchase text-red-500 hover:text-red-700 transition" data-id="${p.id}" title="Delete Purchase">
                    <svg class="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>` : ''}
          </tr>
        `).join('') : '<tr><td colspan="${isAdmin ? 4 : 3}" class="text-center py-8 text-slate-400 text-sm">No credit purchases</td></tr>'}
      </tbody>
    </table>
  `;

  const rightCol = el('div', {});
  
  rightCol.innerHTML = `
    <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm">Payments Made (Cash/UPI)</div>
    <table class="w-full">
      <thead>
        <tr class="text-xs text-slate-400 uppercase border-b border-slate-100">
          <th class="text-left px-4 py-2 font-medium">Date</th>
          <th class="text-left px-4 py-2 font-medium">Mode</th>
          <th class="text-right px-4 py-2 font-medium">Amount</th>
          ${isAdmin ? '<th class="text-center px-4 py-2 font-medium">Action</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${payments.length ? payments.sort((a,b)=> new Date(b.created_at) - new Date(a.created_at)).map(p => `
          <tr class="border-b border-slate-50 hover:bg-slate-50">
            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(p.created_at).toLocaleDateString('en-GB')}</td>
            <td class="px-4 py-3 text-sm text-slate-700 uppercase">${p.payment_mode}</td>
            <td class="px-4 py-3 text-sm text-right font-medium text-emerald-600">-₹${Number(p.amount || 0).toFixed(2)}</td>
            ${isAdmin ? `<td class="px-4 py-3 text-center">
              <button class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold edit-pay-mode-btn" data-id="${p.id}" data-mode="${p.payment_mode}">Edit</button>
            </td>` : ''}
          </tr>
        `).join('') : `<tr><td colspan="${isAdmin ? 4 : 3}" class="text-center py-8 text-slate-400 text-sm">No payments made</td></tr>`}
      </tbody>
    </table>
  `;

  if (isAdmin) {
      rightCol.querySelectorAll('.edit-pay-mode-btn').forEach(btn => {
          btn.onclick = (e) => {
              e.stopPropagation();
              const payId = e.target.getAttribute('data-id');
              const oldMode = e.target.getAttribute('data-mode');
              
              const modalOverlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4' });
              const modalCard = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4' }, [
                  el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Change Payment Mode'),
                  field('New Mode', el('select', { id: 'new-pay-mode', class: inputCls }, [
                      el('option', { value: 'cash' }, 'Cash'),
                      el('option', { value: 'upi' }, 'UPI'),
                      el('option', { value: 'card' }, 'Card'),
                      el('option', { value: 'bank' }, 'Bank Transfer')
                  ])),
                  el('div', { class: 'flex justify-end gap-2 mt-4' }, [
                      el('button', { class: 'px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium text-sm', onclick: () => modalOverlay.remove() }, 'Cancel'),
                      el('button', { class: 'px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm', onclick: async (ev) => {
                          const newMode = modalCard.querySelector('#new-pay-mode').value;
                          if (newMode === oldMode.toLowerCase()) { modalOverlay.remove(); return; }
                          
                          ev.target.disabled = true; ev.target.textContent = 'Saving...';
                          const { error } = await supabase.from('supplier_payments').update({ payment_mode: newMode }).eq('id', payId);
                          if (error) {
                              if (window.toast) window.toast('Failed: ' + error.message, 'error');
                              ev.target.disabled = false; ev.target.textContent = 'Save';
                          } else {
                              if (window.toast) window.toast('Payment mode updated', 'success');
                              modalOverlay.remove();
                              overlay.remove();
                              openLedgerModal(root, supplier);
                              loadAll().then(() => paint(root));
                          }
                      } }, 'Save')
                  ])
              ]);
              
              modalCard.querySelector('#new-pay-mode').value = oldMode.toLowerCase();
              modalOverlay.appendChild(modalCard);
              document.body.appendChild(modalOverlay);
          };
      });
  }

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  body.appendChild(grid);
  card.appendChild(body);

  
  if (isAdmin) {
      card.querySelectorAll('.btn-del-purchase').forEach(btn => {
          btn.onclick = async (e) => {
              if (!confirm('Delete this purchase? This will recalculate the balance.')) return;
              const id = e.currentTarget.getAttribute('data-id');
              // Try deleting from purchase_orders, then purchases
              await supabase.from('purchase_orders').delete().eq('id', id);
              await supabase.from('purchases').delete().eq('id', id);
              toast('Purchase deleted', 'success');
              closeLedgerModal();
              await loadAll();
              paint(root);
          };
      });

      card.querySelectorAll('.btn-del-payment').forEach(btn => {
          btn.onclick = async (e) => {
              if (!confirm('Delete this payment? This will recalculate the balance.')) return;
              const id = e.currentTarget.getAttribute('data-id');
              await supabase.from('supplier_payments').delete().eq('id', id);
              toast('Payment deleted', 'success');
              closeLedgerModal();
              await loadAll();
              paint(root);
          };
      });
  }

  const footer = el('div', { class: 'p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 shrink-0' });
  footer.innerHTML = `
    
    <button id="btn-rec-purchase" class="px-5 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm shadow-sm transition">Record Purchase</button>
    <button id="btn-rec-payment" class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition">Record Payment</button>
  `;
  
  footer.querySelector('#btn-rec-purchase').onclick = () => { closeLedgerModal(); openPurchaseModal(root, supplier.id); };
  footer.querySelector('#btn-rec-payment').onclick = () => { closeLedgerModal(); openPaymentModal(root, supplier.id, balance); };
  
  
  
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
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
    el('option', { value: 'split' }, 'Split Payment (Cash + UPI + Credit)'),
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes / Invoice Number (optional)', class: inputCls });

  const purSplitBox = el('div', { class: 'hidden grid grid-cols-2 gap-2 mt-2' }, [
      field('Cash Amount', el('input', { type: 'number', id: 'pur-cash-amt', class: inputCls, value: '0' })),
      field('UPI Amount', el('input', { type: 'number', id: 'pur-upi-amt', class: inputCls, value: '0' }))
  ]);

  modeIn.onchange = (e) => {
      purSplitBox.classList.toggle('hidden', e.target.value !== 'split');
  };

  card.appendChild(field('Amount *', amtIn));
  card.appendChild(field('Payment Mode *', modeIn));
  card.appendChild(purSplitBox);
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
          const { data: existingPOs } = await supabase.from('purchase_orders').select('po_number').eq('tenant_id', store.state.tenant.id);
          let maxPO = 0;
          if (existingPOs) {
              existingPOs.forEach(po => {
                  const num = parseInt((po.po_number || '').replace(/\D/g, ''), 10);
                  if (!isNaN(num) && num > maxPO) maxPO = num;
              });
          }
          const nextPoNumber = 'PO-' + (maxPO + 1);

          let finalStatus = modeIn.value === 'credit' ? 'credit' : 'paid';
          let finalMode = modeIn.value === 'split' ? 'split' : modeIn.value;
          
          if (modeIn.value === 'split') {
              const cashAmt = Number(document.getElementById('pur-cash-amt').value) || 0;
              const upiAmt = Number(document.getElementById('pur-upi-amt').value) || 0;
              if (cashAmt + upiAmt > amount) throw new Error("Split amounts cannot exceed total amount");
              if (cashAmt + upiAmt < amount) finalStatus = 'credit'; 
          }

          const poPayload = {
            tenant_id: store.state.tenant.id, outlet_id: store.state.outlet.id, supplier_id: supplierId,
            po_number: nextPoNumber, subtotal: amount, tax_total: 0, grand_total: amount,
            payment_mode: finalMode, payment_status: finalStatus, status: 'received',
            notes: notesIn.value.trim() || null, created_by: store.state.session?.user?.id || null
          };
          
          const { data: newPO, error } = await supabase.from('purchase_orders').insert(poPayload).select().single();
          if (error) throw error;

          if (modeIn.value === 'split') {
              const cashAmt = Number(document.getElementById('pur-cash-amt').value) || 0;
              const upiAmt = Number(document.getElementById('pur-upi-amt').value) || 0;

              if (cashAmt > 0) {
                  await supabase.from('supplier_payments').insert({ tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: cashAmt, payment_mode: 'cash', notes: `Split payment for PO ${nextPoNumber}`, created_by: store.state.session?.user?.id || null });
                  try {
                      const { addCashMovement } = await import('../cash.js');
                      await addCashMovement({ type: 'cash_out', amount: cashAmt, reason: `Purchase PO ${nextPoNumber} (Split)`, person_name: null });
                  } catch (err) { console.error('Failed to record cash movement:', err); }
              }
              if (upiAmt > 0) {
                  await supabase.from('supplier_payments').insert({ tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: upiAmt, payment_mode: 'upi', notes: `Split payment for PO ${nextPoNumber}`, created_by: store.state.session?.user?.id || null });
              }
          } else if (modeIn.value !== 'credit') {
              await supabase.from('supplier_payments').insert({
                  tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: amount, payment_mode: modeIn.value,
                  notes: `Auto-payment for PO ${nextPoNumber}`, created_by: store.state.session?.user?.id || null
              });
              if (modeIn.value === 'cash') {
                  try {
                      const { addCashMovement } = await import('../cash.js');
                      await addCashMovement({ type: 'cash_out', amount: amount, reason: `Purchase PO ${nextPoNumber}`, person_name: null });
                  } catch (err) { console.error('Failed to record cash movement:', err); }
              }
          }

          toast('Purchase recorded!', 'success');
          overlay.remove();
          await loadAll();
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

function openPaymentModal(root, supplierId, maxBalance) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Record Payment'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, `Outstanding balance: ${fmtMoney(maxBalance)}`));
  
  const amtIn = el('input', { type: 'number', step: '0.01', placeholder: 'Amount to pay', class: inputCls });
  const modeIn = el('select', { class: inputCls }, [
    el('option', { value: 'cash' }, 'Cash'),
    el('option', { value: 'upi' }, 'UPI'),
    el('option', { value: 'split' }, 'Split Payment (Cash + UPI)'),
    el('option', { value: 'card' }, 'Card'),
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes (optional)', class: inputCls });

  const paySplitBox = el('div', { class: 'hidden grid grid-cols-2 gap-2 mt-2' }, [
      field('Cash Amount', el('input', { type: 'number', id: 'pay-cash-amt', class: inputCls, value: '0' })),
      field('UPI Amount', el('input', { type: 'number', id: 'pay-upi-amt', class: inputCls, value: '0' }))
  ]);

  modeIn.onchange = (e) => {
      paySplitBox.classList.toggle('hidden', e.target.value !== 'split');
  };

  const amtContainer = el('div', { class: 'flex gap-2 items-end' });
  amtContainer.appendChild(field('Amount *', amtIn));
  amtContainer.appendChild(el('button', {
    type: 'button',
    class: 'px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 mb-3 transition whitespace-nowrap',
    onclick: () => { amtIn.value = maxBalance; if (amtIn.dispatchEvent) amtIn.dispatchEvent(new Event('input')); }
  }, 'Pay Full'));

  card.appendChild(amtContainer);
  card.appendChild(field('Payment Mode *', modeIn));
  card.appendChild(paySplitBox);
  card.appendChild(field('Notes', notesIn));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' },[
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amtIn.value);
        if (!amount || amount <= 0) { toast('Enter valid amount', 'warn'); return; }

        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          if (modeIn.value === 'split') {
              const cashAmt = Number(document.getElementById('pay-cash-amt').value) || 0;
              const upiAmt = Number(document.getElementById('pay-upi-amt').value) || 0;
              
              if (cashAmt + upiAmt <= 0) throw new Error("Enter valid split amounts");
              if (Math.abs((cashAmt + upiAmt) - amount) > 0.01) throw new Error("Split amounts must equal total amount");

              if (cashAmt > 0) {
                  await supabase.from('supplier_payments').insert({ tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: cashAmt, payment_mode: 'cash', notes: notesIn.value.trim() || null, created_by: store.state.session?.user?.id || null });
                  try {
                      const { addCashMovement } = await import('../cash.js');
                      await addCashMovement({ type: 'cash_out', amount: cashAmt, reason: 'Split Payment to Supplier', person_name: null });
                  } catch (err) { console.error('Failed to record cash movement:', err); }
              }
              if (upiAmt > 0) {
                  await supabase.from('supplier_payments').insert({ tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: upiAmt, payment_mode: 'upi', notes: notesIn.value.trim() || null, created_by: store.state.session?.user?.id || null });
              }
          } else {
              const { error } = await supabase.from('supplier_payments').insert({
                tenant_id: store.state.tenant.id, supplier_id: supplierId, amount: amount, payment_mode: modeIn.value, notes: notesIn.value.trim() || null, created_by: store.state.session?.user?.id || null
              });
              if (error) throw error;
              if (modeIn.value === 'cash') {
                  try {
                      const { addCashMovement } = await import('../cash.js');
                      await addCashMovement({ type: 'cash_out', amount: amount, reason: 'Payment to Supplier', person_name: null });
                  } catch (err) { console.error('Failed to record cash movement:', err); }
              }
          }
          toast('Payment recorded!', 'success');
          overlay.remove();
          await loadAll();
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
}
