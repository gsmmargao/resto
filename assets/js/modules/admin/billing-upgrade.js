import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';

export async function renderBillingUpgrade(root) {
  root.innerHTML = '';

  // Load plans
  const { data: plans } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order');
  const current = store.state.subscription;

  const wrap = el('div', { class: 'h-full overflow-y-auto bg-slate-50 p-4 md:p-8' });
  const inner = el('div', { class: 'max-w-6xl mx-auto space-y-6' });

  // Header
  inner.appendChild(el('div', { class: 'text-center max-w-2xl mx-auto' }, [
    el('h1', { class: 'text-3xl font-bold text-slate-800' }, 'Choose your plan'),
    el('p', { class: 'text-slate-500 mt-2' }, 'Simple, transparent pricing. Cancel anytime.'),
    current
      ? el('div', { class: 'inline-block mt-4 px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold' },
          `Currently on: ${current.plan_name || current.plan_code} · ${current.effective_status || current.tenant_status}`)
      : null,
  ].filter(Boolean)));

  // Plan cards
  const grid = el('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-4' });
  (plans || []).forEach(p => grid.appendChild(buildPlanCard(p, current)));
  inner.appendChild(grid);

  // FAQ
  inner.appendChild(el('div', { class: 'bg-white rounded-2xl border border-slate-200 p-6 md:p-8 max-w-3xl mx-auto' }, [
    el('h2', { class: 'text-xl font-bold text-slate-800 mb-4' }, 'Frequently asked'),
    faq('Can I change plans anytime?', 'Yes — upgrade or downgrade immediately. You\'ll be charged a prorated amount.'),
    faq('What happens when my trial ends?', 'You get 7 days of grace period. After that, your account becomes read-only until you subscribe.'),
    faq('Do you offer annual billing?', 'Yes — save 2 months by paying yearly. Choose the yearly toggle when you subscribe.'),
    faq('Can I cancel?', 'Yes, any time. Access continues until the end of your current billing period.'),
  ]));

  wrap.appendChild(inner);
  root.appendChild(wrap);
}

function buildPlanCard(plan, current) {
  const isCurrent = current && current.plan_code === plan.code;
  const isPopular = plan.code === 'growth';

  const card = el('div', {
    class: `bg-white rounded-2xl border-2 p-6 flex flex-col relative transition ${isPopular ? 'border-indigo-500 shadow-lg' : 'border-slate-200'} ${isCurrent ? 'ring-2 ring-emerald-200' : ''}`,
  });

  if (isPopular && !isCurrent) {
    card.appendChild(el('div', { class: 'absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wide' }, 'Most popular'));
  }
  if (isCurrent) {
    card.appendChild(el('div', { class: 'absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wide' }, 'Current plan'));
  }

  card.appendChild(el('div', { class: 'mb-6' }, [
    el('div', { class: 'text-sm font-semibold text-slate-500 uppercase tracking-wide' }, plan.name),
    el('div', { class: 'mt-3 flex items-baseline gap-1' }, [
      el('span', { class: 'text-4xl font-bold text-slate-900' }, fmtMoney(plan.price_monthly).replace('.00', '')),
      el('span', { class: 'text-slate-500 text-sm' }, '/month'),
    ]),
    plan.price_yearly ? el('div', { class: 'text-xs text-slate-500 mt-1' }, `or ${fmtMoney(plan.price_yearly).replace('.00','')}/year · save 2 months`) : null,
  ].filter(Boolean)));

  // Limits
  const limitsBox = el('div', { class: 'space-y-2 mb-6 text-sm' });
  const limits = plan.limits || {};
  limitsBox.appendChild(limitRow('Outlets', limits.outlets === 999 ? 'Unlimited' : limits.outlets));
  limitsBox.appendChild(limitRow('Staff', limits.staff === 999 ? 'Unlimited' : limits.staff));
  limitsBox.appendChild(limitRow('Menu items', limits.items >= 100000 ? 'Unlimited' : limits.items));
  card.appendChild(limitsBox);

  // Features
  const featuresBox = el('div', { class: 'space-y-2 mb-6 flex-1' });
  const features = plan.features || {};
  const featureLabels = {
    kds: 'Kitchen Display (KDS)',
    whatsapp: 'WhatsApp receipts',
    loyalty: 'Loyalty & wallet',
    api: 'API & webhooks',
    white_label: 'White-label branding',
    multi_outlet: 'Multi-outlet management',
    offline: 'Offline-first POS',
    reports: 'Advanced reports',
  };
  Object.entries(features).forEach(([key, val]) => {
    if (val !== true) return;
    featuresBox.appendChild(featureRow(featureLabels[key] || key));
  });

  card.appendChild(featuresBox);

  // CTA
  const cta = el('button', {
    class: `w-full py-3 rounded-lg font-semibold text-sm transition ${
      isCurrent
        ? 'bg-emerald-50 text-emerald-700 cursor-default'
        : isPopular
          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
          : 'bg-slate-900 hover:bg-black text-white'
    }`,
    disabled: isCurrent ? true : null,
    onclick: isCurrent ? null : () => startUpgrade(plan),
  }, isCurrent ? '✓ Active' : (current ? 'Switch to this plan' : 'Start 14-day free trial'));

  card.appendChild(cta);
  return card;
}

function limitRow(label, value) {
  return el('div', { class: 'flex justify-between text-slate-600' }, [
    el('span', {}, label),
    el('span', { class: 'font-medium text-slate-800' }, String(value ?? '—')),
  ]);
}

function featureRow(label) {
  return el('div', { class: 'flex items-start gap-2 text-slate-700 text-sm' }, [
    el('span', { class: 'text-emerald-600 font-bold shrink-0 mt-0.5' }, '✓'),
    el('span', {}, label),
  ]);
}

function faq(q, a) {
  return el('div', { class: 'py-3 border-b border-slate-100 last:border-0' }, [
    el('div', { class: 'font-semibold text-slate-800 text-sm' }, q),
    el('div', { class: 'text-sm text-slate-600 mt-1' }, a),
  ]);
}

function startUpgrade(plan) {
  // For now, this triggers a placeholder modal.
  // In the next module, we'll wire Razorpay Subscriptions here.
  toast(`Upgrade to ${plan.name} will be available after Razorpay setup`, 'info', 4000);

  // Placeholder modal — swap this out when Razorpay ships
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center' });

  card.appendChild(el('div', { class: 'w-16 h-16 rounded-full bg-indigo-100 mx-auto flex items-center justify-center mb-4' }, [
    el('span', { class: 'text-3xl' }, '💳'),
  ]));
  card.appendChild(el('h3', { class: 'text-xl font-bold text-slate-800 mb-2' }, `Upgrade to ${plan.name}`));
  card.appendChild(el('p', { class: 'text-sm text-slate-600 mb-6' },
    `You'll be charged ₹${plan.price_monthly}/month. Razorpay checkout will open here.`));

  card.appendChild(el('button', {
    class: 'w-full py-3 rounded-lg bg-slate-900 hover:bg-black text-white font-semibold transition',
    onclick: () => overlay.remove(),
  }, 'Got it'));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
