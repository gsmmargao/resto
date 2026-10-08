import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast, confirmDialog } from '../../utils.js';

const state = {
  tab: 'customers',
  customers: [],
  program: null,
  giftCards: [],
  search: '',
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderLoyaltyAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading loyalty data…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[loyalty-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const tenantId = store.state.tenant.id;

  const [custRes, progRes, gcRes] = await Promise.all([
    supabase.from('customers')
      .select('id, phone, name, email, loyalty_points, wallet_balance, total_orders, total_spend, last_visit_at, rfm_segment, created_at')
      .eq('tenant_id', tenantId)
      .order('last_visit_at', { ascending: false, nullsFirst: false })
      .limit(500),
    supabase.from('loyalty_programs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase.from('gift_cards')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);

  state.customers = custRes.data || [];
  state.program   = progRes.data || null;
  state.giftCards = gcRes.data || [];

  console.log('[loyalty] loaded', {
    customers: state.customers.length,
    hasProgram: !!state.program,
    giftCards: state.giftCards.length,
  });

  state.loaded = true;
}

async function refresh() { state.loaded = false; await loadAll(); }

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  const header = el('div', { class: 'bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-wrap gap-3' }, [
    el('div', {}, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'Loyalty & Wallet'),
      el('p', { class: 'text-xs text-slate-500' },
        `${state.customers.length} customers · ${state.giftCards.length} gift cards`),
    ]),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
        onclick: async () => { await refresh(); paint(root); toast('Refreshed', 'success', 1000); },
      }, 'Refresh'),
    ]),
  ]);

  const tabs = el('div', { class: 'bg-white border-b border-slate-200 px-4 flex gap-1 overflow-x-auto' },
    [['customers', 'Customers'], ['giftcards', 'Gift Cards'], ['program', 'Program']]
      .map(([key, label]) =>
        el('button', {
          class: `px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${state.tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`,
          onclick: () => { state.tab = key; paint(root); },
        }, label)));

  const body = el('div', { class: 'flex-1 overflow-y-auto p-4 md:p-6' });
  const inner = el('div', { class: 'max-w-7xl mx-auto space-y-4' });
  body.appendChild(inner);

  wrap.appendChild(header);
  wrap.appendChild(tabs);
  wrap.appendChild(body);
  root.appendChild(wrap);

  if (state.tab === 'customers')  inner.appendChild(renderCustomersTab(root));
  if (state.tab === 'giftcards')  inner.appendChild(renderGiftCardsTab(root));
  if (state.tab === 'program')    inner.appendChild(renderProgramTab(root));
}

