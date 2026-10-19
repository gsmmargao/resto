import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';

const state = { tipsIn: [], payouts: [], loaded: false };

export async function renderTipsAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading tips…'));

  try {
    if (!state.loaded) await loadTips();
    paint(root);
  } catch (err) {
    console.error('[tips-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadTips() {
  const tenantId = store.state.tenant.id;
  const outletId = store.state.outlet.id;

  const [tipsInRes, payoutsRes] = await Promise.all([
    supabase.from('payments')
      .select(`id, amount, tip_amount, mode, reference_no, paid_at, orders ( order_number, table_name_snapshot )`)
      .eq('outlet_id', outletId).eq('status', 'success').gt('tip_amount', 0).order('paid_at', { ascending: false }),
    supabase.from('tip_payouts')
      .select(`*`)
      .eq('tenant_id', tenantId).eq('outlet_id', outletId).order('created_at', { ascending: false })
  ]);

  state.tipsIn = tipsInRes.data || [];
  state.payouts = payoutsRes.data || [];
  state.loaded = true;
}

async function refresh() { state.loaded = false; await loadTips(); }

function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Tips Ledger'),
      el('p', { class: 'text-xs text-slate-500' }, 'Manage collected tips and staff payouts.'),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm',
        onclick: () => openRecordTipModal(root),
      }, '+ Record Tip'),
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold shadow-sm',
        onclick: () => openPayoutModal(root, availableBalance),
      }, '- Pay Out Tip'),
    ]),
  ]);

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-5xl mx-auto space-y-4' });
  body.appendChild(inner);
  wrap.appendChild(header);
  wrap.appendChild(body);
  root.appendChild(wrap);

  // Calculate Balances
  const totalTipsIn = state.tipsIn.reduce((sum, t) => sum + Number(t.tip_amount), 0);
  const totalPayouts = state.payouts.reduce((sum, p) => sum + Number(p.amount), 0);
  const availableBalance = totalTipsIn - totalPayouts;

  const cashIn = state.tipsIn.filter(t => t.mode === 'cash').reduce((s, t) => s + Number(t.tip_amount), 0);
  const upiIn = state.tipsIn.filter(t => t.mode === 'upi').reduce((s, t) => s + Number(t.tip_amount), 0);
  const cardIn = state.tipsIn.filter(t => t.mode === 'card').reduce((s, t) => s + Number(t.tip_amount), 0);
  
  const cashOut = state.payouts.filter(p => p.payment_mode === 'cash').reduce((s, p) => s + Number(p.amount), 0);
  const upiOut = state.payouts.filter(p => ['upi', 'card', 'bank'].includes(p.payment_mode)).reduce((s, p) => s + Number(p.amount), 0);

  // Summary KPIs
  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3' });
  summary.appendChild(kpi('Available Tip Pool', fmtMoney(availableBalance), 'from-pink-500 to-rose-500', `${fmtMoney(totalTipsIn)} collected - ${fmtMoney(totalPayouts)} paid out`));
  summary.appendChild(kpi('Cash Tips In', fmtMoney(cashIn), 'from-emerald-500 to-emerald-600', `Payouts out: ${fmtMoney(cashOut)}`));
  summary.appendChild(kpi('UPI Tips In', fmtMoney(upiIn), 'from-purple-500 to-purple-600', `Payouts out: ${fmtMoney(upiOut)}`));
  summary.appendChild(kpi('Card Tips In', fmtMoney(cardIn), 'from-indigo-500 to-indigo-600', ''));
  inner.appendChild(summary);

  // Combined Ledger
  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Tips History'),
    el('span', { class: 'text-xs text-slate-500' }, `${state.tipsIn.length + state.payouts.length} entries`),
  ]));

  const ledger = [];
  state.tipsIn.forEach(t => ledger.push({ 
    type: 'in', 
    date: t.paid_at, 
    mode: t.mode, 
    amount: Number(t.tip_amount), 
    desc: t.amount === 0 ? t.reference_no : `Order #${t.orders?.order_number || '—'}` 
  }));
  state.payouts.forEach(p => ledger.push({ 
    type: 'out', 
    date: p.created_at, 
    mode: p.payment_mode, 
    amount: Number(p.amount), 
    desc: `Paid to ${p.staff_name || 'Staff'}` 
  }));
  ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!ledger.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No tips recorded yet'));
    inner.appendChild(card);
    return;
  }

  const tbody = el('tbody');
  ledger.forEach(l => {
    const time = new Date(l.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    const isIn = l.type === 'in';

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-5 py-3 text-xs text-slate-500 whitespace-nowrap' }, time),
      el('td', { class: 'px-5 py-3 text-sm font-medium text-slate-800' }, l.desc),
      el('td', { class: 'px-5 py-3 text-center' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
          l.mode === 'cash' ? 'bg-emerald-100 text-emerald-700' :
          l.mode === 'upi' ? 'bg-purple-100 text-purple-700' :
          'bg-indigo-100 text-indigo-700'
        }` }, l.mode)
      ]),
      el('td', { class: 'px-5 py-3 text-center' }, [
        el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${isIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}` }, isIn ? 'IN' : 'OUT')
      ]),
      el('td', { class: `px-5 py-3 text-right text-sm font-bold ${isIn ? 'text-emerald-600' : 'text-red-600'}` }, (isIn ? '+' : '-') + fmtMoney(l.amount)),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-5 py-2.5 font-semibold' }, 'Time'),
        el('th', { class: 'text-left px-5 py-2.5 font-semibold' }, 'Description'),
        el('th', { class: 'text-center px-5 py-2.5 font-semibold' }, 'Mode'),
        el('th', { class: 'text-center px-5 py-2.5 font-semibold' }, 'Type'),
        el('th', { class: 'text-right px-5 py-2.5 font-semibold' }, 'Amount'),
      ]),
    ]),
    tbody,
  ]));
  inner.appendChild(card);
}

