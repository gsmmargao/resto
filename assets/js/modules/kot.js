import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { toast } from '../utils.js';
import { printKOT } from './printer.js';
import { CONFIG } from '../../../config.js';

const ORDER_STATUS_VALUES  = new Set(['draft','open','in_kitchen','partially_ready','ready','served','billed','paid','partially_paid','cancelled','refunded','merged']);
const ORDER_TYPE_VALUES    = new Set(['dine_in','takeaway','delivery','online']);
const ORDER_SOURCE_VALUES  = new Set(['pos','qr','kiosk','whatsapp','website','phone','swiggy','zomato','walk_in']);
const KOT_STATUS_VALUES    = new Set(['pending','acknowledged','preparing','ready','served','cancelled']);

export async function sendKOT() {
  const cart   = store.state.cart;
  const outlet = store.state.outlet;
  const tenant = store.state.tenant;
  const member = store.state.member;

  const newItems = cart.items.filter(l => !l._saved);

  if (!newItems.length) { toast('No new items to send', 'warn'); return null; }
  if (!outlet || !tenant) { toast('No outlet selected', 'error'); return null; }
  if (cart.orderType === 'dine_in' && !cart.tableId) { toast('Select a table first', 'warn'); return null; }

  const tableRow = store.state.tables.find(t => t.id === cart.tableId);

  let orderId = cart.orderId;
  if (!orderId) {
    const { data: orderNo, error: seqErr } = await supabase
      .rpc('next_doc_number', { p_outlet: outlet.id, p_doc_type: 'order' });
    if (seqErr || !orderNo) { toast('Order numbering failed', 'error'); return null; }

    const orderType = ORDER_TYPE_VALUES.has(cart.orderType) ? cart.orderType : 'dine_in';

    const payload = {
      tenant_id: tenant.id, outlet_id: outlet.id, order_number: orderNo,
      order_type: orderType, source: 'pos', status: 'in_kitchen',
      table_id: cart.tableId || null, table_name_snapshot: tableRow?.name || null,
      guest_count: Number(cart.guestCount) || 1,
      waiter_id: member?.id || null, cashier_id: member?.id || null,
      created_by: store.state.session?.user?.id || null,
      service_charge_pct: Number(cart.serviceChargePct) || 0,
    };

    if (!ORDER_STATUS_VALUES.has(payload.status) || !ORDER_TYPE_VALUES.has(payload.order_type) || !ORDER_SOURCE_VALUES.has(payload.source)) {
      toast('Internal: invalid enum', 'error'); return null;
    }

    const { data: order, error } = await supabase.from('orders').insert(payload).select().single();
    if (error) { toast('Order insert failed: ' + error.message, 'error'); console.error(error); return null; }
    orderId = order.id;
    store.state.cart.orderId = orderId;
  } else {
    await supabase.from('orders').update({ status: 'in_kitchen' }).eq('id', orderId);
  }

  const itemRows = newItems.map(l => ({
    tenant_id: tenant.id, outlet_id: outlet.id, order_id: orderId,
    menu_item_id: l.menuItemId, variant_id: l.variantId,
    name_snapshot: l.name, variant_name: l.variantName,
    quantity: Number(l.qty), unit_price: Number(l.unitPrice),
    tax_rate: Number(l.taxRate), tax_inclusive: !!l.taxInclusive,
    status: 'sent_to_kitchen', station_id: l.stationId || null,
    notes: l.notes || null, created_by: store.state.session?.user?.id || null,
  }));

  const { data: insertedItems, error: iErr } = await supabase
    .from('order_items').insert(itemRows).select();
  if (iErr) { toast('Order items failed: ' + iErr.message, 'error'); console.error(iErr); return null; }

  newItems.forEach((l, i) => {
    l._saved = true;
    l._dbId = insertedItems[i]?.id;
    l.status = 'sent_to_kitchen';
  });
  window.dispatchEvent(new CustomEvent('cart:changed'));

  const byStation = new Map();
  insertedItems.forEach(it => {
    const key = it.station_id || 'default';
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key).push(it);
  });

  let kotSuccess = 0;
  for (const [stationId, items] of byStation.entries()) {
    const { data: kotNo, error: kNoErr } = await supabase
      .rpc('next_doc_number', { p_outlet: outlet.id, p_doc_type: 'kot' });
    if (kNoErr || !kotNo) { toast('KOT numbering failed', 'error'); continue; }

    const kotPayload = {
      tenant_id: tenant.id, outlet_id: outlet.id, order_id: orderId,
      station_id: stationId === 'default' ? null : stationId,
      kot_number: kotNo, status: 'pending',
      table_name: tableRow?.name || null,
      order_type: ORDER_TYPE_VALUES.has(cart.orderType) ? cart.orderType : 'dine_in',
      guest_count: Number(cart.guestCount) || 1,
      created_by: store.state.session?.user?.id || null,
    };

    if (!KOT_STATUS_VALUES.has(kotPayload.status)) continue;

    const { data: kot, error: kErr } = await supabase.from('kots').insert(kotPayload).select().single();
    if (kErr) { toast('KOT insert failed: ' + kErr.message, 'error'); continue; }

    const kotItemsPayload = items.map(it => ({
      tenant_id: tenant.id, kot_id: kot.id, order_item_id: it.id,
      name_snapshot: it.name_snapshot, variant_name: it.variant_name,
      quantity: Number(it.quantity), status: 'pending', notes: it.notes || null,
    }));

    const { error: kiErr } = await supabase.from('kot_items').insert(kotItemsPayload);
    if (kiErr) { toast('KOT items failed: ' + kiErr.message, 'error'); continue; }
    kotSuccess++;

    // --- AUTO PRINT KOT ---
    if (CONFIG.LOCAL_SERVER_IP) {
      console.log("Sending KOT to LAN Server at:", CONFIG.LOCAL_SERVER_IP);
      fetch(`http://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-kot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kot: kot.kot_number,
          items: items.map(i => ({ name: i.name_snapshot, quantity: i.quantity, variant: i.variant_name, notes: i.notes })),
          tableName: tableRow?.name || 'Takeaway',
          waiterName: member?.display_name
        })
      }).then(res => {
        if (!res.ok) throw new Error('Server error: ' + res.status);
        console.log("✅ KOT sent to Local Server");
      }).catch(err => {
        console.error('❌ LAN Print error:', err);
      });
    } else {
      printKOT({
        kot: kot,
        items: items,
        tableName: tableRow?.name || null,
        waiterName: member?.display_name || null,
        orderType: cart.orderType
      }).catch(err => console.error('Print error:', err));
    }
  }

  await supabase.rpc('recalc_order', { p_order_id: orderId });

  if (kotSuccess === 0) { toast('Order saved but no KOT created', 'warn'); return null; }
  toast(kotSuccess + ' KOT' + (kotSuccess > 1 ? 's' : '') + ' sent to kitchen', 'success');
  return orderId;
}
