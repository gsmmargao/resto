import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js?v=1793466117';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';

export function openPersonLedgerModal(name, movements) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden' });
  
  let totalHeld = 0;
  movements.forEach(m => {
    const typeStr = (m.movement_type || '').toLowerCase();
    if (typeStr.includes('out') || typeStr.includes('withdraw')) totalHeld += Number(m.amount);
    if (typeStr.includes('in') || typeStr.includes('deposit')) totalHeld -= Number(m.amount);
  });

  let rowsHtml = movements.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(m => {
    const typeStr = (m.movement_type || '').toLowerCase();
    const isOut = typeStr.includes('out') || typeStr.includes('withdraw');
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50">
        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(m.created_at).toLocaleString('en-GB', {dateStyle:'short', timeStyle:'short'})}</td>
        <td class="px-4 py-3 text-sm font-medium ${isOut ? 'text-red-600' : 'text-emerald-600'}">${isOut ? 'Cash Taken' : 'Cash Returned'}</td>
        <td class="px-4 py-3 text-sm text-slate-700">${m.reason || '—'}</td>
        <td class="px-4 py-3 text-sm text-right font-bold ${isOut ? 'text-red-600' : 'text-emerald-600'}">${isOut ? '-' : '+'}₹${Number(m.amount).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  card.innerHTML = `
    <div class="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
      <div>
        <h3 class="font-bold text-xl text-slate-800">${name}'s Cash Ledger</h3>
        <p class="text-sm text-slate-500 mt-1">Total Cash Held: <span class="font-bold text-red-600 text-lg ml-1">₹${totalHeld.toFixed(2)}</span></p>
      </div>
      <button class="text-slate-400 hover:text-slate-700 text-3xl leading-none" id="close-person-ledger">&times;</button>
    </div>
    <div class="overflow-y-auto flex-1 p-4">
      <table class="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
        <thead class="bg-slate-50 text-xs text-slate-500 uppercase tracking-widest border-b border-slate-200">
          <tr>
            <th class="px-4 py-3 font-semibold">Date & Time</th>
            <th class="px-4 py-3 font-semibold">Type</th>
            <th class="px-4 py-3 font-semibold">Reason</th>
            <th class="px-4 py-3 font-semibold text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="4" class="text-center py-6 text-slate-400">No movements found</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  card.querySelector('#close-person-ledger').onclick = () => overlay.remove();
}

export async function openBillReprintModal(invoiceId) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const loader = el('div', { class: 'bg-white rounded-2xl shadow-2xl p-8 text-center' }, [ el('div', { class: 'text-slate-400 text-sm' }, 'Loading bill...') ]);
  overlay.appendChild(loader);
  document.body.appendChild(overlay);

  try {
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
    const { data: payments } = await supabase.from('payments').select('*').eq('invoice_id', invoiceId);
    const { data: order } = await supabase.from('orders').select('*').eq('id', inv.order_id).single();
    
    let customer = null;
    if (inv.customer_id) {
      const { data: c } = await supabase.from('customers').select('*').eq('id', inv.customer_id).single();
      customer = c;
    }

    const tableName = store.state.tables.find(t => t.id === order?.table_id)?.name || order?.table_name_snapshot;
    const receiptData = buildReceiptData({
      tenant: store.state.tenant, outlet: store.state.outlet, order,
      items: items, invoice: inv, payments: payments || [], customer: customer || inv, tableName,
    });

    overlay.remove();
    const modalOverlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 overflow-y-auto' });
    const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md my-8 flex flex-col max-h-[90vh]' });
    
    card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0' }, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Bill Preview'),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => modalOverlay.remove() }, '×'),
    ]));

    const body = el('div', { class: 'p-5 overflow-y-auto bg-slate-100 flex justify-center shrink' });
    const previewWrapper = el('div', { class: 'bg-white shadow-sm p-4 w-[80mm] text-black' });
    previewWrapper.innerHTML = buildReceiptHTML(receiptData);
    
    const style = el('style', {}, `
      .receipt { font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.2; color: #000; }
      .receipt .center { text-align: center; }
      .receipt .r { text-align: right; }
      .receipt .row { display: flex; justify-content: space-between; }
      .receipt table { width: 100%; border-collapse: collapse; margin: 4px 0; }
      .receipt th, .receipt td { padding: 2px 0; font-size: 12px; }
      .receipt th { border-bottom: 1px dashed #000; text-align: left; }
      .receipt hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
      .receipt .bold { font-weight: bold; }
      .receipt .big { font-size: 14px; }
    `);
    previewWrapper.appendChild(style);
    body.appendChild(previewWrapper);
    card.appendChild(body);

    const footer = el('div', { class: 'p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2' }, [
      el('button', {
        class: 'px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const orig = btn.innerHTML;
          btn.innerHTML = 'Printing...';
          btn.disabled = true;
          
          try {
            // Use the receiptData already built at the top of the function
            
            const serverIP = (typeof CONFIG !== 'undefined' && CONFIG.LOCAL_SERVER_IP) ? CONFIG.LOCAL_SERVER_IP : '192.168.100.19';
            const printUrl = `https://${serverIP}:3000/api/print-bill`;
            
            const res = await fetch(printUrl, {
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(receiptData)
            });
            
            if (!res.ok) throw new Error('LAN server rejected print request');
            if (window.toast) window.toast('Bill sent to printer', 'success');
          } catch (err) {
            console.error(err);
            if (window.toast) window.toast('Print failed: ' + err.message, 'error');
          }
          
          btn.innerHTML = orig;
          btn.disabled = false;
        }
      }, '🖨️ Print')
    ]);
    card.appendChild(footer);
    modalOverlay.appendChild(card);
    document.body.appendChild(modalOverlay);
  } catch (err) {
    console.error(err);
    toast('Failed to load bill: ' + err.message, 'error');
    overlay.remove();
  }
}

