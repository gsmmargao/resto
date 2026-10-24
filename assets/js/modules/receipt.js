import { padLine } from './escpos.js';
import { CONFIG } from '../../../config.js';

export function buildReceiptData({ tenant, outlet, order, items, invoice, payments, customer, tableName }) {
  return {
    header: {
      name:    tenant?.name || 'Restaurant',
      address: [outlet?.address_line1, outlet?.city, outlet?.pincode].filter(Boolean).join(', '),
      phone:   outlet?.phone || '',
      gstin:   outlet?.gstin || '',
      fssai:   outlet?.fssai_license || '',
    },
    invoice: {
      number:      invoice.invoice_number,
      date:        new Date(invoice.invoice_time).toLocaleString(CONFIG.LOCALE),
      orderNumber: order?.order_number || '',
      orderType:   order?.order_type || '',
      table:       tableName || order?.table_name_snapshot || '',
    },
    customer: {
      name:  customer?.name  || '',
      phone: customer?.phone || '',
      gstin: customer?.gstin || '',
    },
    items: (items || []).map(it => {
      // Calculate pure amount by stripping any tax that might have been saved previously
      const lineTotal = Number(it.line_total || 0);
      const taxAmount = Number(it.tax_amount || 0);
      const pureAmount = lineTotal - taxAmount;

      return {
        name:    it.name_snapshot ? (it.name_snapshot + (it.variant_name ? ` (${it.variant_name})` : '')) : (it.description || 'Unknown Item'),
        qty:     Number(it.quantity),
        rate:    Number(it.unit_price),
        amount:  pureAmount, // Now shows 279.00 instead of 292.95
        taxRate: Number(it.tax_rate),
        hsn:     it.hsn_code || '996331',
      };
    }),
    totals: {
      gross:         Number(invoice.gross_total),
      discount:      Number(invoice.discount_total),
      taxable:       Number(invoice.taxable_value),
      cgst:          Number(invoice.cgst_amount),
      sgst:          Number(invoice.sgst_amount),
      igst:          Number(invoice.igst_amount),
      serviceCharge: Number(invoice.service_charge || 0),
      roundOff:      Number(invoice.round_off || 0),
      grand:         Number(invoice.grand_total),
      paid:          Number(invoice.amount_paid),
      balance:       Number(invoice.balance_due),
    },
    payments: (payments || []).map(p => ({
      mode:   p.mode,
      amount: Number(p.amount),
      ref:    p.reference_no || '',
    })),
    footer: {
      thanks:  'Thank you, visit again!',
      taxNote: 'GST as applicable. This is a computer-generated invoice.',
    },
  };
}

export function buildReceiptText(data) {
  const W = 48;
  const out = [];
  const push = s => out.push(s ?? '');
  const hr = (c = '-') => push(c.repeat(W));

  push(data.header.name.toUpperCase());
  if (data.header.address) push(data.header.address);
  if (data.header.phone)   push(`Ph: ${data.header.phone}`);
  if (data.header.gstin)   push(`GSTIN: ${data.header.gstin}`);
  if (data.header.fssai)   push(`FSSAI: ${data.header.fssai}`);
  hr('=');

  push(padLine(`Inv: ${data.invoice.number}`, data.invoice.date, W));
  push(padLine(`Order: ${data.invoice.orderNumber}`,
               data.invoice.orderType.replace('_',' '), W));
  if (data.invoice.table) push(`Table: ${data.invoice.table}`);
  if (data.customer.phone) push(padLine(data.customer.name || '', data.customer.phone, W));
  if (data.customer.gstin) push(`GSTIN: ${data.customer.gstin}`);
  hr('-');
  push(padLine('Item', 'Amount', W));
  hr('-');

  for (const it of data.items) {
    push(it.name);
    push(padLine(`  ${it.qty} x ${it.rate.toFixed(2)}`, it.amount.toFixed(2), W));
  }
  hr('-');

  push(padLine('Subtotal',  data.totals.gross.toFixed(2), W));
  if (data.totals.discount > 0) push(padLine('Discount', `-${data.totals.discount.toFixed(2)}`, W));
  if (data.totals.serviceCharge > 0) push(padLine('Svc Charge', data.totals.serviceCharge.toFixed(2), W));
  if (data.totals.roundOff) push(padLine('Round Off', data.totals.roundOff.toFixed(2), W));
  hr('-');
  push(padLine('TOTAL', `Rs. ${data.totals.grand.toFixed(2)}`, W));
  hr('=');

  for (const p of data.payments) {
    push(padLine(p.mode.toUpperCase(), p.amount.toFixed(2), W));
    if (p.ref) push(`  Ref: ${p.ref}`);
  }
  hr('-');
  push(data.footer.thanks);
  return out.join('\n');
}

export function buildReceiptHTML(data) {
  const rows = data.items.map(it => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${it.rate.toFixed(2)}</td>
      <td class="r">${it.amount.toFixed(2)}</td>
    </tr>`).join('');

  const payRows = data.payments.map(p => `
    <tr><td>${escapeHtml(p.mode.toUpperCase())}${p.ref ? ' • ' + escapeHtml(p.ref) : ''}</td>
        <td class="r">₹${p.amount.toFixed(2)}</td></tr>`).join('');

  const line = (label, val, cls='') =>
    `<div class="row ${cls}"><span>${escapeHtml(label)}</span><span>${val}</span></div>`;

  return `
    <div class="receipt">
      <div class="center">
        <div class="bold big">${escapeHtml(data.header.name)}</div>
        ${data.header.address ? `<div>${escapeHtml(data.header.address)}</div>` : ''}
        ${data.header.phone   ? `<div>Ph: ${escapeHtml(data.header.phone)}</div>` : ''}
        ${data.header.gstin   ? `<div>GSTIN: ${escapeHtml(data.header.gstin)}</div>` : ''}
        ${data.header.fssai   ? `<div>FSSAI: ${escapeHtml(data.header.fssai)}</div>` : ''}
      </div>
      <hr>
      <div class="row"><span>Inv: ${escapeHtml(data.invoice.number)}</span><span>${escapeHtml(data.invoice.date)}</span></div>
      <div class="row"><span>Order: ${escapeHtml(data.invoice.orderNumber)}</span><span>${escapeHtml(data.invoice.orderType.replace('_',' '))}</span></div>
      ${data.invoice.table ? `<div>Table: ${escapeHtml(data.invoice.table)}</div>` : ''}
      ${data.customer.phone ? `<div>${escapeHtml(data.customer.name)} • ${escapeHtml(data.customer.phone)}</div>` : ''}
      <hr>
      <table>
        <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <hr>
      ${line('Subtotal',  '₹' + data.totals.gross.toFixed(2))}
      ${data.totals.discount > 0 ? line('Discount', '-₹' + data.totals.discount.toFixed(2)) : ''}
      ${data.totals.roundOff ? line('Round Off', '₹' + data.totals.roundOff.toFixed(2)) : ''}
      <hr>
      <div class="row bold big"><span>TOTAL</span><span>₹${data.totals.grand.toFixed(2)}</span></div>
      <hr>
      <table>${payRows}</table>
      <hr>
      <div class="center">${escapeHtml(data.footer.thanks)}</div>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
