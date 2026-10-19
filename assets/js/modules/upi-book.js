import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, fmtMoney } from '../utils.js';

export async function renderUpiBook(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading UPI data…'));

  try {
    const outletId = store.state.outlet.id;
    
    // Fetch successful UPI and Card payments for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = today.toISOString();

    const { data: payments, error } = await supabase
      .from('payments')
      .select(`
        id, amount, tip_amount, mode, reference_no, paid_at,
        orders ( order_number )
      `)
      .eq('outlet_id', outletId)
      .eq('status', 'success')
      .in('mode', ['upi', 'card'])
      .gte('paid_at', from)
      .order('paid_at', { ascending: false });

    if (error) throw error;

    const rows = payments || [];
    
    // Aggregate totals
    let upiTotal = 0, cardTotal = 0, upiTips = 0, cardTips = 0;
    rows.forEach(p => {
      if (p.mode === 'upi') {
        upiTotal += Number(p.amount);
        upiTips += Number(p.tip_amount || 0);
      } else if (p.mode === 'card') {
        cardTotal += Number(p.amount);
        cardTips += Number(p.tip_amount || 0);
      }
    });

    root.innerHTML = '';
    const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100 overflow-y-auto' });
    
    // Header
    const header = el('div', { class: 'bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10' }, [
      el('h1', { class: 'text-lg font-bold text-slate-800' }, 'UPI & Card Book'),
      el('p', { class: 'text-xs text-slate-500' }, `Today's Digital Collections · ${store.state.outlet.name}`),
    ]);
    wrap.appendChild(header);

    const body = el('div', { class: 'p-4 md:p-6 max-w-5xl mx-auto w-full space-y-6' });

    // Summary Cards
    const summaryGrid = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-4' });
    
    summaryGrid.appendChild(summaryCard('UPI Collected', upiTotal, 'from-purple-500 to-purple-600', 'bg-purple-50 text-purple-700', `Includes ${fmtMoney(upiTips)} tips`));
    summaryGrid.appendChild(summaryCard('Card Collected', cardTotal, 'from-indigo-500 to-indigo-600', 'bg-indigo-50 text-indigo-700', `Includes ${fmtMoney(cardTips)} tips`));
    summaryGrid.appendChild(summaryCard('Total Tips', upiTips + cardTips, 'from-emerald-500 to-emerald-600', 'bg-emerald-50 text-emerald-700', 'UPI & Card only'));
    
    const totalDigital = upiTotal + cardTotal;
    summaryGrid.appendChild(summaryCard('Total Digital', totalDigital, 'from-slate-700 to-slate-900', 'bg-slate-100 text-slate-800', 'Combined gross'));

    body.appendChild(summaryGrid);

    // Transaction Table
    const tableCard = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm' });
    tableCard.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center' }, [
      el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Recent Transactions'),
      el('span', { class: 'text-xs text-slate-500' }, `${rows.length} records`)
    ]));

    if (!rows.length) {
      tableCard.appendChild(el('div', { class: 'p-10 text-center text-slate-400 text-sm' }, 'No UPI or Card transactions recorded today.'));
    } else {
      const tbody = el('tbody');
      rows.forEach(p => {
        const time = new Date(p.paid_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const isUpi = p.mode === 'upi';
        const orderNum = p.orders?.order_number || '—';
        const tip = Number(p.tip_amount || 0);

        tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
          el('td', { class: 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap' }, time),
          el('td', { class: 'px-4 py-3 text-sm font-medium text-slate-800' }, `#${orderNum}`),
          el('td', { class: 'px-4 py-3' }, [
            el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${isUpi ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}` }, p.mode)
          ]),
          el('td', { class: 'px-4 py-3 text-xs text-slate-500 font-mono' }, p.reference_no || '—'),
          el('td', { class: 'px-4 py-3 text-sm font-bold text-slate-900 text-right' }, fmtMoney(p.amount)),
          el('td', { class: 'px-4 py-3 text-sm text-emerald-600 font-medium text-right' }, tip > 0 ? `+${fmtMoney(tip)}` : '—'),
        ]));
      });

      tableCard.appendChild(el('table', { class: 'w-full' }, [
        el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
          el('tr', {}, [
            el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Time'),
            el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Order #'),
            el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Mode'),
            el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Reference / Txn ID'),
            el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Amount'),
            el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Tip'),
          ]),
        ]),
        tbody,
      ]));
    }
    
    body.appendChild(tableCard);
    wrap.appendChild(body);
    root.appendChild(wrap);

  } catch (err) {
    console.error('[upi-book]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 font-mono text-sm' }, 'Failed to load UPI data: ' + err.message));
  }
}

function summaryCard(title, amount, gradient, textClass, subtext) {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm flex flex-col justify-between` }, [
    el('div', {}, [
      el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, title),
      el('div', { class: 'text-2xl font-bold mt-1' }, fmtMoney(amount)),
    ]),
    el('div', { class: 'text-[10px] mt-2 opacity-80' }, subtext)
  ]);
}