// ============================================================
// TAB — CUSTOMERS
// ============================================================
function renderCustomersTab(root) {
  const wrap = el('div', { class: 'space-y-4' });

  // Summary
  const activeCustomers = state.customers.filter(c => c.total_orders > 0);
  const withPoints      = state.customers.filter(c => Number(c.loyalty_points) > 0);
  const withWallet      = state.customers.filter(c => Number(c.wallet_balance) > 0);
  const totalPoints     = state.customers.reduce((s, c) => s + Number(c.loyalty_points || 0), 0);
  const totalWallet     = state.customers.reduce((s, c) => s + Number(c.wallet_balance || 0), 0);

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3' });
  summary.appendChild(kpi('Total Customers', String(state.customers.length), 'from-slate-600 to-slate-700', `${activeCustomers.length} active`));
  summary.appendChild(kpi('Points Outstanding', totalPoints.toFixed(0), 'from-indigo-500 to-indigo-600', `${withPoints.length} holders`));
  summary.appendChild(kpi('Wallet Balance', fmtMoney(totalWallet), 'from-emerald-500 to-emerald-600', `${withWallet.length} holders`));
  summary.appendChild(kpi('Avg Spend', fmtMoney(
    activeCustomers.length
      ? activeCustomers.reduce((s, c) => s + Number(c.total_spend || 0), 0) / activeCustomers.length
      : 0
  ), 'from-amber-500 to-orange-500', 'Across active customers'));
  wrap.appendChild(summary);

  // Filters
  const filterBar = el('div', { class: 'bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center' });
  filterBar.appendChild(el('input', {
    type: 'search', placeholder: 'Search name / phone / email…', value: state.search,
    class: 'flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { state.search = e.target.value.toLowerCase(); paint(root); },
  }));
  wrap.appendChild(filterBar);

  // Table
  const filtered = state.customers.filter(c => {
    if (!state.search) return true;
    const hay = `${c.name || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
    return hay.includes(state.search);
  });

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `${filtered.length} customer${filtered.length !== 1 ? 's' : ''}`),
  ]));

  if (!filtered.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No customers match'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  filtered.slice(0, 200).forEach(c => tbody.appendChild(buildCustomerRow(c, root)));

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Customer'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold hidden md:table-cell' }, 'Segment'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Orders'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Spend'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Points'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Wallet'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold w-24' }, ''),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);
  return wrap;
}

function buildCustomerRow(c, root) {
  const initial = (c.name || c.phone || '?').charAt(0).toUpperCase();
  const points = Number(c.loyalty_points || 0);
  const wallet = Number(c.wallet_balance || 0);

  const segmentColors = {
    champion:    'bg-purple-100 text-purple-700',
    loyal:       'bg-emerald-100 text-emerald-700',
    at_risk:     'bg-amber-100 text-amber-700',
    new:         'bg-sky-100 text-sky-700',
    hibernating: 'bg-slate-100 text-slate-600',
  };
  const segCls = segmentColors[c.rfm_segment] || 'bg-slate-100 text-slate-600';

  return el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50 cursor-pointer', onclick: () => openCustomerDetail(root, c) }, [
    el('td', { class: 'px-4 py-2.5' }, [
      el('div', { class: 'flex items-center gap-2.5' }, [
        el('div', { class: 'w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-xs font-bold flex items-center justify-center shrink-0' }, initial),
        el('div', { class: 'min-w-0' }, [
          el('div', { class: 'text-sm font-medium text-slate-800 truncate' }, c.name || '—'),
          el('div', { class: 'text-[11px] text-slate-500 truncate' }, c.phone || c.email || '—'),
        ]),
      ]),
    ]),
    el('td', { class: 'px-4 py-2.5 hidden md:table-cell' }, [
      c.rfm_segment ? el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${segCls}` }, c.rfm_segment.replace('_', ' ')) : el('span', { class: 'text-slate-400' }, '—'),
    ]),
    el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, String(c.total_orders || 0)),
    el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-700' }, fmtMoney(c.total_spend || 0)),
    el('td', { class: `px-4 py-2.5 text-right text-sm font-semibold ${points > 0 ? 'text-indigo-600' : 'text-slate-400'}` }, String(points)),
    el('td', { class: `px-4 py-2.5 text-right text-sm font-semibold ${wallet > 0 ? 'text-emerald-600' : 'text-slate-400'}` }, fmtMoney(wallet)),
    el('td', { class: 'px-4 py-2.5 text-right' }, [
      el('span', { class: 'text-xs text-indigo-600 font-medium' }, 'View →'),
    ]),
  ]);
}