function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

// ============================================================
// RECORD MANUAL TIP IN
// ============================================================
function openRecordTipModal(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Record Manual Tip'));
  const amtIn = el('input', { type: 'number', step: '1', placeholder: 'Tip Amount (₹)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500' });
  const modeIn = el('select', { class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500' }, [
    el('option', { value: 'cash' }, 'Cash'), el('option', { value: 'upi' }, 'UPI'), el('option', { value: 'card' }, 'Card')
  ]);
  const notesIn = el('input', { type: 'text', placeholder: 'Notes', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm' });

  card.appendChild(amtIn); card.appendChild(modeIn); card.appendChild(notesIn);

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amtIn.value);
        if (!amount || amount <= 0) { toast('Enter valid amount', 'warn'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await supabase.from('payments').insert({
            tenant_id: store.state.tenant.id, outlet_id: store.state.outlet.id,
            mode: modeIn.value, amount: 0, tip_amount: amount,
            reference_no: notesIn.value.trim() || 'Manual Tip', status: 'success',
            received_by: store.state.member?.id || null, paid_at: new Date().toISOString()
          });
          toast('Tip recorded!', 'success'); overlay.remove(); await refresh(); paint(root);
        } catch (err) { toast('Failed: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Save Tip'; }
      },
    }, 'Save Tip'),
  ]);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// PAY OUT TIPS TO STAFF
// ============================================================
function openPayoutModal(root, maxAvailable) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Pay Out Tips'));
  card.appendChild(el('p', { class: 'text-xs text-slate-500' }, `Available Tip Pool: ${fmtMoney(maxAvailable)}`));

  const amtIn = el('input', { type: 'number', step: '1', placeholder: 'Amount to Pay (₹)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm' });
  const staffIn = el('input', { type: 'text', placeholder: 'Staff Name (e.g. John)', class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm' });
  const modeIn = el('select', { class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm' }, [
    el('option', { value: 'cash' }, 'Cash'), el('option', { value: 'upi' }, 'UPI'), el('option', { value: 'card' }, 'Card')
  ]);

  card.appendChild(el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, 'Amount *'));
  card.appendChild(amtIn);
  card.appendChild(el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, 'Staff Name *'));
  card.appendChild(staffIn);
  card.appendChild(el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, 'Payment Mode *'));
  card.appendChild(modeIn);

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amtIn.value);
        const staff = staffIn.value.trim();
        if (!amount || amount <= 0) { toast('Enter valid amount', 'warn'); return; }
        if (!staff) { toast('Enter staff name', 'warn'); return; }
        if (amount > maxAvailable) { toast('Cannot pay more than available pool', 'warn'); return; }

        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          // 1. Record in tip_payouts
          const { error } = await supabase.from('tip_payouts').insert({
            tenant_id: store.state.tenant.id, outlet_id: store.state.outlet.id,
            amount: amount, payment_mode: modeIn.value, staff_name: staff,
            created_by: store.state.session?.user?.id || null
          });
          if (error) throw error;

          // 2. If Cash, also deduct from the Cash Drawer
          if (modeIn.value === 'cash') {
            const shift = store.state.cashRegister;
            if (shift) {
              await supabase.from('cash_movements').insert({
                tenant_id: store.state.tenant.id,
                outlet_id: store.state.outlet.id,
                cash_register_id: shift.id,
                movement_type: 'tip_payout',
                amount: amount,
                reason: `Tip payout to ${staff}`,
                created_by: store.state.session?.user?.id || null
              });
            }
          }
          toast('Payout recorded!', 'success'); overlay.remove(); await refresh(); paint(root);
        } catch (err) { toast('Failed: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Pay Out'; }
      },
    }, 'Confirm Payout'),
  ]);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
