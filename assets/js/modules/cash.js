import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney, toast } from '../utils.js';

let cashChannel = null;

// ============================================================
// DATA
// ============================================================
export async function loadOpenShift() {
  const outletId = store.state.outlet?.id;
  if (!outletId) { store.set('cashRegister', null); return null; }

  try {
    // 1. Try to find the current open shift
    let { data: openShift, error } = await supabase
      .from('cash_registers').select('*').eq('outlet_id', outletId)
      .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();

    if (error) throw error;

    if (openShift) {
      store.set('cashRegister', openShift);
      return openShift;
    }

    // 2. If no open shift exists, look for the last closed shift to get the carried-over cash
    let { data: lastClosed } = await supabase
      .from('cash_registers').select('counted_cash').eq('outlet_id', outletId)
      .eq('status', 'closed').order('closed_at', { ascending: false }).limit(1).maybeSingle();

    const openingBalance = lastClosed?.counted_cash || 0;

    // 3. Auto-create a new shift
    let { data: newShift, error: createErr } = await supabase.from('cash_registers').insert({
      tenant_id: store.state.tenant.id,
      outlet_id: outletId,
      shift_name: `Shift ${new Date().toLocaleDateString('en-IN')}`,
      opened_by: store.state.member?.id || null,
      opening_balance: openingBalance,
      status: 'open'
    }).select().single();

    if (createErr) throw createErr;

    store.set('cashRegister', newShift);
    return newShift;

  } catch (err) {
    console.error('[cash] Auto-open shift failed', err);
    store.set('cashRegister', null);
    return null;
  }
}

export async function fetchShiftTotals(shiftId) {
  const { data, error } = await supabase.from('payments').select('mode, amount, tip_amount, is_refund, status')
    .eq('cash_register_id', shiftId).eq('status', 'success').eq('is_refund', false);
  if (error) { console.error('[cash] totals', error); return blankTotals(); }
  
  const t = blankTotals();
  t.tips = 0; // Initialize tips

  (data || []).forEach(p => {
    const mode = ['gift_card', 'loyalty', 'credit', 'due', 'aggregator'].includes(p.mode) ? 'other' : p.mode;
    const amt = Number(p.amount || 0);
    const tip = Number(p.tip_amount || 0);
    
    // Add ONLY the food amount to the sales column
    t[mode] = (t[mode] || 0) + amt;
    
    // Add the tip to the tips column
    t.tips += tip;
    
    // Total Sales includes both
    t.total += (amt + tip);
    t.count += 1;
  });
  return t;
}

