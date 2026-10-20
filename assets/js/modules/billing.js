import { supabase } from '../supabase-client.js';
import { CONFIG } from '../../../config.js';
import { store } from '../store.js';
import { el, fmtMoney, fmtRelative, toast } from '../utils.js';
import { clearCart } from './cart.js';
import { saveInvoiceAndPayments } from './invoice.js';
import { buildReceiptData, buildReceiptText, buildReceiptHTML } from './receipt.js';
import { publishThankYou, publishIdle } from './customer-display.js';
import { isOnline, queuePayment } from './offline-sync.js';
import { hasFeature, showUpgradeGate } from './entitlements.js';
import {
  buildReceiptBytes, printHTML, printUSB, printSerial, printViaBridge,
  connectUSB, connectSerial, checkBridge, isUSBConnected, isSerialConnected,
  downloadEscPos, openCashDrawer, uint8ToBase64,
} from './printer.js';

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
    customer: { phone: '', name: '', gstin: '', id: null },
    payments: [{ mode: 'cash', amount: t.grand, tendered: t.grand, reference: '' }],
    tipAmount: 0,
    credit: {
      customerId: null,
      loaded: false,
      points: 0,
      wallet: 0,
      program: null,
      giftCards: [],
    },
    search: {
      results: [],
      loading: false,
      open: false,
      focused: false,
    },
    newCustomer: { name: '', phone: '', dirty: false },
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-stretch sm:items-center justify-center p-2 sm:p-4' });
  const modal = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-4xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden' });

  const header = el('div', { class: 'px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0' }, [
    el('div', {}, [
      el('div', { class: 'font-semibold text-lg' }, 'Checkout'),
      el('div', { class: 'text-xs text-slate-300' }, `${cart.orderType.replace('_',' ')} • ${cart.items.length} items • ${fmtMoney(t.grand)}`),
    ]),
    el('button', { class: 'text-slate-300 hover:text-white text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]);

  const body = el('div', { class: 'flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 overflow-y-auto' });
  const left  = el('div', { class: 'p-4 border-r border-slate-200 space-y-4 overflow-visible' });
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
  const isGst = store.state.tenant?.settings?.is_gst_enabled !== false;
  
  left.appendChild(el('div', { class: 'text-sm space-y-1' }, [
    tRow('Subtotal', fmtMoney(t.gross)),
    t.discount > 0 ? tRow('Discount', '− ' + fmtMoney(t.discount), 'text-emerald-600') : null,
    isGst ? tRow('Taxable', fmtMoney(t.taxable)) : null,
    isGst ? tRow('CGST', fmtMoney(t.tax / 2)) : null,
    isGst ? tRow('SGST', fmtMoney(t.tax / 2)) : null,
    t.serviceCharge > 0 ? tRow('Svc Charge', fmtMoney(t.serviceCharge)) : null,
    t.roundOff !== 0 ? tRow('Round Off', fmtMoney(t.roundOff)) : null,
    el('div', { class: 'flex justify-between pt-2 mt-2 border-t border-slate-300 text-base font-semibold text-slate-900' }, [
      el('span', {}, 'Grand Total'), el('span', {}, fmtMoney(t.grand)),
    ]),
  ].filter(Boolean)));

  // ---------- CUSTOMER SEARCH ----------
  const customerBox = el('div', { class: 'space-y-2 pt-2 border-t border-slate-200 relative' });
  left.appendChild(customerBox);

  customerBox.appendChild(el('div', { class: 'flex items-center justify-between' }, [
    el('div', { class: 'font-semibold text-slate-700 text-sm' }, 'Customer'),
    state.customer.id
      ? el('button', {
          class: 'text-[10px] text-slate-400 hover:text-slate-700 underline',
          onclick: () => clearCustomer(),
        }, 'Clear')
      : null,
  ].filter(Boolean)));

  // Search input
  const searchIn = el('input', {
    type: 'search',
    placeholder: 'Search by phone, name or email…',
    autocomplete: 'off',
    class: 'w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });

  // Results dropdown
  const resultsBox = el('div', {
    class: 'hidden absolute left-4 right-4 top-full mt-1 z-50 bg-white rounded-lg shadow-2xl border border-slate-200 max-h-72 overflow-y-auto',
  });
  customerBox.appendChild(searchIn);
  customerBox.appendChild(resultsBox);

  // Selected customer card (shown after selection)
  const selectedCard = el('div', { class: 'hidden bg-indigo-50 border border-indigo-200 rounded-lg p-3' });
  customerBox.appendChild(selectedCard);

  // GSTIN field only shows after a customer is picked
  const gstinBox = el('div', { class: 'hidden' }, [
    el('label', { class: 'block text-xs text-slate-500 mb-1 mt-2' }, 'GSTIN (B2B)'),
    el('input', {
      type: 'text',
      placeholder: 'Optional for B2B invoices',
      class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
      oninput: e => { state.customer.gstin = e.target.value.trim(); },
    }),
  ]);
  customerBox.appendChild(gstinBox);

  // ---------- RIGHT: Payment ----------
  const payModeTabs = el('div', { class: 'grid grid-cols-5 gap-1' });
  const paymentRows = el('div', { class: 'space-y-2' });
  right.appendChild(el('div', { class: 'font-semibold text-slate-700 text-sm' }, 'Payment Mode'));
  right.appendChild(payModeTabs);
  right.appendChild(paymentRows);
  right.appendChild(el('button', {
    class: 'w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-sm hover:border-indigo-400 hover:text-indigo-600',
    onclick: () => { state.payments.push({ mode: 'card', amount: 0, tendered: 0, reference: '' }); renderPayments(); },
  }, '+ Add Split Payment'));

  const creditBox = el('div', { class: 'border-t border-slate-200 pt-3 space-y-2' });
  right.appendChild(creditBox);

  const tipIn = el('input', {
    type: 'number', step: '1', min: '0', placeholder: 'Enter Tip Amount (₹)',
    class: 'w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => {
      state.tipAmount = Number(e.target.value || 0);
      renderPayments();
    }
  });
  
  right.appendChild(el('div', { class: 'space-y-2 pt-2 border-t border-slate-200' }, [
    el('div', { class: 'font-semibold text-slate-700 text-sm' }, 'Tip'),
    tipIn,
  ]));

  const printerBar = el('div', { class: 'text-xs text-slate-500 flex items-center gap-2' }, [
    el('span', {}, 'Printer:'),
    el('span', { id: 'printer-status', class: 'font-medium text-slate-400' }, 'not connected'),
  ]);
  right.appendChild(printerBar);
  refreshPrinterStatus();

  const footer = el('div', { class: 'p-4 bg-slate-50 border-t border-slate-200 grid grid-cols-2 gap-2 shrink-0' }, [
    el('button', {
      class: 'py-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
      onclick: () => overlay.remove(),
    }, 'Cancel'),
    el('button', {
      id: 'btn-complete',
      class: 'py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow',
    }, 'Complete Payment'),
  ]);

  modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);
  overlay.appendChild(modal); document.body.appendChild(overlay);

  renderPayModeTabs();
  renderPayments();
  renderCredit();
  renderSelectedCustomer();
  footer.querySelector('#btn-complete').addEventListener('click', completePayment);

  // ---------- CUSTOMER SEARCH LOGIC ----------
  let searchTimer = null;

  searchIn.addEventListener('input', () => {
    state.customer.phone = searchIn.value.trim();
    state.customer.name = ''; // reset when typing fresh
    clearTimeout(searchTimer);
    const q = searchIn.value.trim();
    if (!q) {
      state.newCustomer = { name: '', phone: '', dirty: false };
    }
    if (q.length < 2) {
      state.search.results = [];
      state.search.open = false;
      renderSearchResults();
      return;
    }
    state.search.loading = true;
    state.search.open = true;
    renderSearchResults();
    searchTimer = setTimeout(() => runSearch(q), 300);
  });

  searchIn.addEventListener('focus', () => {
    state.search.focused = true;
    if (state.search.results.length) {
      state.search.open = true;
      renderSearchResults();
    }
  });

  // Close dropdown when clicking outside
  const outsideClick = (ev) => {
    if (!customerBox.contains(ev.target)) {
      state.search.open = false;
      renderSearchResults();
    }
  };
  setTimeout(() => document.addEventListener('click', outsideClick), 0);

  async function runSearch(query) {
    const tenantId = store.state.tenant.id;
    const clean = query.replace(/[%_]/g, ''); // strip SQL wildcards
    if (!clean) return;

    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email, gstin, total_orders, total_spend, loyalty_points, wallet_balance, last_visit_at')
        .eq('tenant_id', tenantId)
        .or(`phone.ilike.%${clean}%,name.ilike.%${clean}%,email.ilike.%${clean}%`)
        .order('last_visit_at', { ascending: false, nullsfirst: false })
        .limit(8);

      if (error) throw error;
      state.search.results = data || [];
    } catch (err) {
      console.warn('[billing] customer search failed', err);
      state.search.results = [];
    } finally {
      state.search.loading = false;
      renderSearchResults();
    }
  }

  function renderSearchResults() {
    resultsBox.innerHTML = '';

    if (!state.search.open) {
      resultsBox.classList.add('hidden');
      return;
    }

    resultsBox.classList.remove('hidden');

    // Loading state
    if (state.search.loading) {
      resultsBox.appendChild(el('div', { class: 'px-4 py-3 text-center text-slate-400 text-xs' }, 'Searching…'));
      return;
    }

    // No results — show inline create form
    if (!state.search.results.length) {
      const q = searchIn.value.trim();
      const digits = q.replace(/\D/g, '');
      const isPhoneLike = digits.length >= 6 && digits.length <= 15;
      const isNameLike = /[A-Za-z]/.test(q);

      // Auto-fill draft from the query — but never overwrite once the user has edited
      if (!state.newCustomer.dirty) {
        if (isPhoneLike && !isNameLike) {
          state.newCustomer.phone = q;
          state.newCustomer.name = '';
        } else if (isNameLike && !isPhoneLike) {
          state.newCustomer.name = q;
          state.newCustomer.phone = '';
        }
      }

      const nameIn = el('input', {
        type: 'text',
        placeholder: 'Customer name',
        value: state.newCustomer.name,
        class: 'w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500',
        oninput: (e) => { state.newCustomer.name = e.target.value; state.newCustomer.dirty = true; },
      });

      const phoneIn = el('input', {
        type: 'tel',
        placeholder: 'Phone number',
        value: state.newCustomer.phone,
        class: 'w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500',
        oninput: (e) => { state.newCustomer.phone = e.target.value; state.newCustomer.dirty = true; },
      });

      const createBtn = el('button', {
        class: 'w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold',
        onclick: () => {
          const name  = state.newCustomer.name.trim();
          const phone = state.newCustomer.phone.trim();
          const cleanDigits = phone.replace(/\D/g, '');
          if (cleanDigits.length < 6) {
            toast('Enter a valid phone number (at least 6 digits)', 'warn');
            phoneIn.focus();
            return;
          }
          state.customer = { id: null, name, phone, gstin: '' };
          state.newCustomer = { name: '', phone: '', dirty: false };
          searchIn.value = phone;
          closeSearch();
          loadCredit();
          renderSelectedCustomer();
          toast(name ? `Using "${name}" — new customer will be created` : 'New customer will be created at checkout', 'success', 2200);
        },
      }, '+ Create & Use');

      resultsBox.appendChild(el('div', { class: 'p-3 space-y-2' }, [
        el('div', { class: 'text-[11px] text-slate-500 flex items-center gap-1.5' }, [
          el('span', { class: 'w-1.5 h-1.5 rounded-full bg-emerald-500' }),
          el('span', {}, 'New customer — fill in and create'),
        ]),
        nameIn,
        phoneIn,
        createBtn,
      ]));
      return;
    }

    // Results list
    state.search.results.forEach(c => {
      const initial = (c.name || c.phone || '?').charAt(0).toUpperCase();
      const points = Number(c.loyalty_points || 0);
      const wallet = Number(c.wallet_balance || 0);
      const orders = Number(c.total_orders || 0);
      const spend = Number(c.total_spend || 0);

      resultsBox.appendChild(el('button', {
        class: 'w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-slate-100 last:border-0 transition flex items-center gap-3',
        onclick: () => {
          selectCustomer(c);
        },
      }, [
        el('div', { class: 'w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-sm font-bold flex items-center justify-center shrink-0' }, initial),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('div', { class: 'flex items-center gap-2' }, [
            el('div', { class: 'text-sm font-medium text-slate-800 truncate' }, c.name || '—'),
            points > 0 ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold shrink-0' }, `${points} pt`) : null,
            wallet > 0 ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold shrink-0' }, fmtMoney(wallet)) : null,
          ].filter(Boolean)),
          el('div', { class: 'text-[11px] text-slate-500 truncate mt-0.5' }, [
            c.phone,
            orders > 0 ? `· ${orders} orders` : null,
            spend > 0 ? `· ${fmtMoney(spend)}` : null,
            c.last_visit_at ? `· ${fmtRelative(c.last_visit_at)} ago` : null,
          ].filter(Boolean).join(' ')),
        ]),
        el('span', { class: 'text-[10px] text-indigo-500 font-medium shrink-0' }, 'Select →'),
      ]));
    });
  }

  function selectCustomer(c) {
    state.newCustomer = { name: '', phone: '', dirty: false };
    state.customer = {
      id: c.id,
      phone: c.phone || '',
      name: c.name || '',
      gstin: c.gstin || '',
    };
    searchIn.value = c.phone || c.name || '';
    closeSearch();
    renderSelectedCustomer();

    // Populate GSTIN field if present
    const gstinInput = gstinBox.querySelector('input');
    if (gstinInput) gstinInput.value = c.gstin || '';
    gstinBox.classList.toggle('hidden', !c.gstin && !state.customer.phone);

    // Load their store credit + gift cards
    loadCreditFromCustomer(c);
  }

  function closeSearch() {
    state.search.open = false;
    state.search.focused = false;
    renderSearchResults();
  }

  function clearCustomer() {
    state.customer = { phone: '', name: '', gstin: '', id: null };
    state.newCustomer = { name: '', phone: '', dirty: false };
    searchIn.value = '';
    state.credit = { customerId: null, loaded: false, points: 0, wallet: 0, program: null, giftCards: [] };
    renderSelectedCustomer();
    renderCredit();
    gstinBox.classList.add('hidden');
  }

  function renderSelectedCustomer() {
    selectedCard.innerHTML = '';
    if (!state.customer.phone && !state.customer.name && !state.customer.id) {
      selectedCard.classList.add('hidden');
      gstinBox.classList.add('hidden');
      return;
    }
    selectedCard.classList.remove('hidden');

    const initial = (state.customer.name || state.customer.phone || '?').charAt(0).toUpperCase();
    selectedCard.appendChild(el('div', { class: 'flex items-center gap-2.5' }, [
      el('div', { class: 'w-8 h-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0' }, initial),
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'text-sm font-semibold text-indigo-900 truncate' }, state.customer.name || '(new customer)'),
        el('div', { class: 'text-[11px] text-indigo-700 truncate' }, state.customer.phone),
      ]),
      state.customer.id
        ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-bold shrink-0' }, 'EXISTING')
        : el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold shrink-0' }, 'NEW'),
    ]));

    gstinBox.classList.remove('hidden');
  }

  // ---------- CREDIT LOADING ----------
  function loadCreditFromCustomer(c) {
    state.credit.customerId = c.id;
    state.credit.points = Number(c.loyalty_points || 0);
    state.credit.wallet = Number(c.wallet_balance || 0);
    // Gift cards still need a fetch
    (async () => {
      const tenantId = store.state.tenant.id;
      const [progRes, gcRes] = await Promise.all([
        supabase.from('loyalty_programs').select('*')
          .eq('tenant_id', tenantId).eq('is_active', true).limit(1).maybeSingle(),
        supabase.from('gift_cards').select('id, code, balance, valid_to, is_active')
          .eq('tenant_id', tenantId).eq('is_active', true).gt('balance', 0).limit(50),
      ]);
      state.credit.program = progRes.data || null;
      state.credit.giftCards = gcRes.data || [];
      state.credit.loaded = true;
      renderCredit();
    })();
  }

  async function loadCredit() {
    const phone = state.customer.phone;
    if (!phone || phone.length < 6) {
      state.credit = { customerId: null, loaded: false, points: 0, wallet: 0, program: null, giftCards: [] };
      renderCredit();
      return;
    }
    const tenantId = store.state.tenant.id;
    const [custRes, progRes, gcRes] = await Promise.all([
      supabase.from('customers').select('id, name, loyalty_points, wallet_balance')
        .eq('tenant_id', tenantId).eq('phone', phone).maybeSingle(),
      supabase.from('loyalty_programs').select('*')
        .eq('tenant_id', tenantId).eq('is_active', true).limit(1).maybeSingle(),
      supabase.from('gift_cards').select('id, code, balance, valid_to, is_active')
        .eq('tenant_id', tenantId).eq('is_active', true).gt('balance', 0).limit(50),
    ]);

    const cust = custRes.data;
    state.credit = {
      customerId: cust?.id || null,
      loaded: true,
      points: Number(cust?.loyalty_points || 0),
      wallet: Number(cust?.wallet_balance || 0),
      program: progRes.data || null,
      giftCards: gcRes.data || [],
    };
    renderCredit();
  }

  function renderCredit() {
    creditBox.innerHTML = '';
    creditBox.appendChild(el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide' }, 'Store Credit'));

    if (!state.credit.loaded) {
      creditBox.appendChild(el('div', { class: 'text-xs text-slate-400 italic py-1' }, 'Search for a customer to check credit'));
      return;
    }
    if (!state.credit.customerId) {
      creditBox.appendChild(el('div', { class: 'text-xs text-amber-600 py-1' }, 'New customer — no credit on file'));
      return;
    }

    const program = state.credit.program;
    const pointsWorth = program ? round2(state.credit.points * Number(program.redeem_value || 0)) : 0;

    if (state.credit.points > 0 && program && pointsWorth > 0) {
      creditBox.appendChild(creditRow({
        label: `Loyalty Points: ${state.credit.points}`,
        sub: `Worth ~${fmtMoney(pointsWorth)}`,
        color: 'indigo',
        onApply: () => applyCredit('loyalty', pointsWorth, ''),
      }));
    }

    if (state.credit.wallet > 0) {
      creditBox.appendChild(creditRow({
        label: `Wallet Balance`,
        sub: fmtMoney(state.credit.wallet),
        color: 'emerald',
        onApply: () => applyCredit('wallet', state.credit.wallet, ''),
      }));
    }

    if (state.credit.giftCards.length) {
      state.credit.giftCards.forEach(gc => {
        const expired = gc.valid_to && new Date(gc.valid_to) < new Date();
        creditBox.appendChild(creditRow({
          label: `Gift Card ${gc.code}`,
          sub: expired ? 'Expired' : fmtMoney(gc.balance),
          color: expired ? 'slate' : 'purple',
          disabled: expired,
          onApply: () => applyCredit('gift_card', Number(gc.balance), gc.code),
        }));
      });
    }

    if (!state.credit.points && !state.credit.wallet && !state.credit.giftCards.length) {
      creditBox.appendChild(el('div', { class: 'text-xs text-slate-400 italic py-1' }, 'No store credit available'));
    }
  }

  function creditRow({ label, sub, color, onApply, disabled }) {
    const colors = {
      indigo:  'bg-indigo-50 border-indigo-200 text-indigo-700',
      emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      purple:  'bg-purple-50 border-purple-200 text-purple-700',
      slate:   'bg-slate-50 border-slate-200 text-slate-400',
    };
    const cls = colors[color] || colors.slate;
    return el('div', { class: `flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${cls}` }, [
      el('div', { class: 'min-w-0' }, [
        el('div', { class: 'text-xs font-semibold truncate' }, label),
        el('div', { class: 'text-[10px] opacity-80' }, sub),
      ]),
      el('button', {
        class: `text-[10px] px-2.5 py-1 rounded font-bold ${disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white hover:bg-slate-50 border border-current'}`,
        disabled: disabled ? true : null,
        onclick: disabled ? null : onApply,
      }, 'Apply'),
    ]);
  }

  function applyCredit(mode, maxAmount, reference) {
    const paidSum = round2(state.payments.reduce((s, p) => s + Number(p.amount || 0), 0));
    const due = round2(t.grand + state.tipAmount - paidSum);
    if (due <= 0.01) { toast('Bill is already fully paid', 'warn'); return; }
    const amount = Math.min(round2(maxAmount), due);

    if (state.payments.length === 1 && Number(state.payments[0].amount || 0) === 0) {
      state.payments = [];
    }

    state.payments.push({ mode, amount, tendered: amount, reference: reference || '' });

    renderPayModeTabs();
    renderPayments();
    toast(`Applied ${fmtMoney(amount)} from ${mode.replace('_', ' ')}`, 'success', 1200);
  }

  async function refreshPrinterStatus() {
    const el2 = document.getElementById('printer-status');
    if (!el2) return;
    if (isUSBConnected()) { el2.textContent = 'USB connected'; el2.className = 'font-medium text-emerald-600'; return; }
    if (isSerialConnected()) { el2.textContent = 'Serial connected'; el2.className = 'font-medium text-emerald-600'; return; }
    if (await checkBridge()) { el2.textContent = 'Bridge connected'; el2.className = 'font-medium text-emerald-600'; return; }
    el2.textContent = 'not connected'; el2.className = 'font-medium text-slate-400';
  }

  function renderPayModeTabs() {
    payModeTabs.innerHTML = '';
    const single = state.payments.length === 1 ? state.payments[0].mode : 'split';
    const modes = [
      { id: 'cash',       label: 'Cash' },
      { id: 'card',       label: 'Card' },
      { id: 'upi',        label: 'UPI' },
      { id: 'gift_card',  label: 'Gift Card' },
      { id: 'split',      label: 'Split' },
    ];
    modes.forEach(m => {
      const active = single === m.id;
      payModeTabs.appendChild(el('button', {
        class: `py-2 rounded-lg text-xs font-medium capitalize ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`,
        onclick: () => {
          if (m.id === 'split') {
            state.payments = [
              { mode: 'cash', amount: round2(t.grand / 2), tendered: 0, reference: '' },
              { mode: 'card', amount: round2(t.grand / 2), tendered: 0, reference: '' },
            ];
          } else if (m.id === 'gift_card') {
            const code = prompt('Enter gift card code:');
            if (!code) return;
            state.payments = [{ mode: 'gift_card', amount: t.grand, tendered: 0, reference: code.trim().toUpperCase() }];
          } else {
            state.payments = [{ mode: m.id, amount: t.grand, tendered: m.id === 'cash' ? t.grand : 0, reference: '' }];
          }
          renderPayModeTabs();
          renderPayments();
        },
      }, m.label));
    });
  }

  function renderPayments() {
    // Remember which input was focused before we wipe the DOM
    const active = document.activeElement;
    let focusedId = null;
    let cursorPos = 0;
    if (active && active.tagName === 'INPUT') {
      focusedId = active.getAttribute('data-focus-id');
      cursorPos = active.selectionStart;
    }

    paymentRows.innerHTML = '';
    const paidSum = round2(state.payments.reduce((s, p) => s + Number(p.amount || 0), 0));
    const due = round2(t.grand + state.tipAmount - paidSum);

    state.payments.forEach((p, i) => {
      const row = el('div', { class: 'border border-slate-200 rounded-lg p-3 space-y-2' });
      row.appendChild(el('div', { class: 'flex justify-between items-center' }, [
        el('span', { class: 'text-xs uppercase tracking-wide text-slate-500 font-semibold' }, `Payment ${i + 1} • ${p.mode.replace('_',' ')}`),
        state.payments.length > 1
          ? el('button', { class: 'text-xs text-red-500 hover:text-red-700', onclick: () => { state.payments.splice(i, 1); renderPayments(); renderPayModeTabs(); } }, 'Remove')
          : null,
      ].filter(Boolean)));

      row.appendChild(numInput('Amount', p.amount, v => { p.amount = v; renderPayments(); }, `pay-${i}-amount`));

      if (p.mode === 'cash') {
        row.appendChild(numInput('Tendered', p.tendered, v => { p.tendered = v; renderPayments(); }, `pay-${i}-tendered`));
        const change = round2((p.tendered || 0) - (p.amount || 0));
        if (change > 0) {
          row.appendChild(el('div', { class: 'mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-center' }, [
            el('div', { class: 'text-xs text-emerald-700 font-semibold uppercase tracking-wide' }, 'Return Change to Customer'),
            el('div', { class: 'text-2xl font-bold text-emerald-600 mt-0.5' }, fmtMoney(change))
          ]));
        }
      } else if (p.mode === 'card' || p.mode === 'upi') {
        row.appendChild(textInput('Reference / Txn ID', p.reference, v => { p.reference = v; }, `pay-${i}-ref`));
      } else if (p.mode === 'gift_card') {
        row.appendChild(textInput('Gift Card Code', p.reference, v => { p.reference = v.toUpperCase(); }, `pay-${i}-gift`));
      }

      paymentRows.appendChild(row);
    });

    paymentRows.appendChild(el('div', {
      class: `text-sm px-3 py-2 rounded-lg ${due > 0.01 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`,
    }, due > 0.01 ? `Balance due: ${fmtMoney(due)}` : 'Paid in full'));

    // Restore focus and cursor position
    if (focusedId) {
      const newEl = document.querySelector(`[data-focus-id="${focusedId}"]`);
      if (newEl) {
        newEl.focus();
        if (newEl.setSelectionRange) {
          try {
            newEl.setSelectionRange(cursorPos, cursorPos);
          } catch (e) {
            // Ignore if browser blocks it
          }
        }
      }
    }
  }

  function numInput(label, value, onChange, focusId = null) {
    return el('div', {}, [
      el('label', { class: 'block text-xs text-slate-500 mb-1' }, label),
      el('input', {
        type: 'text', 
        inputmode: 'decimal',
        value,
        'data-focus-id': focusId,
        class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
        oninput: e => {
          const val = e.target.value;
          // Only allow numbers and a single decimal point
          if (!/^\d*\.?\d*$/.test(val)) return;
          onChange(Number(val || 0));
        },
      }),
    ]);
  }
  function textInput(label, value, onChange, focusId = null) {
    return el('div', {}, [
      el('label', { class: 'block text-xs text-slate-500 mb-1' }, label),
      el('input', {
        type: 'text', value,
        'data-focus-id': focusId,
        class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
        oninput: e => onChange(e.target.value),
      }),
    ]);
  }

  async function completePayment() {
    const btn = footer.querySelector('#btn-complete');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      if (!isOnline()) {
        const clientUuid = crypto.randomUUID();
        const grand = Number(t.grand) + Number(state.tipAmount || 0);
        const payload = {
          client_uuid: clientUuid,
          tenant_id: store.state.tenant.id,
          outlet_id: store.state.outlet.id,
          order_id: orderId,
          member_id: store.state.member?.id || null,
          created_by: store.state.session?.user?.id || null,
          customer_id: state.customer.id || null,
          customer_name:  state.customer.name  || null,
          customer_phone: state.customer.phone || null,
          customer_gstin: state.customer.gstin || null,
          gross_total:    Number(t.gross),
          discount_total: Number(t.discount),
          taxable_value:  Number(t.taxable),
          cgst: round2(Number(t.tax) / 2),
          sgst: round2(Number(t.tax) / 2),
          igst: 0,
          service_charge: Number(t.serviceCharge || 0),
          round_off:      Number(t.roundOff || 0),
          grand_total:    grand,
          tip_amount:     Number(state.tipAmount || 0),
          paid_at:        new Date().toISOString(),
          payments: state.payments.map(p => ({
            mode: p.mode,
            amount: Number(p.amount),
            tip_amount: 0,
            tendered: p.tendered || null,
            change: p.tendered ? Math.max(0, Number(p.tendered) - Number(p.amount)) : null,
            reference: p.reference || null,
          })),
        };
        await queuePayment(payload);
        overlay.remove();
        toast('Payment saved offline — will sync when reconnected', 'warn', 4000);
        clearCart();
        return;
      }

      const result = await saveInvoiceAndPayments({
        orderId, totals: t, customer: state.customer,
        payments: state.payments, tipAmount: state.tipAmount,
      });
      overlay.remove();
      try {
        publishThankYou({
          orderNumber: result.invoice?.invoice_number,
          grandTotal: Number(result.invoice?.grand_total || 0),
        });
      } catch (e) {}

      // --- AUTO PRINT RECEIPT ---
      try {
        const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
        const tableName = store.state.tables.find(t => t.id === order?.table_id)?.name || null;
        
        const receiptData = buildReceiptData({
          tenant: store.state.tenant, 
          outlet: store.state.outlet, 
          order,
          items: result.items, 
          invoice: result.invoice,
          payments: result.payments, 
          customer: result.customer, 
          tableName,
        });

        if (CONFIG.LOCAL_SERVER_IP) {
          // Print via local LAN Server
          fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-bill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(receiptData)
          }).then(res => {
            if (!res.ok) throw new Error('Server error: ' + res.status);
            console.log("✅ Bill sent to Local Server");
            toast('Payment saved & Bill printed', 'success', 3000);
          }).catch(err => {
            console.error('❌ LAN Print error:', err);
            toast('Payment saved, but LAN printer failed', 'warn', 3000);
          });
        } else if (isUSBConnected()) {
          await printUSB(buildReceiptBytes(receiptData));
          toast('Payment saved & Receipt printed', 'success', 3000);
        } else {
          toast('Payment saved (Printer not connected)', 'success', 3000);
        }
      } catch (printErr) {
        console.error('[billing] Auto-print failed:', printErr);
        toast('Payment saved, but printer failed', 'warn', 3000);
      }

      clearCart();
      
      // Navigate back to dashboard to reset the UI
      import('../router.js').then(({ navigate }) => navigate('dashboard'));
    } catch (e) {
      console.error(e);
      toast(e.message || 'Failed to save invoice', 'error');
      btn.disabled = false;
      btn.textContent = 'Complete Payment';
    }
  }
}

