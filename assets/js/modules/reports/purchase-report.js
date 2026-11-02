import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';

export async function renderPurchaseReport() {
  const wrap = el('div', { class: 'w-full space-y-6' });

  // Check user role
  const role = store.state.member?.role || '';
  const userName = store.state.member?.display_name || 'Admin';
  const isPurchaser = role === 'purchaser';
  const isAdmin = role === 'owner' || role === 'admin' || role === 'manager';

  // 1. Add Entry Form (Only for Purchaser)
  if (isPurchaser) {
    const formCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-5 shadow-sm' });
    formCard.innerHTML = `<h3 class="font-bold text-slate-800 mb-4">Record Forgotten Bill</h3>`;
    
    const itemIn = el('input', { type: 'text', placeholder: 'Item Name', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm mb-3' });
    const supplierIn = el('input', { type: 'text', placeholder: 'Supplier Name', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm mb-3' });
    const amountIn = el('input', { type: 'number', placeholder: 'Amount (₹)', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm mb-3' });
    
    const submitBtn = el('button', { class: 'w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition' }, 'Submit for Verification');
    
    submitBtn.onclick = async () => {
        if (!itemIn.value || !supplierIn.value || !amountIn.value) return toast('Please fill all fields', 'warn');
        submitBtn.disabled = true; submitBtn.textContent = 'Saving...';
        
        try {
            await supabase.from('purchase_reports').insert({
                tenant_id: store.state.tenant.id,
                outlet_id: store.state.outlet.id,
                item_name: itemIn.value.trim(),
                supplier_name: supplierIn.value.trim(),
                amount: Number(amountIn.value),
                created_by: store.state.session?.user?.id
            });
            toast('Entry submitted for verification', 'success');
            renderPurchaseReport().then(newWrap => wrap.replaceWith(newWrap));
        } catch (err) {
            toast('Failed: ' + err.message, 'error');
            submitBtn.disabled = false; submitBtn.textContent = 'Submit for Verification';
        }
    };

    formCard.append(itemIn, supplierIn, amountIn, submitBtn);
    wrap.appendChild(formCard);
  }

  // 2. The Table
  const listCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden' });
  listCard.innerHTML = `
    <div class="px-5 py-4 bg-slate-50 border-b border-slate-200">
        <h3 class="font-bold text-slate-800 text-sm">Purchase Verification Report</h3>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left">
        <thead class="bg-white text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-100">
          <tr>
            <th class="px-4 py-3">Date</th>
            <th class="px-4 py-3">Item</th>
            <th class="px-4 py-3">Supplier</th>
            <th class="px-4 py-3 text-right">Amount</th>
            <th class="px-4 py-3 text-center">Status</th>
            <th class="px-4 py-3 text-center">Verified By</th>
          </tr>
        </thead>
        <tbody id="purchase-reports-tbody"></tbody>
      </table>
    </div>
  `;
  wrap.appendChild(listCard);

  // 3. Fetch Data
  try {
    const { data, error } = await supabase.from('purchase_reports')
      .select('*')
      .eq('tenant_id', store.state.tenant.id)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    const tbody = listCard.querySelector('#purchase-reports-tbody');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400">No purchase reports found.</td></tr>';
        return wrap;
    }

    data.forEach(row => {
      const tr = el('tr', { class: 'border-b border-slate-50 hover:bg-slate-50/50' });
      
      const statusBadge = row.is_verified 
        ? '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">VERIFIED</span>'
        : '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">PENDING</span>';

      const actionCol = isAdmin && !row.is_verified 
        ? `<button class="px-2 py-1 bg-emerald-500 text-white rounded font-bold text-xs hover:bg-emerald-600 verify-btn" data-id="${row.id}">Verify ✓</button>` 
        : `<span class="text-slate-600 font-medium">${row.verified_by_name || '—'}</span>`;

      tr.innerHTML = `
        <td class="px-4 py-3 text-xs text-slate-500">${new Date(row.created_at).toLocaleDateString('en-GB')}</td>
        <td class="px-4 py-3 text-sm font-semibold text-slate-800">${row.item_name}</td>
        <td class="px-4 py-3 text-sm text-slate-600">${row.supplier_name}</td>
        <td class="px-4 py-3 text-sm font-bold text-slate-800 text-right">₹${Number(row.amount).toFixed(2)}</td>
        <td class="px-4 py-3 text-center">${statusBadge}</td>
        <td class="px-4 py-3 text-center">${actionCol}</td>
      `;

      tbody.appendChild(tr);
    });

    // 4. Handle Verify Button Click
    listCard.querySelectorAll('.verify-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.target.getAttribute('data-id');
            e.target.disabled = true; e.target.textContent = '...';
            try {
                await supabase.from('purchase_reports').update({
                    is_verified: true,
                    verified_by_name: userName,
                    verified_at: new Date().toISOString()
                }).eq('id', id);
                toast('Verified successfully', 'success');
                renderPurchaseReport().then(newWrap => wrap.replaceWith(newWrap));
            } catch (err) {
                toast('Verification failed: ' + err.message, 'error');
                e.target.disabled = false; e.target.textContent = 'Verify ✓';
            }
        };
    });

  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="text-red-500 p-4">Error loading purchase reports: ${err.message}</div>`;
  }

  return wrap;
}
