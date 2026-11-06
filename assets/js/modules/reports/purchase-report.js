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
    return wrap; // <--- STOP RENDERING FOR PURCHASER
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
      
      const currentStatus = row.status || (row.is_verified ? 'verified' : 'pending');
      const statusBadge = currentStatus === 'verified'
        ? '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">VERIFIED</span>'
        : currentStatus === 'rejected'
        ? '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-[10px] font-bold">REJECTED</span>'
        : '<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">PENDING</span>';

      const actionCol = isAdmin && currentStatus === 'pending'
        ? `<div class="flex gap-1 justify-center">
             <button class="px-2 py-1 bg-emerald-500 text-white rounded font-bold text-[10px] hover:bg-emerald-600 action-btn" data-id="${row.id}" data-action="verified">Verify ✓</button>
             <button class="px-2 py-1 bg-red-500 text-white rounded font-bold text-[10px] hover:bg-red-600 action-btn" data-id="${row.id}" data-action="rejected">Reject ✗</button>
           </div>`
        : `<span class="text-slate-600 font-medium text-xs">${row.verified_by_name || '—'}</span>`;

      tr.innerHTML = `
        <td class="px-4 py-3 text-xs text-slate-500">${new Date(row.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td class="px-4 py-3 text-sm font-semibold text-slate-800">${row.item_name}</td>
        <td class="px-4 py-3 text-sm text-slate-600">${row.supplier_name}</td>
        <td class="px-4 py-3 text-sm font-bold text-slate-800 text-right">₹${Number(row.amount).toFixed(2)}</td>
        <td class="px-4 py-3 text-center">${statusBadge}</td>
        <td class="px-4 py-3 text-center">${actionCol}</td>
      `;

      tbody.appendChild(tr);
    });

    // 4. Handle Action Buttons (Verify / Reject) with Password Prompt
    listCard.querySelectorAll('.action-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = btn.getAttribute('data-id');
            const action = btn.getAttribute('data-action');
            const actionLabel = action === 'verified' ? 'Verify' : 'Reject';
            
            // Create Modal
            const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
            const card = el('div', { class: 'bg-white rounded-xl shadow-xl w-full max-w-sm p-5' });
            
            const title = el('h3', { class: 'font-bold text-slate-800 mb-2' }, `Confirm ${actionLabel}`);
            const desc = el('p', { class: 'text-xs text-slate-500 mb-4' }, 'Please enter your password to authorize this action.');
            const pwdIn = el('input', { type: 'password', placeholder: 'Password', class: 'w-full p-2 border border-slate-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none' });
            
            const errMsg = el('div', { class: 'text-xs text-red-500 mb-2 hidden' });
            
            const actions = el('div', { class: 'flex gap-2' }, [
                el('button', { class: 'flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm transition', onclick: () => overlay.remove() }, 'Cancel'),
                el('button', { 
                    class: `flex-1 py-2 ${action === 'verified' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'} text-white font-semibold rounded-lg text-sm transition`,
                    onclick: async () => {
                        if (!pwdIn.value) return;
                        const submitBtn = actions.lastChild;
                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Checking...';
                        
                        try {
                            // Verify Password
                            const { error: authErr } = await supabase.auth.signInWithPassword({
                                email: store.state.session.user.email,
                                password: pwdIn.value
                            });
                            
                            if (authErr) throw new Error('Incorrect password');
                            
                            // Update Database
                            await supabase.from('purchase_reports').update({
                                status: action,
                                is_verified: action === 'verified',
                                verified_by_name: userName,
                                verified_at: new Date().toISOString()
                            }).eq('id', id);
                            
                            toast(`Bill ${actionLabel.toLowerCase()}d successfully`, 'success');
                            overlay.remove();
                            renderPurchaseReport().then(newWrap => wrap.replaceWith(newWrap));
                            
                        } catch (err) {
                            errMsg.textContent = err.message;
                            errMsg.classList.remove('hidden');
                            submitBtn.disabled = false;
                            submitBtn.textContent = actionLabel;
                        }
                    }
                }, actionLabel)
            ]);
            
            card.append(title, desc, pwdIn, errMsg, actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            pwdIn.focus();
        };
    });

  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="text-red-500 p-4">Error loading purchase reports: ${err.message}</div>`;
  }

  return wrap;
}
