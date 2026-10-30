import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, fmtMoney, toast } from '../../utils.js';
import { buildReceiptData, buildReceiptHTML } from '../receipt.js';
import { buildReceiptBytes, printUSB, printHTML, isUSBConnected } from '../printer.js';

export async function renderVoidedItems() {
  const wrapper = el('div', { class: 'w-full' });
  wrapper.innerHTML = '<div class="text-center py-10 text-slate-500 animate-pulse">Loading Voided Items...</div>';
  
  const outletId = store.state.outlet?.id;
  if (!outletId) return wrapper;

  let fromDate = state.startDate || new Date().toISOString().split('T')[0];
  let toDate = state.endDate || new Date().toISOString().split('T')[0];

  try {
    // Fetch KOTs and their items, then filter for cancelled items in JS
    const { data: kots, error } = await supabase.from('kots')
      .select('*, orders(order_number, table_name_snapshot), kot_items(*)')
      .eq('outlet_id', outletId)
      .gte('created_at', fromDate + 'T00:00:00')
      .lte('created_at', toDate + 'T23:59:59')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Flatten and filter for cancelled items
    const voidedItems = [];
    (kots || []).forEach(k => {
        (k.kot_items || []).filter(it => it.status === 'cancelled' || it.status === 'void').forEach(it => {
            voidedItems.push({
                ...it,
                order_number: k.orders?.order_number,
                table_name: k.orders?.table_name_snapshot,
                kot_time: k.created_at,
                // Since we don't have the price in kot_items, we show 0 or fetch it. 
                // For now, we'll use a placeholder if price is not available.
                price: Number(it.unit_price || 0) 
            });
        });
    });

    const totalCount = voidedItems.length;
    const totalValue = voidedItems.reduce((sum, item) => sum + (Number(item.quantity) * item.price), 0);

    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6 pb-10 mt-4">
        
        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
            <div class="text-red-800 text-xs uppercase tracking-widest font-bold">Voided Items</div>
            <div class="text-3xl font-bold text-red-600 mt-1">${totalCount}</div>
            <div class="text-xs text-red-700 mt-1">Total count</div>
          </div>
          <div class="bg-slate-900 rounded-xl p-5 shadow-sm">
            <div class="text-slate-400 text-xs uppercase tracking-widest font-bold">Value Removed</div>
            <div class="text-3xl font-bold text-white mt-1">₹${totalValue.toFixed(2)}</div>
            <div class="text-xs text-slate-500 mt-1">Before taxes</div>
          </div>
        </div>

        <!-- Table -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 class="font-bold text-slate-800 text-sm">Voided KOT Items</h3>
            <span class="text-xs text-slate-500">Items removed after being sent to kitchen</span>
          </div>
          <table class="w-full">
            <thead class="bg-white text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th class="text-left px-5 py-3 font-semibold">Time</th>
                <th class="text-left px-5 py-3 font-semibold">Order</th>
                <th class="text-left px-5 py-3 font-semibold">Item</th>
                <th class="text-center px-5 py-3 font-semibold">Qty</th>
                <th class="text-left px-5 py-3 font-semibold">Reason</th>
                <th class="text-left px-5 py-3 font-semibold">Voided By</th>
              </tr>
            </thead>
            <tbody>
              ${voidedItems.length ? voidedItems.map(item => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td class="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">${new Date(item.kot_time).toLocaleString('en-GB', {dateStyle:'short', timeStyle:'short'})}</td>
                  <td class="px-5 py-4 text-sm text-slate-800 font-semibold">
                    #${item.order_number || 'N/A'}<br>
                    <span class="text-xs text-slate-500 font-normal">${item.table_name || 'Take-away'}</span>
                  </td>
                  <td class="px-5 py-4 text-sm text-slate-700">${item.name_snapshot}</td>
                  <td class="px-5 py-4 text-sm text-slate-800 text-center font-bold">${item.quantity}</td>
                  <td class="px-5 py-4 text-sm text-red-600 font-medium">${item.notes || 'No reason provided'}</td>
                  <td class="px-5 py-4 text-sm text-slate-500">Owner</td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="text-center py-10 text-slate-400 font-medium">No voided items in this period.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    wrapper.innerHTML = `<div class="text-red-500 p-4 font-mono text-sm border border-red-200 bg-red-50 rounded-lg">Error loading Voided Items: ${err.message}</div>`;
  }
  return wrapper;
}