export async function fetchMovements(shiftId) {
  const shift = store.state.cashRegister;
  
  // 1. Fetch Cash Movements (Manual Drawer)
  const { data: cmData } = await supabase.from('cash_movements').select('*')
    .eq('cash_register_id', shiftId).order('created_at', { ascending: false });

  // 2. Fetch Payments (Sales + Tips)
  const { data: pData } = await supabase.from('payments').select('*')
    .eq('cash_register_id', shiftId)
    .eq('mode', 'cash')
    .eq('status', 'success')
    .eq('is_refund', false);

  // 3. Fetch Tip Payouts
  let tipPayouts = [];
  if (shift && shift.opened_at) {
      const { data: tips } = await supabase.from('tip_payouts')
        .select('*')
        .eq('outlet_id', store.state.outlet.id)
        .gte('created_at', shift.opened_at)
        .eq('payment_mode', 'cash');
      if (tips) tipPayouts = tips;
  }

  // 4. Merge them all
  const merged = [...(cmData || [])];
  
  (pData || []).forEach(p => {
      if (Number(p.amount) > 0) {
          merged.push({
              id: p.id,
              movement_type: 'sale',
              amount: p.amount,
              reason: `Bill Payment`,
              created_at: p.paid_at
          });
      }
      if (Number(p.tip_amount) > 0) {
          merged.push({
              id: p.id + '-tip',
              movement_type: 'tip_in',
              amount: p.tip_amount,
              reason: `Tip Collected`,
              created_at: p.paid_at
          });
      }
  });

  tipPayouts.forEach(t => {
      const exists = merged.find(m => m.movement_type === 'tip_payout' && Number(m.amount) === Number(t.amount) && Math.abs(new Date(m.created_at) - new Date(t.created_at)) < 5000);
      if (!exists) {
          merged.push({
              id: t.id,
              movement_type: 'tip_payout',
              amount: t.amount,
              reason: `Tip Payout: ${t.staff_name}`,
              created_at: t.created_at
          });
      }
  });

  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function fetchRecentShifts(limit = 10) {
  const outletId = store.state.outlet?.id;
  if (!outletId) return [];
  const { data } = await supabase.from('cash_registers').select('*')
    .eq('outlet_id', outletId).neq('status', 'open')
    .order('closed_at', { ascending: false }).limit(limit);
  return data || [];
}

function blankTotals() {
  return { cash: 0, upi: 0, card: 0, wallet: 0, other: 0, total: 0, count: 0, tips: 0 };
}

export function computeExpectedCash(shift, totals, movements) {
  // Calculate Cash In from all sources (manual, sales, tips)
  const inSum = (movements || [])
    .filter(m => ['cash_in', 'sale', 'tip_in'].includes(m.movement_type))
    .reduce((s, m) => s + Number(m.amount), 0);

  // Calculate Cash Out from all sources (manual, payouts, expenses)
  const outSum = (movements || [])
    .filter(m => ['cash_out', 'tip_payout', 'bank_deposit', 'petty_expense'].includes(m.movement_type))
    .reduce((s, m) => s + Number(m.amount), 0);

  return Number(shift.opening_balance || 0) + inSum - outSum;
}

// ============================================================
// MUTATIONS
// ============================================================
export async function openShift({ openingBalance, shiftName, notes }) {
  const tenantId = store.state.tenant?.id;
  const outletId = store.state.outlet?.id;
  const member = store.state.member;
  if (!tenantId || !outletId) throw new Error('No tenant/outlet');

  const { data, error } = await supabase.from('cash_registers').insert({
    tenant_id: tenantId, outlet_id: outletId,
    shift_name: shiftName || `Shift ${new Date().toLocaleDateString('en-IN')}`,
    opened_by: member?.id || null,
    opening_balance: Number(openingBalance) || 0,
    status: 'open', notes: notes || null,
  }).select().single();
  if (error) throw error;
  store.set('cashRegister', data);
  return data;
}

export async function addCashMovement({ type, amount, reason }) {
  const shift = store.state.cashRegister;
  if (!shift) throw new Error('No open shift');
  
  // 1. Record in cash_movements (for the drawer math)
  const { error } = await supabase.from('cash_movements').insert({
    tenant_id: store.state.tenant?.id,
    outlet_id: store.state.outlet?.id,
    cash_register_id: shift.id,
    movement_type: type, amount: Number(amount),
    reason: reason || null, created_by: store.state.member?.id || null,
  });
  if (error) throw error;

  // 2. If it's a tip payout, also record in tip_payouts (for the Tips Ledger)
  if (type === 'tip_payout') {
    await supabase.from('tip_payouts').insert({
      tenant_id: store.state.tenant.id,
      outlet_id: store.state.outlet.id,
      amount: Number(amount),
      payment_mode: 'cash',
      staff_name: reason || 'Staff',
      created_by: store.state.session?.user?.id || null
    });
  }
}

export async function closeShift({ countedCash, notes }) {
  const shift = store.state.cashRegister;
  if (!shift) throw new Error('No open shift');
  const totals = await fetchShiftTotals(shift.id);
  const movements = await fetchMovements(shift.id);
  const expected = computeExpectedCash(shift, totals, movements);
  const difference = Math.round((Number(countedCash) - expected) * 100) / 100;

  // 1. Close the current shift
  const { data, error } = await supabase.from('cash_registers').update({
    closed_by: store.state.member?.id || null,
    closed_at: new Date().toISOString(),
    expected_cash: expected, counted_cash: Number(countedCash),
    cash_difference: difference, total_sales: totals.total,
    cash_sales: totals.cash, card_sales: totals.card,
    upi_sales: totals.upi, wallet_sales: totals.wallet,
    credit_sales: totals.other, total_orders: totals.count,
    status: 'closed', notes: notes || shift.notes,
  }).eq('id', shift.id).select().single();
  if (error) throw error;

  // 2. Auto-open the NEXT shift using the counted cash as the opening balance
  await supabase.from('cash_registers').insert({
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    shift_name: `Shift ${new Date().toLocaleDateString('en-IN')}`,
    opened_by: store.state.member?.id || null,
    opening_balance: Number(countedCash),
    status: 'open'
  });

  store.set('cashRegister', null);
  return { shift: data, totals, movements, expected, difference };
}

// ============================================================
// MAIN VIEW
// ============================================================
export async function renderCash(root) {
  root.innerHTML = '';
  await loadOpenShift();

  const wrap = el('div', { class: 'h-full overflow-auto bg-slate-100 p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-6xl mx-auto space-y-4' });

  const shift = store.state.cashRegister;

  if (shift) {
    inner.appendChild(await renderActiveShiftPanel(root, shift));
    inner.appendChild(await renderMovementsPanel(root, shift));
  } else {
    inner.appendChild(el('div', { class: 'bg-red-50 text-red-600 p-6 rounded-xl border border-red-200 text-center font-medium' }, 
      'Could not load or open a cash shift. Please check your database connection.'));
  }

  inner.appendChild(await renderHistoryPanel());

  wrap.appendChild(inner);
  root.appendChild(wrap);
  subscribeRealtime(root);
}

function subscribeRealtime(root) {
  if (cashChannel) { supabase.removeChannel(cashChannel); cashChannel = null; }
  const outletId = store.state.outlet?.id;
  if (!outletId) return;
  cashChannel = supabase
    .channel('cash-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_registers', filter: `outlet_id=eq.${outletId}` }, () => renderCash(root))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_movements', filter: `outlet_id=eq.${outletId}` }, () => renderCash(root))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `outlet_id=eq.${outletId}` }, () => renderCash(root))
    .subscribe();
}