// ============================================================
// CUSTOMER DETAIL MODAL
// ============================================================
async function openCustomerDetail(root, c) {
  // Fetch transaction history
  const [lp, wp] = await Promise.all([
    supabase.from('loyalty_transactions').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('wallet_transactions').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const loyaltyTx = lp.data || [];
  const walletTx  = wp.data || [];

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8' });

  // Header
  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', { class: 'min-w-0' }, [
      el('h3', { class: 'font-bold text-lg text-slate-800 truncate' }, c.name || c.phone),
      el('p', { class: 'text-xs text-slate-500 truncate' }, `${c.phone || '—'} · ${c.email || 'no email'}`),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none shrink-0', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-5' });

  // Balance cards
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', { class: 'rounded-xl border border-indigo-200 bg-indigo-50 p-4' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide font-semibold text-indigo-600' }, 'Loyalty Points'),
      el('div', { class: 'text-3xl font-bold text-indigo-700 mt-1' }, String(Number(c.loyalty_points || 0))),
      el('div', { class: 'text-[11px] text-indigo-500 mt-1' },
        state.program ? `Worth ~${fmtMoney(Number(c.loyalty_points || 0) * Number(state.program.redeem_value || 1))}` : ''),
    ]),
    el('div', { class: 'rounded-xl border border-emerald-200 bg-emerald-50 p-4' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide font-semibold text-emerald-600' }, 'Wallet Balance'),
      el('div', { class: 'text-3xl font-bold text-emerald-700 mt-1' }, fmtMoney(c.wallet_balance || 0)),
      el('div', { class: 'text-[11px] text-emerald-500 mt-1' },
        `${c.total_orders || 0} orders · ${fmtMoney(c.total_spend || 0)} lifetime`),
    ]),
  ]));

  // Manual adjustments
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-4 pt-2 border-t border-slate-100' }, [
    buildPointsAdjuster(root, c, overlay),
    buildWalletAdjuster(root, c, overlay),
  ]));

  // History
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-4 pt-2 border-t border-slate-100' }, [
    buildHistory('Loyalty History', loyaltyTx, (t) => ({
      label: t.type,
      amount: `${t.points > 0 ? '+' : ''}${t.points} pts`,
      cls: t.points > 0 ? 'text-emerald-600' : 'text-red-600',
      when: t.created_at,
      notes: t.notes,
    })),
    buildHistory('Wallet History', walletTx, (t) => ({
      label: t.type,
      amount: `${t.amount > 0 ? '+' : ''}${fmtMoney(t.amount)}`,
      cls: t.amount > 0 ? 'text-emerald-600' : 'text-red-600',
      when: t.created_at,
      notes: t.notes,
    })),
  ]));

  card.appendChild(body);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function buildPointsAdjuster(root, c, overlay) {
  const box = el('div', { class: 'space-y-2' });
  box.appendChild(el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide' }, 'Adjust Points'));

  const amountIn = el('input', {
    type: 'number', step: '1', placeholder: '+50 or -20',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });
  const reasonIn = el('input', {
    type: 'text', placeholder: 'Reason (e.g. "birthday bonus")',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });

  box.appendChild(el('div', { class: 'flex gap-1' }, [
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '50'; reasonIn.value = 'Bonus'; },
    }, '+50'),
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '100'; reasonIn.value = 'Bonus'; },
    }, '+100'),
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '-50'; reasonIn.value = 'Correction'; },
    }, '−50'),
  ]));
  box.appendChild(amountIn);
  box.appendChild(reasonIn);
  box.appendChild(el('button', {
    class: 'w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold',
    onclick: async (e) => {
      const btn = e.currentTarget;
      const val = Number(amountIn.value || 0);
      if (!val) { toast('Enter a points amount', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const { error } = await supabase.rpc('adjust_loyalty_points', {
          p_customer_id: c.id,
          p_points: val,
          p_type: val > 0 ? 'bonus' : 'adjust',
          p_notes: reasonIn.value.trim() || null,
        });
        if (error) throw error;
        toast('Points updated', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Apply';
      }
    },
  }, 'Apply'));
  return box;
}

function buildWalletAdjuster(root, c, overlay) {
  const box = el('div', { class: 'space-y-2' });
  box.appendChild(el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide' }, 'Adjust Wallet'));

  const amountIn = el('input', {
    type: 'number', step: '0.01', placeholder: '+500 or -200',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500',
  });
  const reasonIn = el('input', {
    type: 'text', placeholder: 'Reason (e.g. "cash top-up")',
    class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500',
  });

  box.appendChild(el('div', { class: 'flex gap-1' }, [
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '500'; reasonIn.value = 'Cash top-up'; },
    }, '+500'),
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '1000'; reasonIn.value = 'Cash top-up'; },
    }, '+1000'),
    el('button', {
      class: 'flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 font-medium text-slate-700',
      onclick: () => { amountIn.value = '-200'; reasonIn.value = 'Correction'; },
    }, '−200'),
  ]));
  box.appendChild(amountIn);
  box.appendChild(reasonIn);
  box.appendChild(el('button', {
    class: 'w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold',
    onclick: async (e) => {
      const btn = e.currentTarget;
      const val = Number(amountIn.value || 0);
      if (!val) { toast('Enter an amount', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const { error } = await supabase.rpc('adjust_wallet_balance', {
          p_customer_id: c.id,
          p_amount: val,
          p_type: val > 0 ? 'topup' : 'adjust',
          p_notes: reasonIn.value.trim() || null,
        });
        if (error) throw error;
        toast('Wallet updated', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Apply';
      }
    },
  }, 'Apply'));
  return box;
}

function buildHistory(title, rows, mapper) {
  const box = el('div', { class: 'space-y-2' });
  box.appendChild(el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide' }, title));

  if (!rows.length) {
    box.appendChild(el('div', { class: 'text-xs text-slate-400 italic py-3 text-center' }, 'No activity yet'));
    return box;
  }

  const list = el('div', { class: 'space-y-1 max-h-56 overflow-y-auto' });
  rows.forEach(t => {
    const m = mapper(t);
    list.appendChild(el('div', { class: 'flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-0' }, [
      el('div', { class: 'min-w-0' }, [
        el('div', { class: 'font-medium text-slate-700 capitalize truncate' }, m.label),
        el('div', { class: 'text-[10px] text-slate-400' }, new Date(m.when).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
        m.notes ? el('div', { class: 'text-[10px] text-slate-500 italic truncate' }, m.notes) : null,
      ].filter(Boolean)),
      el('div', { class: `font-semibold ${m.cls} shrink-0 ml-2` }, m.amount),
    ]));
  });
  box.appendChild(list);
  return box;
}

// ============================================================
// TAB — GIFT CARDS
// ============================================================
function renderGiftCardsTab(root) {
  const wrap = el('div', { class: 'space-y-4' });

  const active = state.giftCards.filter(g => g.is_active && Number(g.balance) > 0);
  const totalIssued = state.giftCards.reduce((s, g) => s + Number(g.initial_amount || 0), 0);
  const totalRemaining = state.giftCards.reduce((s, g) => s + Number(g.balance || 0), 0);
  const totalRedeemed = totalIssued - totalRemaining;

  const summary = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3' });
  summary.appendChild(kpi('Total Cards', String(state.giftCards.length), 'from-slate-600 to-slate-700', `${active.length} active`));
  summary.appendChild(kpi('Issued Value', fmtMoney(totalIssued), 'from-indigo-500 to-indigo-600', 'Original face value'));
  summary.appendChild(kpi('Redeemed', fmtMoney(totalRedeemed), 'from-amber-500 to-orange-500', 'Used so far'));
  summary.appendChild(kpi('Outstanding', fmtMoney(totalRemaining), 'from-emerald-500 to-emerald-600', 'Remaining balance'));
  wrap.appendChild(summary);

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, `Gift Cards (${state.giftCards.length})`),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold',
      onclick: () => openGiftCardIssue(root),
    }, '+ Issue Gift Card'),
  ]));

  if (!state.giftCards.length) {
    card.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No gift cards issued yet'));
    wrap.appendChild(card);
    return wrap;
  }

  const tbody = el('tbody');
  state.giftCards.forEach(g => {
    const balance = Number(g.balance || 0);
    const initial = Number(g.initial_amount || 0);
    const pct = initial > 0 ? (balance / initial) * 100 : 0;
    const expired = g.valid_to && new Date(g.valid_to) < new Date();
    const usable = g.is_active && !expired && balance > 0;

    tbody.appendChild(el('tr', { class: `border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${!usable ? 'opacity-60' : ''}`, onclick: () => openGiftCardDetail(root, g) }, [
      el('td', { class: 'px-4 py-2.5' }, [
        el('div', { class: 'font-mono text-sm text-slate-800 font-semibold tracking-wide' }, g.code),
        g.valid_to ? el('div', { class: 'text-[10px] text-slate-400' }, 'Valid until ' + new Date(g.valid_to).toLocaleDateString('en-IN')) : null,
      ].filter(Boolean)),
      el('td', { class: 'px-4 py-2.5 text-right text-sm text-slate-600' }, fmtMoney(initial)),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        el('div', { class: `text-sm font-semibold ${balance > 0 ? 'text-emerald-600' : 'text-slate-400'}` }, fmtMoney(balance)),
        el('div', { class: 'mt-1 w-20 ml-auto bg-slate-100 rounded-full h-1 overflow-hidden' }, [
          el('div', { class: `h-full ${usable ? 'bg-emerald-500' : 'bg-slate-400'}`, style: `width: ${pct}%` }),
        ]),
      ]),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        usable
          ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold' }, 'ACTIVE')
          : expired
            ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold' }, 'EXPIRED')
            : balance === 0
              ? el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold' }, 'USED')
              : el('span', { class: 'text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold' }, 'INACTIVE'),
      ]),
      el('td', { class: 'px-4 py-2.5 text-right' }, [
        el('span', { class: 'text-xs text-indigo-600 font-medium' }, 'View →'),
      ]),
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Code'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Face Value'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Balance'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Status'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));
  wrap.appendChild(card);
  return wrap;
}