async function showSuccessScreen(result, orderId) {
  const tenant = store.state.tenant;
  const outlet = store.state.outlet;

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  const tableName = store.state.tables.find(t => t.id === order?.table_id)?.name || null;

  const data = buildReceiptData({
    tenant, outlet, order,
    items: result.items, invoice: result.invoice,
    payments: result.payments, customer: result.customer, tableName,
  });

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto' });

  card.appendChild(el('div', { class: 'text-center' }, [
    el('div', { class: 'text-4xl mb-2' }, '✓'),
    el('div', { class: 'font-semibold text-lg text-slate-800' }, 'Payment Recorded'),
    el('div', { class: 'text-sm text-slate-500' }, `Invoice ${result.invoice.invoice_number}`),
  ]));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-2 pt-2 border-t border-slate-100' }, [
    el('button', {
      class: 'py-2 rounded-lg border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 font-medium',
      onclick: async (e) => { e.currentTarget.disabled = true; await connectUSB(); e.currentTarget.disabled = false; },
    }, '🔌 Connect USB Printer'),
    el('button', {
      class: 'py-2 rounded-lg border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 font-medium',
      onclick: async (e) => { e.currentTarget.disabled = true; await connectSerial(); e.currentTarget.disabled = false; },
    }, '🔌 Connect Serial'),
  ]));

  const actions = el('div', { class: 'grid grid-cols-2 gap-2' });

  actions.appendChild(el('button', {
    class: 'py-2.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium',
    onclick: async (e) => {
      const orig = e.currentTarget.textContent;
      try {
        e.currentTarget.textContent = 'Printing…';
        if (isUSBConnected()) { await printUSB(buildReceiptBytes(data)); toast('Printed via USB', 'success'); }
        else if (isSerialConnected()) { await printSerial(buildReceiptBytes(data)); toast('Printed via Serial', 'success'); }
        else if (await checkBridge()) { await printViaBridge(uint8ToBase64(buildReceiptBytes(data))); toast('Printed via Bridge', 'success'); }
        else { toast('No printer connected — use Browser Print', 'warn'); }
      } catch (err) { toast('Print failed: ' + err.message, 'error'); }
      finally { e.currentTarget.textContent = orig; }
    },
  }, '🖨️ Print Receipt'));

  actions.appendChild(el('button', {
    class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium',
    onclick: () => printHTML(buildReceiptHTML(data)),
  }, 'Browser Print'));

  actions.appendChild(el('button', {
    class: 'py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium',
    onclick: async () => { await openCashDrawer(); toast('Drawer opened', 'success'); },
  }, '💰 Open Drawer'));

  actions.appendChild(el('button', {
    class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
    onclick: () => downloadEscPos(buildReceiptBytes(data), `${result.invoice.invoice_number}.bin`),
  }, 'Download .bin'));

  actions.appendChild(el('button', {
    class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
    onclick: () => { navigator.clipboard.writeText(buildReceiptText(data)).then(() => toast('Receipt copied', 'success')); },
  }, 'Copy Text'));

  // WhatsApp — gated by plan feature
  const waEnabled = hasFeature('whatsapp');
  actions.appendChild(el('button', {
    class: `py-2.5 rounded-lg text-sm font-medium ${
      !waEnabled ? 'bg-slate-100 text-slate-400'
      : data.customer.phone ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
    }`,
    onclick: async (e) => {
      if (!waEnabled) {
        showUpgradeGate('WhatsApp receipts', () => {
          document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove());
          location.hash = '#billing-upgrade';
        });
        return;
      }
      if (!data.customer.phone) { toast('No phone on file', 'warn'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { sendOrderReceipt } = await import('./whatsapp.js');
        await sendOrderReceipt({
          order: { id: orderId, order_number: data.invoice.orderNumber, table_name_snapshot: data.invoice.table },
          invoice: result.invoice,
          items: result.items,
          customer: { id: result.customer?.id, name: data.customer.name, phone: data.customer.phone },
          phone: data.customer.phone,
        });
      } catch (err) { console.error(err); toast('Failed: ' + err.message, 'error'); }
      finally { btn.disabled = false; }
    },
  }, waEnabled ? 'WhatsApp' : 'WhatsApp 🔒'));

  card.appendChild(actions);

  card.appendChild(el('button', {
    class: 'w-full py-3 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-semibold',
    onclick: () => overlay.remove(),
  }, 'New Order'));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
