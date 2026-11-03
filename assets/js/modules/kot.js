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
  
  const tableRow = store.state.tables.find(t => t.id === cart.tableId);

  const orderPayload = {
      order_number: 'OFF-' + Date.now().toString(36).toUpperCase(),
      tenant_id: tenant.id, outlet_id: outlet.id, order_type: cart.orderType || 'dine_in',
      table_id: cart.tableId || null, table_name_snapshot: tableRow?.name || null,
      guest_count: Number(cart.guestCount) || 1,
      subtotal: cart.totals.gross || 0, gross_total: cart.totals.gross || 0
  };

  const itemsPayload = newItems.map(l => ({
      id: crypto.randomUUID(), // REQUIRED FOR SUPABASE
      tenant_id: tenant.id,
      outlet_id: outlet.id,
      menu_item_id: l.menuItemId, 
      name_snapshot: l.name,
      quantity: Number(l.qty), 
      unit_price: Number(l.unitPrice),
      notes: l.notes || null,
      status: 'sent_to_kitchen' // REQUIRED SO CART CAN SEE IT
  }));

  const kotPayload = {
      id: crypto.randomUUID(),
      tenant_id: tenant.id,
      outlet_id: outlet.id,
      kot_number: 'OFF-' + Date.now().toString().slice(-4),
      table_name: tableRow?.name || 'Takeaway',
      status: 'pending',
      created_at: new Date().toISOString()
  };

  try {
      let orderId = cart.orderId;
      if (!orderId) {
          const { data: oData, error: oErr } = await supabase.from('orders').insert([orderPayload]).select().single();
          if (oErr) throw oErr;
          orderId = oData.id;
          cart.orderId = orderId;
      } else {
          await supabase.from('orders').update({
              subtotal: cart.totals.gross || 0, gross_total: cart.totals.gross || 0
          }).eq('id', orderId);
      }

      itemsPayload.forEach(i => i.order_id = orderId);
      const { error: iErr } = await supabase.from('order_items').insert(itemsPayload);
      if (iErr) throw iErr;

      kotPayload.order_id = orderId;
      const { error: kErr } = await supabase.from('kots').insert([kotPayload]);
      if (kErr) throw kErr;

      newItems.forEach(l => { l._saved = true; l.status = 'sent_to_kitchen'; });
      window.dispatchEvent(new CustomEvent('cart:changed'));

      if (CONFIG.LOCAL_SERVER_IP) {
          const printItems = newItems.filter(i => {
              let isBev = false;
              const name = (i.name || '').toLowerCase();
              const cat = (i.categoryName || i.category_name || i.category || '').toLowerCase();
              const drinkWords = ['water', 'cola', 'soda', 'juice', 'drink', 'mojito', 'mocktail', 'tea', 'coffee', 'beer', 'wine', 'shake'];
              if (drinkWords.some(w => name.includes(w))) isBev = true;
              if (cat.includes('beverage') || cat.includes('drink') || cat.includes('mocktail')) isBev = true;
              return !isBev;
          });

          if (printItems.length > 0) {
              fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-kot`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      kot: kotPayload.kot_number,
                      items: printItems.map(i => ({ name: i.name, quantity: i.qty, variant: i.variantName, notes: i.notes })),
                      tableName: kotPayload.table_name,
                      waiterName: member?.display_name
                  })
              }).catch(err => console.error('❌ LAN Print error:', err));
          }
      }

      toast('KOT sent to kitchen', 'success');
      return orderId;
  } catch (err) {
      console.error(err);
      toast('Failed to save order: ' + err.message, 'error');
      return null;
  }
}