function renderNoShiftPanel(root) {
  const card = el('div', { class: 'bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8' });
  card.appendChild(el('div', { class: 'text-center mb-6' }, [
    el('div', { class: 'text-5xl mb-3' }, '💰'),
    el('h2', { class: 'text-2xl font-bold text-slate-800' }, 'No Open Shift'),
    el('p', { class: 'text-sm text-slate-500 mt-1' }, 'Open a cash register to start taking payments'),
  ]));

  const form = el('div', { class: 'max-w-md mx-auto space-y-3' });
  const nameIn = el('input', { type: 'text', placeholder: 'Shift name (e.g. Morning)', class: inputCls });
  const balIn = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Opening cash (₹)', class: inputCls });
  const notesIn = el('input', { type: 'text', placeholder: 'Notes (optional)', class: inputCls });

  const btn = el('button', {
    class: 'w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base shadow-sm transition',
    onclick: async (e) => {
      const opening = Number(balIn.value || 0);
      if (opening < 0) { toast('Opening balance cannot be negative', 'warn'); return; }
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Opening…';
      try {
        await openShift({ openingBalance: opening, shiftName: nameIn.value.trim(), notes: notesIn.value.trim() });
        toast('Shift opened', 'success');
        await renderCash(root);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        e.currentTarget.disabled = false;
        e.currentTarget.textContent = 'Open Shift';
      }
    },
  }, 'Open Shift');

  form.appendChild(nameIn); form.appendChild(balIn); form.appendChild(notesIn); form.appendChild(btn);
  card.appendChild(form);
  return card;
}

