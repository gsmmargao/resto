import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const state = {
  tab: localStorage.getItem('reports_active_tab') || 'overview',
  startDate: getTodayStr(),
  endDate: getTodayStr()
};


export function kpi(label, value, gradient, sub = '') {
  return el('div', { class: `rounded-xl bg-gradient-to-br ${gradient} text-white p-4 shadow-sm` }, [
    el('div', { class: 'text-[10px] uppercase tracking-wider opacity-90 font-semibold' }, label),
    el('div', { class: 'text-2xl font-bold mt-1' }, String(value)),
    sub ? el('div', { class: 'text-[10px] opacity-90 mt-1' }, sub) : null,
  ].filter(Boolean));
}

export function rangeStart() {
  // Parse as local time to avoid UTC offset issues
  const d = new Date(state.startDate + 'T00:00:00');
  return d;
}

export function rangeEnd() {
  // Parse as local time to avoid UTC offset issues
  const d = new Date(state.endDate + 'T23:59:59.999');
  return d;
}

export function shiftDate(dateStr, days) {
    // Append 'T12:00:00' to prevent timezone shift issues when parsing YYYY-MM-DD
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

