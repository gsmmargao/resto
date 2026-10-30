import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, toast } from '../utils.js';
import { clearCart } from './cart.js';
import { saveInvoiceAndPayments } from './invoice.js';
import { buildReceiptData, buildReceiptText, buildReceiptHTML } from './receipt.js';
import { publishThankYou } from './customer-display.js';
import { isOnline, queuePayment } from './offline-sync.js';
import {
  buildReceiptBytes, printHTML, printUSB, printSerial, printViaBridge,
  connectUSB, connectSerial, checkBridge, isUSBConnected, isSerialConnected,
  downloadEscPos, openCashDrawer, uint8ToBase64,
} from './printer.js';
import { CONFIG } from '../../../config.js';

const round2 = n => Math.round(Number(n || 0) * 100) / 100;

export async function openCheckoutModal() {
  const cart = store.state.cart;
  const t = cart.totals;
  if (!cart.items.length) { toast('Cart is empty', 'warn'); return; }
  if (cart.orderType === 'dine_in' && !cart.tableId) { toast('Select a table first', 'warn'); return; }
  if (!t) { toast('Cart totals missing', 'error'); return; }
  if (!cart.orderId) { toast('Send to kitchen first', 'warn'); return; }

  const orderId = cart.orderId;

  const state = {
    customer: { 
        phone: cart.customerPhone || '', 
        name: cart.customerName || '', 
        gstin: '', 
        id: cart.customerId || null 
    },
    tipAmount: 0,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-stretch sm:items-center justify-center p-2 sm:p-4' });
  const modal = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-3xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden' });

  const header = el('div', { class: 'px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0' }, [
    el('div', {}, [
      el('div', { class: 'font-semibold text-lg' }, 'Review Order'),
      el('div', { class: 'text-xs text-slate-300' }, `${cart.orderType.replace('_',' ')} • ${cart.items.length} items`),
    ]),
    el('button', { class: 'text-slate-300 hover:text-white text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]);

  const body = el('div', { class: 'flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 overflow-y-auto' });
  const left  = el('div', { class: 'p-4 border-r border-slate-200 space-y-4' });
  const right = el('div', { class: 'p-4 space-y-4' });
  body.appendChild(left); body.appendChild(right);

  // ---------- LEFT: Summary ----------
  const itemsBox = el('div', { class: 'bg-slate-50 rounded-lg p-3 text-sm' });
  itemsBox.appendChild(el('div', { class: 'font-semibold text-slate-700 mb-2' }, 'Order Summary'));
  cart.items.forEach(l => {
    itemsBox.appendChild(el('div', { class: 'flex justify-between py-0.5' }, [
      el('span', { class: 'text-slate-700' }, `${l.qty} × ${l.name}${l.variantName ? ' (' + l.variantName + ')' : ''}`),
      el('span', { class: 'text-slate-800 font-medium' }, fmtMoney(l.qty * l.unitPrice)),
    ]));
  });
  left.appendChild(itemsBox);

  const tRow = (l, v, cls = '') => el('div', { class: `flex justify-between ${cls}` }, [
    el('span', { class: 'text-slate-500' }, l),
    el('span', { class: 'text-slate-800 font-medium' }, v),
  ]);
  left.appendChild(el('div', { class: 'text-sm space-y-1' }, [
    tRow('Subtotal', fmtMoney(t.gross)),
    t.discount > 0 ? tRow('Discount', '− ' + fmtMoney(t.discount), 'text-emerald-600') : null,
    t.roundOff !== 0 ? tRow('Round Off', fmtMoney(t.roundOff)) : null,
    el('div', { class: 'flex justify-between pt-2 mt-2 border-t border-slate-300 text-base font-semibold text-slate-900' }, [
      el('span', {}, 'Grand Total'), el('span', {}, fmtMoney(t.grand)),
    ]),
  ].filter(Boolean)));

  left.appendChild(el('div', { class: 'space-y-2 pt-2 border-t border-slate-200' }, [
    el('div', { class: 'font-semibold text-slate-700 text-sm' }, 'Customer (optional)'),
    el('input', { type: 'tel', placeholder: 'Phone Number', value: state.customer.phone, class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm', oninput: e => { state.customer.phone = e.target.value.trim(); } }),
    el('input', { type: 'text', placeholder: 'Name', value: state.customer.name, class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm', oninput: e => { state.customer.name = e.target.value.trim(); } }),
    el('input', { type: 'text', placeholder: 'GSTIN (B2B)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm', oninput: e => { state.customer.gstin = e.target.value.trim(); } }),
  ]));

  // ---------- RIGHT: Tip & Proceed ----------
  const tipIn = el('input', {
    type: 'number', step: '1', min: '0', placeholder: 'Enter Tip Amount (₹)',
    class: 'w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.tipAmount = Number(e.target.value || 0); }
  });

  right.appendChild(el('div', { class: 'space-y-2' }, [
    el('div', { class: 'font-semibold text-slate-700 text-sm' }, 'Tip'),
    tipIn,
  ]));

  right.appendChild(el('div', { class: 'mt-auto pt-6' }, [
    el('button', {
      class: 'w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-base font-semibold shadow-sm',
      onclick: () => {
        overlay.remove();
        openPaymentPopup(orderId, t, state.customer, state.tipAmount);
      }
    }, 'Proceed to Payment →')
  ]));

  modal.appendChild(header); modal.appendChild(body);
  overlay.appendChild(modal); document.body.appendChild(overlay);
}

// ============================================================
// STEP 2: PAYMENT POPUP MODAL
// ============================================================
function openPaymentPopup(orderId, totals, customer, tipAmount) {
  const grandWithTip = round2(totals.grand + tipAmount);
  
  const state = {
    mode: 'cash',
    amount: grandWithTip,
    tendered: grandWithTip,
    reference: '',
    customer: { ...customer } // Copy customer object so we can mutate it
  };

  let availableCustomers = [];
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-[90] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden max-h-[90vh]' });

  // Header
  card.appendChild(el('div', { class: 'px-5 py-4 bg-slate-50 border-b border-slate-200 text-center shrink-0' }, [
    el('div', { class: 'text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1' }, 'Amount to Pay'),
    el('div', { class: 'text-3xl font-bold text-slate-900' }, fmtMoney(grandWithTip)),
    tipAmount > 0 ? el('div', { class: 'text-xs text-emerald-600 font-medium mt-1' }, `Includes ${fmtMoney(tipAmount)} tip`) : null,
  ].filter(Boolean)));

  // Body
  const body = el('div', { class: 'p-5 space-y-4 overflow-y-auto' });
  
  // Mode Tabs
  const tabs = el('div', { class: 'grid grid-cols-5 gap-1' });
  const modes = [
    { id: 'cash', label: '💵 Cash' },
    { id: 'card', label: '💳 Card' },
    { id: 'upi', label: '📱 UPI' },
    { id: 'credit', label: '📝 Credit' },
    { id: 'no_charge', label: '🚫 No' }
  ];

  const renderTabs = () => {
    tabs.innerHTML = '';
    modes.forEach(m => {
      const active = state.mode === m.id;
      tabs.appendChild(el('button', {
        class: `py-2 rounded-lg text-[10px] font-semibold flex flex-col items-center gap-1 border-2 transition ${
          active ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
        }`,
        onclick: () => {
          state.mode = m.id;
          renderTabs();
          renderInputs();
        }
      }, [
        el('span', { class: 'text-lg' }, m.label.split(' ')[0]),
        el('span', {}, m.label.split(' ')[1])
      ]));
    });
  };

  const inputsBox = el('div', { class: 'pt-2' });

  const renderInputs = () => {
    inputsBox.innerHTML = '';
    
    if (state.mode === 'credit') {
      // Show existing customer or create new
      if (state.customer && state.customer.id) {
        inputsBox.appendChild(el('div', { class: 'bg-amber-50 p-3 rounded-lg border border-amber-200 text-sm mb-3' }, [
            el('div', { class: 'font-bold text-amber-800' }, `Customer: ${state.customer.name}`),
            el('div', { class: 'text-amber-600' }, `${state.customer.phone || 'No phone'}`),
            el('button', { class: 'text-xs text-red-500 mt-2 hover:underline font-bold', onclick: () => { state.customer = { id: null, name: '', phone: '', gstin: '' }; renderInputs(); } }, 'Change Customer')
        ]));
      } else {
        inputsBox.appendChild(el('div', { class: 'space-y-3' }, [
            el('div', {}, [
                el('label', { class: 'block text-xs font-semibold text-slate-600 mb-1' }, 'Select Existing Customer'),
                el('select', {
                    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
                    onchange: (e) => {
                        const cid = e.target.value;
                        if (cid) {
                            const c = availableCustomers.find(x => x.id === cid);
                            state.customer = { id: c.id, name: c.name, phone: c.phone, gstin: '' };
                            renderInputs();
                        }
                    }
                }, [
                    el('option', { value: '' }, '-- Choose Customer --'),
                    ...availableCustomers.map(c => el('option', { value: c.id }, `${c.name} (${c.phone || 'No phone'})`))
                ])
            ]),
            el('div', { class: 'text-center text-xs text-slate-400 font-semibold py-1' }, '- OR CREATE NEW -'),
            el('div', {}, [
                el('input', { type: 'text', id: 'new-cust-name', placeholder: 'New Customer Name', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm mb-2 focus:ring-2 focus:ring-indigo-500' }),
                el('input', { type: 'tel', id: 'new-cust-phone', placeholder: 'Phone Number (Optional)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm mb-2 focus:ring-2 focus:ring-indigo-500' }),
                el('button', {
                    class: 'w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition',
                    onclick: async (e) => {
                        const name = document.getElementById('new-cust-name').value.trim();
                        const phone = document.getElementById('new-cust-phone').value.trim();
                        if (!name) { if(window.toast) window.toast('Customer name is required', 'warn'); return; }
                        e.currentTarget.textContent = 'Creating...';
                        const { data, error } = await supabase.from('customers').insert({ 
                            tenant_id: store.state.tenant.id, 
                            name, 
                            phone: phone || null 
                        }).select().single();
                        
                        if (data) {
                            state.customer = { id: data.id, name: data.name, phone: data.phone, gstin: '' };
                            if(window.toast) window.toast('Customer created', 'success');
                            renderInputs();
                        } else {
                            if(window.toast) window.toast('Failed to create customer', 'error');
                            e.currentTarget.textContent = '+ Create & Select';
                        }
                    }
                }, '+ Create & Select')
            ])
        ]));
      }
    } else if (state.mode === 'cash') {
      inputsBox.appendChild(el('div', { class: 'space-y-1' }, [
        el('label', { class: 'text-xs font-medium text-slate-600' }, 'Cash Tendered'),
        el('input', {
          type: 'number', step: '1', value: state.tendered,
          class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center font-semibold',
          oninput: e => {
            state.tendered = Number(e.target.value || 0);
            updateChange();
          }
        })
      ]));
      
      inputsBox.appendChild(el('div', { class: 'mt-3 flex justify-between items-center text-sm', id: 'change-box' }, [
        el('span', { class: 'text-slate-500 font-medium' }, 'Return Change:'),
        el('span', { class: 'text-xl font-bold text-emerald-600', id: 'change-amount' }, fmtMoney(Math.max(0, state.tendered - state.amount)))
      ]));
    } else if (state.mode === 'card' || state.mode === 'upi') {
      inputsBox.appendChild(el('div', { class: 'space-y-1' }, [
        el('label', { class: 'text-xs font-medium text-slate-600' }, 'Reference / Txn ID (Optional)'),
        el('input', {
          type: 'text', placeholder: 'e.g. 1234567890',
          class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
          oninput: e => { state.reference = e.target.value; }
        })
      ]));
    } else if (state.mode === 'no_charge') {
      inputsBox.appendChild(el('div', { class: 'text-center text-sm text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-200 mb-3' }, 
        'No payment will be collected for this order.'
      ));
      inputsBox.appendChild(el('div', { class: 'space-y-1' }, [
        el('label', { class: 'text-xs font-medium text-slate-600' }, 'Name / Notes (e.g., Staff Meal, Owner Guest)'),
        el('input', {
          type: 'text', placeholder: 'Enter person name or reason',
          class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
          oninput: e => { state.reference = e.target.value; }
        })
      ]));
    }
  };

  const updateChange = () => {
    const changeEl = document.getElementById('change-amount');
    if (changeEl) {
      changeEl.textContent = fmtMoney(Math.max(0, state.tendered - state.amount));
    }
  };

  // Fetch customers initially for the Credit tab
  if (supabase && store.state.tenant) {
      supabase.from('customers').select('id, name, phone').eq('tenant_id', store.state.tenant.id).order('name').then(({data}) => {
          if (data) availableCustomers = data;
      });
  }

  renderTabs();
  renderInputs();
  body.appendChild(tabs);
  body.appendChild(inputsBox);
  card.appendChild(body);

  // Footer
  const footer = el('div', { class: 'p-4 border-t border-slate-200 bg-slate-50 shrink-0' }, [
    el('button', {
      id: 'btn-confirm-pay',
      class: 'w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base shadow-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        
        if (state.mode === 'credit' && (!state.customer || !state.customer.id)) {
            if(window.toast) window.toast('Please select or create a customer for Credit', 'warn');
            return;
        }

        btn.disabled = true; btn.textContent = 'Processing…';
        
        try {
          const payments = [{
            mode: state.mode,
            amount: grandWithTip,
            tendered: state.mode === 'cash' ? state.tendered : null,
            reference: state.reference
          }];

          await completePayment(orderId, totals, state.customer, payments, tipAmount);
          overlay.remove();
        } catch (err) {
          console.error(err);
          if(window.toast) window.toast('Payment failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Confirm Payment';
        }
      }
    }, 'Confirm Payment')
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// COMPLETE PAYMENT LOGIC
// ============================================================
async function completePayment(orderId, totals, customer, payments, tipAmount) {
  if (!isOnline()) {
    const clientUuid = crypto.randomUUID();
    const grand = Number(totals.grand) + Number(tipAmount || 0);
    const payload = {
      client_uuid: clientUuid,
      tenant_id: store.state.tenant.id, outlet_id: store.state.outlet.id,
      order_id: orderId, member_id: store.state.member?.id || null,
      created_by: store.state.session?.user?.id || null,
      customer_id: customer.id || null, customer_name: customer.name || null,
      customer_phone: customer.phone || null, customer_gstin: customer.gstin || null,
      gross_total: Number(totals.gross), discount_total: Number(totals.discount),
      taxable_value: Number(totals.taxable), cgst: round2(Number(totals.tax) / 2),
      sgst: round2(Number(totals.tax) / 2), igst: 0, service_charge: Number(totals.serviceCharge || 0),
      round_off: Number(totals.roundOff || 0), grand_total: grand,
      tip_amount: Number(tipAmount || 0), paid_at: new Date().toISOString(),
      payments: payments.map(p => ({
        mode: p.mode, amount: Number(p.amount), tip_amount: 0,
        tendered: p.tendered, change: p.tendered ? Math.max(0, p.tendered - p.amount) : null,
        reference: p.reference
      })),
    };
    await queuePayment(payload);
    toast('Payment saved offline', 'warn');
    clearCart();
    import('../router.js').then(({ navigate }) => navigate('dashboard'));
    return;
  }

  const result = await saveInvoiceAndPayments({
    orderId, totals, customer, payments, tipAmount,
  });

  // If payment mode is Credit, update the customer's credit balance
  const isCredit = payments.some(p => p.mode === 'credit');
  if (isCredit) {
      if (!customer || !customer.id) {
          toast('Customer required for Credit. Please add a customer.', 'error');
          return;
      }
      
      const grandTotal = Number(totals.grand) + Number(tipAmount || 0);
      
      // Fetch current balance
      const { data: custData } = await supabase.from('customers').select('credit_balance').eq('id', customer.id).single();
      const currentBalance = Number(custData?.credit_balance || 0);
      
      await supabase.from('customers').update({
          credit_balance: currentBalance + grandTotal
      }).eq('id', customer.id);
  }

  // NEW: Mark all KOTs for this order as SERVED so they clear from the KDS
  try {
    await supabase.from('kots').update({ status: 'served' }).eq('order_id', orderId);
  } catch (e) {
    console.error('[billing] Failed to mark KOTs as served:', e);
  }

  try {
    publishThankYou({
      orderNumber: result.invoice?.invoice_number,
      grandTotal: Number(result.invoice?.grand_total || 0),
    });
  } catch (e) {}

  // Auto Print
  try {
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    const tableName = store.state.tables.find(t => t.id === order?.table_id)?.name || null;
    
    const receiptData = buildReceiptData({
      tenant: store.state.tenant, outlet: store.state.outlet, order,
      items: result.items, invoice: result.invoice, payments: result.payments,
      customer: result.customer, tableName,
    });

    if (CONFIG.LOCAL_SERVER_IP) {
      fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-bill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receiptData)
      }).catch(err => console.error('LAN Print error:', err));
    } else if (isUSBConnected()) {
      await printUSB(buildReceiptBytes(receiptData));
    }
  } catch (printErr) {
    console.error('[billing] Auto-print failed:', printErr);
  }

  toast('Payment successful', 'success');
  clearCart();
  import('../router.js').then(({ navigate }) => navigate('dashboard'));
}