async function renderActiveShiftPanel(root, shift) {
  const totals = await fetchShiftTotals(shift.id);
  const movements = await fetchMovements(shift.id);
  
  const inSum = movements.filter(m => ['cash_in', 'sale', 'tip_in'].includes(m.movement_type)).reduce((s, m) => s + Number(m.amount), 0);
  const outSum = movements.filter(m => ['cash_out', 'tip_payout', 'bank_deposit', 'petty_expense'].includes(m.movement_type)).reduce((s, m) => s + Number(m.amount), 0);
  
  const expected = Number(shift.opening_balance || 0) + inSum - outSum;

  const card = el('div', { class: 'bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('div', { class: 'text-xs uppercase tracking-wider opacity-90 font-semibold' }, 'Active Shift'),
      el('div', { class: 'text-lg font-bold' }, shift.shift_name || 'Untitled Shift'),
      el('div', { class: 'text-xs opacity-90 mt-0.5' }, 'Opened ' + new Date(shift.opened_at).toLocaleString('en-IN')),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', { class: 'px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-medium', onclick: () => openAddMovementModal(root, shift) }, '+ Add Movement'),
      el('button', { class: 'px-4 py-2 rounded-lg bg-white text-emerald-700 hover:bg-emerald-50 text-sm font-bold shadow', onclick: () => openCloseShiftModal(root, shift, totals, movements, expected) }, 'Close Shift'),
    ]),
  ]));

  const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-5 gap-px bg-slate-200' });
  grid.appendChild(statBox('Opening Float', fmtMoney(shift.opening_balance), 'text-slate-700'));
  grid.appendChild(statBox('Cash Sales', fmtMoney(totals.cash), 'text-emerald-600'));
  grid.appendChild(statBox('Digital Sales', fmtMoney(totals.card + totals.upi + totals.wallet + totals.other), 'text-indigo-600'));
  grid.appendChild(statBox('Tips Collected', fmtMoney(totals.tips || 0), 'text-purple-600'));
  grid.appendChild(statBox('Total Sales', fmtMoney(totals.total), 'text-slate-900', `${totals.count} transactions`));
  card.appendChild(grid);

  const cashRow = el('div', { class: 'p-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200' });
  cashRow.appendChild(kvBlock('Expected in Drawer', fmtMoney(expected), 'text-xl font-bold text-slate-900', 'opening + cash in - cash out'));
  
  cashRow.appendChild(kvBlock('Cash In', '+' + fmtMoney(inSum), 'text-lg font-semibold text-emerald-600'));
  cashRow.appendChild(kvBlock('Cash Out', '−' + fmtMoney(outSum), 'text-lg font-semibold text-red-600'));
  card.appendChild(cashRow);
  return card;
}

function statBox(label, value, valueCls = 'text-slate-800', sub = '') {
  return el('div', { class: 'bg-white p-4' }, [
    el('div', { class: 'text-xs uppercase tracking-wide text-slate-500 font-semibold' }, label),
    el('div', { class: `text-xl md:text-2xl font-bold mt-1 ${valueCls}` }, value),
    sub ? el('div', { class: 'text-[10px] text-slate-400 mt-0.5' }, sub) : null,
  ].filter(Boolean));
}

function kvBlock(label, value, valueCls = 'text-slate-800', sub = '') {
  return el('div', {}, [
    el('div', { class: 'text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1' }, label),
    el('div', { class: valueCls }, value),
    sub ? el('div', { class: 'text-[10px] text-slate-400 mt-1' }, sub) : null,
  ].filter(Boolean));
}

async function renderMovementsPanel(root, shift) {
  const movements = await fetchMovements(shift.id);
  const card = el('div', { class: 'bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800' }, 'Cash Movements'),
    el('span', { class: 'text-xs text-slate-500' }, `${movements.length} entr${movements.length === 1 ? 'y' : 'ies'}`),
  ]));

  if (!movements.length) {
    card.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No movements yet'));
    return card;
  }

  const tbody = el('tbody');
  movements.forEach(m => {
    const isIn = ['cash_in', 'sale', 'tip_in'].includes(m.movement_type);
    
    let label = m.movement_type.replace('_', ' ').toUpperCase();
    if (m.movement_type === 'sale') label = 'BILL SALE';
    if (m.movement_type === 'tip_in') label = 'TIP COLLECTED';
    if (m.movement_type === 'tip_payout') label = 'TIP PAYOUT';

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-2 text-slate-500 text-xs whitespace-nowrap' },
        new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })),
      el('td', { class: 'px-5 py-2' }, [
        el('span', { class: `text-xs px-2 py-0.5 rounded-full font-semibold ${isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}` },
          label),
      ]),
      el('td', { class: 'px-5 py-2 text-slate-600 truncate max-w-[200px]' }, m.reason || '—'),
      el('td', { class: `px-5 py-2 text-right font-semibold ${isIn ? 'text-emerald-600' : 'text-red-600'}` },
        (isIn ? '+' : '−') + fmtMoney(m.amount)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-xs uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Time'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Type'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Reason'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Amount'),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