function openGiftCardIssue(root) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4' });
  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Issue Gift Card'));

  const amountIn = el('input', {
    type: 'number', step: '100', min: 100, value: 1000,
    class: inputCls,
  });
  const validToIn = el('input', {
    type: 'date',
    value: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
    class: inputCls,
  });
  const notesIn = el('input', {
    type: 'text', placeholder: 'Notes (optional)', class: inputCls,
  });

  card.appendChild(field('Amount (₹) *', amountIn));
  card.appendChild(field('Valid until', validToIn));
  card.appendChild(field('Notes', notesIn));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', { class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm', onclick: () => overlay.remove() }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const amount = Number(amountIn.value || 0);
        if (amount <= 0) { toast('Enter a valid amount', 'warn'); return; }

        // Generate a code: RESTO-XXXX-XXXX
        const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
        const code = `RESTO-${part()}-${part()}`;

        btn.disabled = true; btn.textContent = 'Issuing…';
        try {
          const { data, error } = await supabase.from('gift_cards').insert({
            tenant_id: store.state.tenant.id,
            code,
            initial_amount: amount,
            balance: amount,
            currency: 'INR',
            valid_from: new Date().toISOString().slice(0, 10),
            valid_to: validToIn.value || null,
            is_active: true,
          }).select().single();
          if (error) throw error;

          await supabase.from('gift_card_transactions').insert({
            tenant_id: store.state.tenant.id,
            gift_card_id: data.id,
            amount,
            type: 'issue',
            balance_after: amount,
          });

          toast(`Issued: ${code}`, 'success', 5000);
          overlay.remove();
          await refresh();
          paint(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Issue';
        }
      },
    }, 'Issue'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => amountIn.focus(), 50);
}