export async function openModeToggleModal(invoiceId, currentMode) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4' });
  
  card.appendChild(el('h3', { class: 'text-xl font-bold text-slate-800' }, 'Update Payment Mode'));
  card.appendChild(el('p', { class: 'text-sm text-slate-500' }, 'Select the correct mode. If mapping to Credit, assign a customer.'));

  // Fetch ALL customers for the tenant (removed strict outlet_id filter)
  const { data: customers, error: custErr } = await supabase.from('customers')
    .select('id, name')
    .eq('tenant_id', window.store.state.tenant.id);
  
  if (custErr) console.error("Error fetching customers:", custErr);

  const customerDiv = el('div', { class: 'hidden text-left mt-2' }, [
    el('label', { class: 'text-xs font-bold text-slate-600' }, 'Select Customer'),
    el('select', { id: 'map-customer-select', class: 'w-full mt-1 p-2 border border-slate-300 rounded-lg text-sm' }, [
      el('option', { value: '' }, '-- Select Customer --'),
      ...(customers || []).map(c => el('option', { value: c.id }, c.name))
    ])
  ]);

  const btnContainer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2 pb-2' });
  
  const handleSelect = async (newMode) => {
    const custId = document.getElementById('map-customer-select').value;
    if (newMode === 'credit' && !custId) {
      toast('Please select a customer for Credit bills.', 'warn');
      return;
    }

    try {
      overlay.remove();
      toast('Updating...', 'info', 1000);
      
      // 1. Update payment mode
      await supabase.from('payments').update({ 
        mode: newMode,
        customer_id: newMode === 'credit' ? custId : null 
      }).eq('invoice_id', invoiceId);

      // 2. Get invoice amount
      const { data: inv } = await supabase.from('invoices').select('grand_total, customer_id').eq('id', invoiceId).single();

      if (newMode === 'credit') {
         // 3. Add to Customer's Credit Balance
         const { data: cust } = await supabase.from('customers').select('credit_balance').eq('id', custId).single();
         const newBal = Number(cust.credit_balance || 0) + Number(inv.grand_total);
         await supabase.from('customers').update({ credit_balance: newBal }).eq('id', custId);

         // 4. Update Invoice
         await supabase.from('invoices').update({
             customer_id: custId,
             balance_due: Number(inv.grand_total)
         }).eq('id', invoiceId);
      } else {
         // If switching AWAY from credit, we should subtract from the old customer's balance
         if (inv.customer_id) {
             const { data: oldCust } = await supabase.from('customers').select('credit_balance').eq('id', inv.customer_id).single();
             if (oldCust) {
                 const newBal = Math.max(0, Number(oldCust.credit_balance || 0) - Number(inv.grand_total));
                 await supabase.from('customers').update({ credit_balance: newBal }).eq('id', inv.customer_id);
             }
         }
         await supabase.from('invoices').update({ balance_due: 0 }).eq('id', invoiceId);
      }

      toast(`Mode changed to ${newMode.toUpperCase()}`, 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error(err);
      toast('Failed to update mode: ' + err.message, 'error');
    }
  };

  const modes = [
    { id: 'cash', label: '💵 Cash', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
    { id: 'upi',  label: '📱 UPI',  color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
    { id: 'card', label: '💳 Card', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
    { id: 'credit', label: '📝 Credit', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' }
  ];

  modes.forEach(m => {
    const isActive = currentMode.toLowerCase().includes(m.id);
    btnContainer.appendChild(el('button', {
      class: `py-3 rounded-xl border-2 font-bold transition flex flex-col items-center justify-center gap-1 ${isActive ? 'ring-2 ring-offset-2 ring-slate-400 ' + m.color : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`,
      onclick: () => {
        if (m.id === 'credit') {
            customerDiv.classList.remove('hidden');
        } else {
            customerDiv.classList.add('hidden');
            handleSelect(m.id);
        }
      }
    }, [
      el('span', { class: 'text-lg' }, m.label.split(' ')[0]),
      el('span', { class: 'text-[10px] uppercase tracking-wide' }, m.id)
    ]));
  });

  card.appendChild(btnContainer);
  card.appendChild(customerDiv);
  
  const confirmBtn = el('button', { class: 'w-full py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hidden mt-2', onclick: () => handleSelect('credit') }, 'Confirm Credit Mapping');
  card.appendChild(confirmBtn);
  
  // Show confirm button when a customer is selected
  customerDiv.addEventListener('change', (e) => {
      if (e.target.value) {
          confirmBtn.classList.remove('hidden');
      } else {
          confirmBtn.classList.add('hidden');
      }
  });

  card.appendChild(el('button', { class: 'w-full py-2.5 rounded-lg text-slate-500 hover:bg-slate-100 text-sm font-medium transition mt-2', onclick: () => overlay.remove() }, 'Cancel'));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