function labelForMovement(t) {
  return { cash_in: 'Cash In', cash_out: 'Cash Out', petty_expense: 'Petty Expense', bank_deposit: 'Bank Deposit', tip_payout: 'Tip Payout' }[t] || t;
}

async function renderHistoryPanel() {
  const shifts = await fetchRecentShifts(10);
  const card = el('div', { class: 'bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800' }, 'Recent Closed Shifts'),
    el('span', { class: 'text-xs text-slate-500' }, `Last ${shifts.length}`),
  ]));

  if (!shifts.length) {
    card.appendChild(el('div', { class: 'p-6 text-center text-slate-400 text-sm' }, 'No closed shifts'));
    return card;
  }

  const tbody = el('tbody');
  shifts.forEach(s => {
    const diff = Number(s.cash_difference || 0);
    const diffCls = Math.abs(diff) < 0.01 ? 'text-slate-500' : diff > 0 ? 'text-emerald-600' : 'text-red-600';
    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-2 text-slate-500 text-xs whitespace-nowrap' },
        s.closed_at ? new Date(s.closed_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'),
      el('td', { class: 'px-5 py-2 font-medium text-slate-700' }, s.shift_name || '—'),
      el('td', { class: 'px-5 py-2 text-right text-slate-700' }, fmtMoney(s.total_sales)),
      el('td', { class: 'px-5 py-2 text-right text-slate-500' }, fmtMoney(s.expected_cash)),
      el('td', { class: 'px-5 py-2 text-right text-slate-700' }, fmtMoney(s.counted_cash)),
      el('td', { class: `px-5 py-2 text-right font-semibold ${diffCls}` }, (diff > 0 ? '+' : '') + fmtMoney(diff)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full text-sm' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-xs uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Closed'),
        el('th', { class: 'text-left px-5 py-2 font-semibold' }, 'Shift'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Sales'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Expected'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Counted'),
        el('th', { class: 'text-right px-5 py-2 font-semibold' }, 'Variance'),
      ]),
    ]),
    tbody,
  ]));
  return card;
}

function openAddMovementModal(root, shift) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Add Cash Movement'));

  const typeIn = el('select', { class: inputCls }, [
    el('option', { value: 'cash_in' }, 'Cash In (deposit to drawer)'),
    el('option', { value: 'cash_out' }, 'Cash Out (withdraw from drawer)'),
    el('option', { value: 'petty_expense' }, 'Petty Expense'),
    el('option', { value: 'bank_deposit' }, 'Bank Deposit'),
    el('option', { value: 'tip_payout' }, 'Tip Payout to Staff'),
  ]);
  const amountIn = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Amount (₹)', class: inputCls });
  const reasonIn = el('input', { type: 'text', placeholder: 'Reason / reference', class: inputCls });

  const btnRow = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const amount = Number(amountIn.value || 0);
        if (!amount || amount <= 0) { toast('Enter a valid amount', 'warn'); return; }
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Saving…';
        try {
          await addCashMovement({ type: typeIn.value, amount, reason: reasonIn.value.trim() });
          toast('Movement recorded', 'success');
          overlay.remove();
          await renderCash(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Save';
        }
      },
    }, 'Save'),
  ]);

  card.appendChild(typeIn); card.appendChild(amountIn); card.appendChild(reasonIn); card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => amountIn.focus(), 50);
}