async function openGiftCardDetail(root, g) {
  const { data: tx } = await supabase.from('gift_card_transactions')
    .select('*').eq('gift_card_id', g.id)
    .order('created_at', { ascending: false });

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold' }, 'Gift Card'),
      el('h3', { class: 'font-mono font-bold text-lg text-slate-800 tracking-wide' }, g.code),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-4' });

  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    el('div', { class: 'rounded-xl border border-emerald-200 bg-emerald-50 p-4' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide font-semibold text-emerald-600' }, 'Balance'),
      el('div', { class: 'text-2xl font-bold text-emerald-700 mt-1' }, fmtMoney(g.balance)),
    ]),
    el('div', { class: 'rounded-xl border border-slate-200 bg-slate-50 p-4' }, [
      el('div', { class: 'text-[10px] uppercase tracking-wide font-semibold text-slate-500' }, 'Face Value'),
      el('div', { class: 'text-2xl font-bold text-slate-700 mt-1' }, fmtMoney(g.initial_amount)),
    ]),
  ]));

  // Meta
  body.appendChild(el('div', { class: 'text-xs text-slate-600 space-y-1.5 bg-slate-50 rounded-lg p-3' }, [
    el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-500' }, 'Status'), el('span', { class: `font-medium ${g.is_active ? 'text-emerald-600' : 'text-slate-500'}` }, g.is_active ? 'Active' : 'Inactive')]),
    g.valid_from ? el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-500' }, 'Valid from'), el('span', { class: 'font-medium' }, new Date(g.valid_from).toLocaleDateString('en-IN'))]) : null,
    g.valid_to ? el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-500' }, 'Valid until'), el('span', { class: 'font-medium' }, new Date(g.valid_to).toLocaleDateString('en-IN'))]) : null,
    el('div', { class: 'flex justify-between' }, [el('span', { class: 'text-slate-500' }, 'Issued'), el('span', { class: 'font-medium' }, new Date(g.created_at).toLocaleDateString('en-IN'))]),
  ].filter(Boolean)));

  // History
  body.appendChild(el('div', {}, [
    el('div', { class: 'text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2' }, 'Transaction History'),
    tx && tx.length
      ? el('div', { class: 'space-y-1 max-h-52 overflow-y-auto' }, tx.map(t => {
          const isCredit = t.amount > 0;
          return el('div', { class: 'flex items-center justify-between text-xs py-2 border-b border-slate-100 last:border-0' }, [
            el('div', { class: 'min-w-0' }, [
              el('div', { class: 'font-medium text-slate-700 capitalize' }, t.type),
              el('div', { class: 'text-[10px] text-slate-400' }, new Date(t.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
            ]),
            el('div', { class: `font-semibold ${isCredit ? 'text-emerald-600' : 'text-red-600'}` }, `${isCredit ? '+' : ''}${fmtMoney(t.amount)}`),
          ]);
        }))
      : el('div', { class: 'text-xs text-slate-400 italic py-3 text-center' }, 'No transactions yet'),
  ]));

  card.appendChild(body);

  // Actions
  const actions = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    el('button', {
      class: `px-3 py-2 rounded-lg text-xs font-medium ${g.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}`,
      onclick: async () => {
        const ok = await confirmDialog(
          g.is_active ? 'Deactivate this gift card? It cannot be used at checkout.' : 'Reactivate this gift card?',
          g.is_active ? 'Deactivate?' : 'Reactivate?',
        );
        if (!ok) return;
        const { error } = await supabase.from('gift_cards').update({ is_active: !g.is_active }).eq('id', g.id);
        if (error) { toast('Failed: ' + error.message, 'error'); return; }
        toast(g.is_active ? 'Deactivated' : 'Reactivated', 'success');
        overlay.remove();
        await refresh();
        paint(root);
      },
    }, g.is_active ? 'Deactivate' : 'Reactivate'),
    el('button', {
      class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
      onclick: () => overlay.remove(),
    }, 'Close'),
  ]);
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// TAB — PROGRAM SETTINGS
// ============================================================
function renderProgramTab(root) {
  const wrap = el('div', { class: 'max-w-2xl mx-auto space-y-4' });

  const isNew = !state.program;
  const draft = state.program ? { ...state.program } : {
    tenant_id: store.state.tenant.id,
    name: 'Default Loyalty',
    earn_per_amount: 1,
    redeem_value: 1,
    min_redeem_points: 100,
    max_redeem_percent: 0.5,
    expiry_days: 365,
    is_active: true,
  };

  const card = el('div', { class: 'bg-white rounded-2xl border border-slate-200 p-6 space-y-5' });

  card.appendChild(el('div', {}, [
    el('h2', { class: 'text-lg font-bold text-slate-800' }, isNew ? 'Set Up Loyalty Program' : 'Loyalty Program'),
    el('p', { class: 'text-xs text-slate-500 mt-0.5' },
      isNew ? 'Configure how customers earn and redeem points.' : 'Changes apply to new transactions only.'),
  ]));

  card.appendChild(field('Program name', el('input', {
    type: 'text', value: draft.name, class: inputCls,
    oninput: e => { draft.name = e.target.value; },
  })));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Points earned per ₹1 spent', el('input', {
      type: 'number', step: '0.01', min: 0, value: draft.earn_per_amount, class: inputCls,
      oninput: e => { draft.earn_per_amount = Number(e.target.value || 0); },
    })),
    field('₹ value per point redeemed', el('input', {
      type: 'number', step: '0.01', min: 0, value: draft.redeem_value, class: inputCls,
      oninput: e => { draft.redeem_value = Number(e.target.value || 0); },
    })),
  ]));

  card.appendChild(el('div', { class: 'grid grid-cols-2 gap-3' }, [
    field('Minimum points to redeem', el('input', {
      type: 'number', step: '1', min: 0, value: draft.min_redeem_points || 0, class: inputCls,
      oninput: e => { draft.min_redeem_points = Number(e.target.value || 0); },
    })),
    field('Max redemption (% of bill)', el('input', {
      type: 'number', step: '0.05', min: 0, max: 1, value: draft.max_redeem_percent || 0.5, class: inputCls,
      oninput: e => { draft.max_redeem_percent = Number(e.target.value || 0); },
    })),
  ]));

  card.appendChild(field('Points expire after (days, blank = never)', el('input', {
    type: 'number', min: 0, value: draft.expiry_days || '', class: inputCls,
    oninput: e => { draft.expiry_days = e.target.value ? Number(e.target.value) : null; },
  })));

  // Preview
  const preview = el('div', { class: 'bg-slate-50 rounded-lg p-4 text-sm' });
  function updatePreview() {
    const eg = 1000;
    const earned = eg * Number(draft.earn_per_amount || 0);
    const worth = earned * Number(draft.redeem_value || 0);
    preview.innerHTML = '';
    preview.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2' }, 'Example'));
    preview.appendChild(el('div', { class: 'text-slate-700' },
      `On a ${fmtMoney(eg)} bill, customer earns ${earned.toFixed(0)} points (~${fmtMoney(worth)} value).`));
  }
  card.appendChild(preview);
  updatePreview();

  // Manual update on any input — simplest approach: observe children
  card.addEventListener('input', updatePreview);

  card.appendChild(el('button', {
    class: 'w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const payload = {
          tenant_id: draft.tenant_id,
          name: draft.name,
          earn_per_amount: Number(draft.earn_per_amount) || 0,
          redeem_value: Number(draft.redeem_value) || 0,
          min_redeem_points: Number(draft.min_redeem_points) || 0,
          max_redeem_percent: Number(draft.max_redeem_percent) || 0,
          expiry_days: draft.expiry_days,
          is_active: true,
          tiers: draft.tiers || [],
        };
        if (isNew) {
          const { error } = await supabase.from('loyalty_programs').insert(payload);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('loyalty_programs').update(payload).eq('id', draft.id);
          if (error) throw error;
        }
        toast('Program saved', 'success');
        await refresh();
        paint(root);
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Save Program';
      }
    },
  }, isNew ? 'Create Program' : 'Save Program'));

  wrap.appendChild(card);
  return wrap;
}

// ============================================================
// SHARED
// ============================================================
function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-xl md:text-2xl font-bold mt-1 truncate' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function field(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
    control,
  ]);
}
