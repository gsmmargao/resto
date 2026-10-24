import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { fmtMoney, toast } from '../utils.js';

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Build the WhatsApp message text for an order receipt.
 * Falls back to a sensible default if no template is found.
 */
export async function buildReceiptMessage({ invoice, order, items, customer, outlet, tenant }) {
  // Try to load the tenant's receipt template
  let templateBody = null;
  try {
    const { data } = await supabase
      .from('message_templates')
      .select('body')
      .eq('tenant_id', tenant.id)
      .eq('event_key', 'receipt')
      .eq('channel', 'whatsapp')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    templateBody = data?.body || null;
  } catch (e) { /* ignore */ }

  const itemsText = (items || []).slice(0, 10).map(it => {
    const qty = Number(it.quantity);
    const name = it.name_snapshot + (it.variant_name ? ` (${it.variant_name})` : '');
    return `• ${qty} × ${name} — ₹${(qty * Number(it.unit_price)).toFixed(2)}`;
  }).join('\n');

  const moreText = (items || []).length > 10
    ? `\n…and ${items.length - 10} more item${items.length - 10 > 1 ? 's' : ''}`
    : '';

  const vars = {
    customer_name: customer?.name || 'Guest',
    restaurant:    tenant?.name || 'Restaurant',
    outlet:        outlet?.name || '',
    invoice_number: invoice?.invoice_number || '',
    order_number:  order?.order_number || '',
    order_date:    new Date(invoice?.invoice_time || Date.now()).toLocaleString('en-IN'),
    items_list:    itemsText + moreText,
    subtotal:      `₹${Number(invoice?.gross_total || 0).toFixed(2)}`,
    tax:           `₹${(Number(invoice?.cgst_amount||0) + Number(invoice?.sgst_amount||0)).toFixed(2)}`,
    discount:      Number(invoice?.discount_total) > 0 ? `₹${Number(invoice.discount_total).toFixed(2)}` : '—',
    total:         `₹${Number(invoice?.grand_total || 0).toFixed(2)}`,
    payment_mode:  (invoice?.payment_mode || '').toUpperCase(),
    table_name:    order?.table_name_snapshot || '',
    thank_you:     'Thank you for dining with us!',
  };

  if (templateBody) {
    return renderTemplate(templateBody, vars);
  }

  // Fallback default
  return [
    `Hi ${vars.customer_name},`,
    ``,
    `Here's your receipt from *${vars.restaurant}*:`,
    ``,
    `*Invoice:* ${vars.invoice_number}`,
    `*Date:* ${vars.order_date}`,
    vars.table_name ? `*Table:* ${vars.table_name}` : null,
    ``,
    vars.items_list,
    ``,
    `Subtotal: ${vars.subtotal}`,
    Number(invoice?.discount_total) > 0 ? `Discount: -${vars.discount}` : null,

    `*Total: ${vars.total}*`,
    ``,
    vars.thank_you,
  ].filter(Boolean).join('\n');
}

/**
 * Open WhatsApp with the receipt message ready to send.
 * Returns true if the chat was opened.
 */
export async function sendReceiptViaWhatsApp({ phone, message }) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (clean.length < 10) {
    toast('Customer phone is missing or invalid', 'warn');
    return false;
  }

  // Indian numbers default to 91 prefix
  const withCountry = clean.length === 10 ? '91' + clean : clean;

  const url = `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
  const win = window.open(url, '_blank');

  if (!win) {
    // Popup blocked — copy message to clipboard as fallback
    try {
      await navigator.clipboard.writeText(message);
      toast('WhatsApp popup blocked. Message copied — paste it in WhatsApp.', 'warn', 4000);
    } catch {
      toast('Could not open WhatsApp', 'error');
    }
    return false;
  }

  // Log the attempt
  return true;
}

/**
 * Log a sent WhatsApp message to message_logs for audit.
 */
export async function logWhatsAppSend({ tenantId, outletId, customerId, orderId, phone, message }) {
  try {
    await supabase.from('message_logs').insert({
      tenant_id: tenantId,
      outlet_id: outletId,
      customer_id: customerId || null,
      order_id: orderId || null,
      channel: 'whatsapp',
      event_key: 'receipt',
      to_address: phone,
      payload: { body: message.slice(0, 4000) },
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[whatsapp] log failed', e);
  }
}

/**
 * Send a receipt for an order. Combines message + open + log.
 */
export async function sendOrderReceipt({ order, invoice, items, customer, phone }) {
  const tenant = store.state.tenant;
  const outlet = store.state.outlet;

  const message = await buildReceiptMessage({ invoice, order, items, customer, outlet, tenant });
  const ok = await sendReceiptViaWhatsApp({ phone, message });

  if (ok) {
    await logWhatsAppSend({
      tenantId: tenant.id,
      outletId: outlet.id,
      customerId: customer?.id,
      orderId: order?.id,
      phone,
      message,
    });
    toast('WhatsApp opened', 'success', 1500);
  }
  return ok;
}

// ============================================================
// TEMPLATE EDITOR — used by the template-admin module
// ============================================================

export function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    if (key in vars) return String(vars[key] ?? '');
    return m;
  });
}

export const DEFAULT_TEMPLATE = `Hi {{customer_name}},

Here's your receipt from *{{restaurant}}*:

*Invoice:* {{invoice_number}}
*Date:* {{order_date}}

{{items_list}}

Subtotal: {{subtotal}}

*Total: {{total}}*

{{thank_you}}
`;

export const TEMPLATE_VARIABLES = [
  { key: 'customer_name',  desc: 'Customer name' },
  { key: 'restaurant',     desc: 'Your restaurant name' },
  { key: 'outlet',         desc: 'Outlet name' },
  { key: 'invoice_number', desc: 'Invoice number' },
  { key: 'order_number',   desc: 'Order number' },
  { key: 'order_date',     desc: 'Order date & time' },
  { key: 'items_list',     desc: 'Itemised list (max 10 items)' },
  { key: 'subtotal',       desc: 'Amount before tax/discount' },
  { key: 'discount',       desc: 'Discount amount' },
  { key: 'tax',            desc: 'Total tax' },
  { key: 'total',          desc: 'Grand total' },
  { key: 'payment_mode',   desc: 'Payment method' },
  { key: 'table_name',     desc: 'Table (dine-in only)' },
  { key: 'thank_you',      desc: 'Closing line' },
];