function openCloseShiftModal(root, shift, totals, movements, expected) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Close Shift'),
    el('p', { class: 'text-xs text-slate-500 mt-0.5' }, shift.shift_name || 'Current shift'),
  ]));

  card.appendChild(el('div', { class: 'grid grid-cols-3 divide-x divide-slate-200 bg-slate-50 border-b border-slate-200' }, [
    el('div', { class: 'p-3 text-center' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Total Sales'),
      el('div', { class: 'text-base font-bold text-slate-800 mt-0.5' }, fmtMoney(totals.total)),
    ]),
    el('div', { class: 'p-3 text-center' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Cash Sales'),
      el('div', { class: 'text-base font-bold text-emerald-600 mt-0.5' }, fmtMoney(totals.cash)),
    ]),
    el('div', { class: 'p-3 text-center' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Expected Drawer'),
      el('div', { class: 'text-base font-bold text-indigo-600 mt-0.5' }, fmtMoney(expected)),
    ]),
  ]));

  const denoms = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  const qty = {};
  const denomWrap = el('div', { class: 'p-5 space-y-2' });
  denomWrap.appendChild(el('div', { class: 'text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2' }, 'Cash Counted (by denomination)'));

  denoms.forEach(d => {
    qty[d] = 0;
    const inp = el('input', {
      type: 'number', min: '0', step: '1', value: '0',
      class: 'w-24 px-2 py-1.5 rounded border border-slate-300 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500',
      oninput: (e) => { qty[d] = Number(e.target.value || 0); updateCounted(); },
    });
    denomWrap.appendChild(el('div', { class: 'flex items-center justify-between' }, [
      el('div', { class: 'text-sm text-slate-700 w-24' }, `₹ ${d}`),
      el('div', { class: 'text-xs text-slate-400' }, '×'),
      inp,
      el('div', { class: 'text-sm text-slate-500 w-20 text-right', 'data-subtotal': d }, '₹ 0.00'),
    ]));
  });

  const countedDisplay = el('div', { class: 'text-2xl font-bold text-slate-900' }, '₹ 0.00');
  const varianceDisplay = el('div', { class: 'text-lg font-bold text-slate-400' }, '—');
  const varianceBox = el('div', { class: 'flex justify-between items-center px-4 py-3 rounded-lg bg-slate-50 border border-slate-200' }, [
    el('div', {}, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Counted Total'),
      countedDisplay,
    ]),
    el('div', { class: 'text-right' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Variance'),
      varianceDisplay,
    ]),
  ]);

  const notesIn = el('input', { type: 'text', placeholder: 'Close notes (optional)', class: inputCls });

  card.appendChild(denomWrap);
  card.appendChild(el('div', { class: 'px-5 pb-3 space-y-3' }, [varianceBox, notesIn]));

  const actions = el('div', { class: 'grid grid-cols-2 gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl' }, [
    el('button', { class: 'py-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', { id: 'btn-do-close', class: 'py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow' }, 'Confirm Close'),
  ]);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function updateCounted() {
    let counted = 0;
    denoms.forEach(d => {
      const sub = d * (qty[d] || 0);
      counted += sub;
      const el2 = denomWrap.querySelector(`[data-subtotal="${d}"]`);
      if (el2) el2.textContent = fmtMoney(sub);
    });
    countedDisplay.textContent = fmtMoney(counted);
    const diff = counted - expected;
    if (Math.abs(diff) < 0.01) {
      varianceDisplay.textContent = 'Balanced ✓';
      varianceDisplay.className = 'text-lg font-bold text-emerald-600';
    } else if (diff > 0) {
      varianceDisplay.textContent = '+' + fmtMoney(diff) + ' (over)';
      varianceDisplay.className = 'text-lg font-bold text-amber-600';
    } else {
      varianceDisplay.textContent = fmtMoney(diff) + ' (short)';
      varianceDisplay.className = 'text-lg font-bold text-red-600';
    }
  }

  actions.querySelector('#btn-do-close').addEventListener('click', async (e) => {
    let counted = 0;
    denoms.forEach(d => { counted += d * (qty[d] || 0); });
    if (counted === 0) { if (!confirm('Counted cash is ₹0. Is that correct?')) return; }
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Closing…';
    try {
      const result = await closeShift({ countedCash: counted, notes: notesIn.value.trim() });
      overlay.remove();
      showCloseReceipt(root, result);
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      e.currentTarget.disabled = false;
      e.currentTarget.textContent = 'Confirm Close';
    }
  });
}

