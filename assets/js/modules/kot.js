let __isSendingKOT = false;

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
  if (__isSendingKOT) {
      if (window.toast) window.toast('KOT is already processing. Please wait...', 'warn');
      return null;
  }
  __isSendingKOT = true;

  const cart   = store.state.cart;
  const outlet = store.state.outlet;
  const tenant = store.state.tenant;
  const member = store.state.member;

  const newItems = cart.items.filter(l => !l._saved);
  if (!newItems.length) { 
      __isSendingKOT = false;
      toast('No new items to send', 'warn'); 
      return null; 
  }
  
  newItems.forEach(l => { l._saved = true; l.status = 'processing'; });
  window.dispatchEvent(new CustomEvent('cart:changed'));

  const tableRow = store.state.tables.find(t => t.id === cart.tableId);

  const orderPayload = {
      order_number: 'OFF-' + Date.now().toString(36).toUpperCase(),
      tenant_id: tenant.id, outlet_id: outlet.id, order_type: cart.orderType || 'dine_in',
      table_id: cart.tableId || null, table_name_snapshot: tableRow?.name || null,
      guest_count: Number(cart.guestCount) || 1,
      subtotal: cart.totals.gross || 0, gross_total: cart.totals.gross || 0
  };

  // STRICT CLASSIFICATION LOGIC
  const foodItems = [];
  const barItems = [];
  const skippedItems = [];

  newItems.forEach(i => {
      let cat = (i.categoryName || i.category_name || i.category || '').toLowerCase().trim();
      
      // 1. Look up real category from menu if missing
      if (!cat || cat === 'unknown') {
          const menuItem = (store.state.menuItems || []).find(m => String(m.id) === String(i.menuItemId));
          if (menuItem) {
              // CRITICAL FIX: Check food_category first!
              cat = (menuItem.food_category || menuItem.category_name || menuItem.categoryName || menuItem.category || '').toLowerCase().trim();
              if (!cat && menuItem.category_id) {
                  const catObj = (store.state.categories || []).find(c => String(c.id) === String(menuItem.category_id));
                  if (catObj) cat = (catObj.name || '').toLowerCase().trim();
              }
          }
      }

      // 2. Name-based fallback (safest for mocktails/water)
      if (!cat || cat === 'unknown') {
          const n = (i.name || '').toLowerCase();
          if (/\b(soda|juice|mocktail|mojito|lemonade|cooler|shake)\b/.test(n)) cat = 'mocktail';
          else if (/\b(water|cola|pepsi|coke|sprite|fanta|tea|coffee|beer|wine)\b/.test(n)) cat = 'beverage';
          else cat = 'food';
      }

      let isBar = cat.includes('mocktail') || cat.includes('bar') || cat.includes('cocktail');
      let isBeverage = cat.includes('beverage') || cat.includes('drink') || cat.includes('water');
      
      // 3. Check print_kot flag
      let shouldPrint = i.print_kot;
      if (shouldPrint === undefined) {
          const menuItem = (store.state.menuItems || []).find(m => String(m.id) === String(i.menuItemId));
          if (menuItem) shouldPrint = menuItem.print_kot !== false;
      }

      // 4. Route to correct bucket
      if (shouldPrint === false || isBeverage) {
          skippedItems.push(i);
      } else if (isBar) {
          barItems.push(i);
      } else {
          foodItems.push(i);
      }
  });

  console.log('🔍 KOT Classification:', { 
      Food: foodItems.map(i => i.name), 
      Bar: barItems.map(i => i.name), 
      Skipped: skippedItems.map(i => i.name) 
  });

  const foodKotId = foodItems.length > 0 ? crypto.randomUUID() : null;
  const barKotId = barItems.length > 0 ? crypto.randomUUID() : null;

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

      const itemsPayload = newItems.map(l => {
          const isBar = barItems.some(b => b.id === l.id);
          const isFood = foodItems.some(f => f.id === l.id);
          return {
              tenant_id: tenant.id, outlet_id: outlet.id, order_id: orderId,
              kot_id: isBar ? barKotId : (isFood ? foodKotId : null),
              menu_item_id: l.menuItemId, name_snapshot: l.name,
              quantity: Number(l.qty), unit_price: Number(l.unitPrice),
              notes: l.notes || null, status: 'sent_to_kitchen' 
          };
      });
      
      const { error: iErr } = await supabase.from('order_items').insert(itemsPayload);
      if (iErr) throw iErr;

      if (foodKotId) {
          await supabase.from('kots').insert([{
              id: foodKotId, tenant_id: tenant.id, outlet_id: outlet.id,
              kot_number: 'KIT-' + Date.now().toString().slice(-4),
              table_name: tableRow?.name || 'Takeaway', status: 'pending', order_id: orderId
          }]);
      }
      if (barKotId) {
          await supabase.from('kots').insert([{
              id: barKotId, tenant_id: tenant.id, outlet_id: outlet.id,
              kot_number: 'BAR-' + Date.now().toString().slice(-4),
              table_name: tableRow?.name || 'Takeaway', status: 'pending', order_id: orderId
          }]);
      }

      newItems.forEach(l => { l.status = 'sent_to_kitchen'; });
      window.dispatchEvent(new CustomEvent('cart:changed'));

      if (CONFIG.LOCAL_SERVER_IP) {
          if (foodItems.length > 0) {
              fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-kot`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      kot: 'KIT-' + Date.now().toString().slice(-4),
                      items: foodItems.map(i => ({ name: i.name, quantity: i.qty, variant: i.variantName, notes: i.notes })),
                      tableName: tableRow?.name || 'Takeaway',
                      waiterName: member?.display_name
                  })
              }).catch(err => console.error('❌ Kitchen Print error:', err));
          }
          if (barItems.length > 0) {
              fetch(`https://${CONFIG.LOCAL_SERVER_IP}:3000/api/print-kot`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      kot: 'BAR-' + Date.now().toString().slice(-4),
                      items: barItems.map(i => ({ name: i.name, quantity: i.qty, variant: i.variantName, notes: i.notes })),
                      tableName: tableRow?.name || 'Takeaway',
                      waiterName: member?.display_name
                  })
              }).catch(err => console.error('❌ Bar Print error:', err));
          }
      }

      toast('KOT sent successfully', 'success');
      return orderId;
  } catch (err) {
      newItems.forEach(l => { l._saved = false; l.status = null; });
      window.dispatchEvent(new CustomEvent('cart:changed'));
      console.error(err);
      toast('Failed to save order: ' + err.message, 'error');
      return null;
  } finally {
      __isSendingKOT = false;
  }
}
