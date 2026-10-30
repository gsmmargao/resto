import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';
import { rangeStart, rangeEnd } from './helpers.js';
import { openBillReprintModal } from './modals.js';

export async function renderBills() {
  const outletId = store.state.outlet.id;
  const from = rangeStart().toISOString();
  const to = rangeEnd().toISOString();

  // 1. Include balance_due in the fetch
  const { data: invoices, error } = await supabase.from('invoices')
    .select('id, invoice_number, grand_total, balance_due, status, created_at, orders(table_name_snapshot, order_number)')
    .eq('outlet_id', outletId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  if (error) return el('div', { class: 'p-6 text-red-600 font-mono text-sm' }, 'Database Error: ' + error.message);

  if (!invoices || invoices.length === 0) {
    const card = el('div', { class: 'bg-white rounded-xl border border-slate-200 overflow-hidden' });
    card.appendChild(el('div', { class: 'p-8 text-center text-slate-400 text-sm' }, 'No bills found in this period'));
    return card;
  }

  const invIds = invoices.map(i => i.id);
  const { data: payments } = await supabase.from('payments').select('invoice_id, mode').in('invoice_id', invIds);

  const modeMap = new Map();
  (payments || []).forEach(p => {
    if (!modeMap.has(p.invoice_id)) modeMap.set(p.invoice_id, new Set());
    modeMap.get(p.invoice_id).add(p.mode);
  });

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
    let modeText = modes.size === 0 ? '—' : (modes.size > 1 ? 'SPLIT' : [...modes][0].toUpperCase());

    // 2. Adjust the label based on balance_due
    const hasBalance = Number(inv.balance_due) > 0;
    if (hasBalance && (modeText === 'CREDIT' || modeText === 'SPLIT')) {
        modeText = 'CREDIT (DUE)';
    } else if (!hasBalance && (modeText === 'CREDIT' || modeText === 'SPLIT')) {
        modeText = 'CREDIT (PAID)';
    }

    tbody.appendChild(el('tr', { class: 'border-t border-slate-100 hover:bg-slate-50' }, [
      el('td', { class: 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap' }, time),
      el('td', { class: 'px-4 py-3' }, [
        el('div', { class: 'font-mono text-sm font-semibold text-slate-800' }, inv.invoice_number),
        el('div', { class: 'text-xs text-slate-500' }, `#${inv.orders?.order_number || '—'}`),
      ]),
      el('td', { class: 'px-4 py-3 text-sm text-slate-700' }, tableName),
      el('td', { class: 'px-4 py-3 text-right text-sm font-semibold text-slate-800' }, fmtMoney(inv.grand_total)),
      el('td', { class: 'px-4 py-3 text-center' }, [
        el('button', {
          // 3. Update colors to show red for DUE and green for PAID
          class: `text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wide hover:ring-2 hover:ring-offset-1 transition cursor-pointer ${
            modeText === 'CASH' ? 'bg-emerald-100 text-emerald-700 ring-emerald-400' :
            modeText === 'UPI' ? 'bg-purple-100 text-purple-700 ring-purple-400' :
            modeText === 'CARD' ? 'bg-indigo-100 text-indigo-700 ring-indigo-400' :
            modeText === 'CREDIT (DUE)' ? 'bg-red-100 text-red-700 ring-red-400' :
            modeText === 'CREDIT (PAID)' ? 'bg-emerald-100 text-emerald-700 ring-emerald-400' :
            'bg-slate-100 text-slate-600 ring-slate-400'
          }`,
          title: hasBalance ? 'Payment is outstanding' : 'Payment is fully settled',
        }, modeText)
      ]),
      el('td', { class: 'px-4 py-3 text-right' }, [
        el('button', {
          class: 'text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition',
          onclick: () => openBillReprintModal(inv.id)
        }, '🧾 View / Print')
      ])
    ]));
  });

  card.appendChild(el('table', { class: 'w-full' }, [
    el('thead', { class: 'bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide' }, [
      el('tr', {}, [
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Date'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Bill #'),
        el('th', { class: 'text-left px-4 py-2.5 font-semibold' }, 'Table'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, 'Total'),
        el('th', { class: 'text-center px-4 py-2.5 font-semibold' }, 'Mode'),
        el('th', { class: 'text-right px-4 py-2.5 font-semibold' }, ''),
      ]),
    ]),
    tbody,
  ]));

  return card;
}

