import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { rangeStart, rangeEnd } from './helpers.js';
import { openBillReprintModal, openModeToggleModal } from './modals.js';

export async function renderBills() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  const { data: invoices, error } = await supabase.from('invoices')
    .select('id, invoice_number, grand_total, balance_due, status, created_at, orders(table_name_snapshot, order_number)')
    .eq('outlet_id', outletId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  if (error) {
    toast('Failed to load bills: ' + error.message, 'error');
    return;
  }

  const invIds = invoices.map(i => i.id);
  let modeMap = new Map();
  if (invIds.length > 0) {
    const { data: payments } = await supabase.from('payments').select('invoice_id, mode').in('invoice_id', invIds);
    (payments || []).forEach(p => {
      if (!modeMap.has(p.invoice_id)) modeMap.set(p.invoice_id, new Set());
      modeMap.get(p.invoice_id).add(p.mode.toLowerCase());
    });
  }

  const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
  card.appendChild(el('div', { class: 'px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between' }, [
    el('h3', { class: 'font-semibold text-slate-800 text-sm' }, 'Recent Bills'),
    el('span', { class: 'text-xs text-slate-500' }, `${invoices.length} invoices`),
  ]));

  const tbody = el('tbody');
  
  invoices.forEach(inv => {
    const tableName = inv.orders?.table_name_snapshot || 'Takeaway';
    const time = new Date(inv.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    
    const modes = modeMap.get(inv.id) || new Set();
    const hasCredit = modes.has('credit');
    
    const total = Number(inv.grand_total || 0);
    const pending = Number(inv.balance_due || 0);
    const paid = total - pending;

    // --- STRICT STATUS LOGIC ---
    let modeText = '—';
    let badgeClass = 'bg-slate-100 text-slate-600 ring-slate-400';

    if (pending <= 0 && paid > 0) {
        // Fully Paid
        if (hasCredit) {
            modeText = 'CREDIT (PAID)';
            badgeClass = 'bg-emerald-100 text-emerald-700 ring-emerald-400';
        } else {
            // Normal Cash/UPI
            modeText = Array.from(modes).map(m => m.toUpperCase()).join(', ') || 'PAID';
            badgeClass = 'bg-slate-100 text-slate-700 ring-slate-400';
        }
    } else if (pending > 0 && paid > 0) {
        // Partial Payment
        modeText = 'PARTIAL (DUE)';
        badgeClass = 'bg-amber-100 text-amber-700 ring-amber-400';
    } else if (pending > 0 && paid === 0) {
        // Fully Due
        modeText = 'CREDIT (DUE)';
        badgeClass = 'bg-red-100 text-red-700 ring-red-400';
    }

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap' }, time),
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'font-mono text-sm font-semibold text-slate-800' }, inv.invoice_number),
        el('div', { class: 'text-xs text-slate-500' }, `#${inv.orders?.order_number || '—'}`),
      ]),
      el('td', { class: 'px-4 py-3 text-sm text-slate-700' }, tableName),
      el('td', { class: 'px-4 py-3 text-right text-sm font-semibold text-slate-800' }, fmtMoney(total)),
      el('td', { class: 'px-4 py-3 text-center' }, [
        el('button', {
          class: `text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide transition ${['PARTIAL (DUE)', 'CREDIT (PAID)'].includes(modeText) ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:ring-2 hover:ring-offset-1'} ${badgeClass}`,
          title: ['PARTIAL (DUE)', 'CREDIT (PAID)'].includes(modeText) ? 'Locked: Payment already processed' : 'Click to change payment mode / map customer',
          onclick: () => {
            if (['PARTIAL (DUE)', 'CREDIT (PAID)'].includes(modeText)) {
              toast('This bill is locked. Please manage it from the Loyalty tab.', 'warn');
            } else {
              openModeToggleModal(inv.id, modeText, total, pending);
            }
          }
        }, modeText)
      ]),
      el('td', { class: 'px-4 py-3 text-right' }, [
        el('button', {
          class: 'text-indigo-600 hover:text-indigo-800 text-xs font-semibold px-2 py-1 rounded hover:bg-indigo-50 transition',
          onclick: () => openBillReprintModal(inv.id)
        }, 'View / Print')
      ])
    ]));
  });

  const thead = el('thead', { class: 'bg-slate-50 border-b border-slate-200' }, [
    el('tr', {}, [
      el('th', { class: 'px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Date'),
      el('th', { class: 'px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Bill #'),
      el('th', { class: 'px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Table'),
      el('th', { class: 'px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Total'),
      el('th', { class: 'px-4 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Mode'),
      el('th', { class: 'px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider' }, 'Action'),
    ])
  ]);

  card.appendChild(el('div', { class: 'overflow-x-auto' }, [el('table', { class: 'w-full text-left' }, [thead, tbody])]));
  
  const wrapper = el('div', { class: 'w-full' });
  wrapper.appendChild(card);
  return wrapper;
}