function showCloseReceipt(root, result) {
  const { shift, totals, expected, difference, movements } = result;
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 text-center' }, [
    el('div', { class: 'text-3xl mb-1' }, difference === 0 ? '✅' : (difference > 0 ? '🟡' : '⚠️')),
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Shift Closed'),
    el('p', { class: 'text-xs text-slate-500 mt-0.5' }, shift.shift_name || 'Shift'),
  ]));

  const body = el('div', { class: 'p-5 space-y-3 text-sm' });
  const row = (label, value, cls = 'text-slate-800') =>
    el('div', { class: 'flex justify-between' }, [
      el('span', { class: 'text-slate-500' }, label),
      el('span', { class: `font-medium ${cls}` }, value),
    ]);

  body.appendChild(row('Opening Float', fmtMoney(shift.opening_balance)));
  body.appendChild(row('Cash Sales', fmtMoney(totals.cash), 'text-emerald-600'));
  body.appendChild(row('Card Sales', fmtMoney(totals.card)));
  body.appendChild(row('UPI Sales', fmtMoney(totals.upi)));
  body.appendChild(row('Wallet Sales', fmtMoney(totals.wallet)));
  body.appendChild(row('Other', fmtMoney(totals.other)));
  body.appendChild(el('div', { class: 'border-t border-dashed border-slate-300 my-2' }));
  body.appendChild(row('Total Sales', fmtMoney(totals.total), 'text-base font-bold text-slate-900'));
  body.appendChild(row('Transactions', totals.count));
  body.appendChild(el('div', { class: 'border-t border-dashed border-slate-300 my-2' }));
  body.appendChild(row('Expected Drawer', fmtMoney(expected), 'text-indigo-600'));
  body.appendChild(row('Counted Cash', fmtMoney(shift.counted_cash), 'text-slate-900'));
  body.appendChild(row('Variance',
    (difference > 0 ? '+' : '') + fmtMoney(difference),
    Math.abs(difference) < 0.01 ? 'text-emerald-600' : difference > 0 ? 'text-amber-600' : 'text-red-600'));
  body.appendChild(el('div', { class: 'border-t border-dashed border-slate-300 my-2' }));
  body.appendChild(row('Movements', movements.length));

  card.appendChild(body);

  const actions = el('div', { class: 'grid grid-cols-2 gap-2 p-5 pt-0' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium', onclick: () => printCloseReceipt(result) }, 'Print'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-semibold',
      onclick: async () => { overlay.remove(); await renderCash(root); },
    }, 'Done'),
  ]);
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function printCloseReceipt(result) {
  const { shift, totals, expected, difference, movements } = result;
  const W = 48;
  const pad = (l, r) => { l = String(l); r = String(r); return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r; };
  const hr = (c = '-') => c.repeat(W);

  const lines = [
    'SHIFT CLOSE REPORT',
    shift.shift_name || '',
    'Closed: ' + new Date(shift.closed_at).toLocaleString('en-IN'),
    hr('='),
    pad('Opening Float', Number(shift.opening_balance).toFixed(2)),
    pad('Cash Sales', Number(totals.cash).toFixed(2)),
    pad('Card Sales', Number(totals.card).toFixed(2)),
    pad('UPI Sales', Number(totals.upi).toFixed(2)),
    pad('Wallet Sales', Number(totals.wallet).toFixed(2)),
    pad('Other', Number(totals.other).toFixed(2)),
    hr('-'),
    pad('TOTAL SALES', Number(totals.total).toFixed(2)),
    pad('Transactions', totals.count),
    hr('='),
    pad('Expected Drawer', Number(expected).toFixed(2)),
    pad('Counted Cash', Number(shift.counted_cash).toFixed(2)),
    pad('Variance', (difference > 0 ? '+' : '') + Number(difference).toFixed(2)),
    hr('-'),
    pad('Movements', movements.length),
    '',
    'Signature: ______________________',
  ];

  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => toast('Shift report copied to clipboard', 'success'));
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
