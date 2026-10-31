import { padLine } from './escpos.js';
import { CONFIG } from '../../../config.js';

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function buildReceiptData({ tenant, outlet, order, items, invoice, payments, customer, tableName }) {
  const rawTable = tableName || order?.table_name_snapshot || '';
  const isTakeaway = rawTable.toLowerCase().includes('take') || order?.order_type === 'takeaway';
  const cleanTableName = rawTable.split(' - ')[0].trim();

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
      date:        new Date(invoice.invoice_time || invoice.created_at).toLocaleString(CONFIG.LOCALE),
      orderNumber: order?.order_number || '',
      isTakeaway:  isTakeaway,
      table:       cleanTableName,
    },
    customer: {
      name:  customer?.name  || invoice.customer_name || '',
      phone: customer?.phone || invoice.customer_phone || '',
      gstin: customer?.gstin || invoice.customer_gstin || '',
    },
    items: (items || []).map(it => {
      // FIX: Force the amount to be the pure base price (Rate x Qty) so tax isn't silently added here
      const pureAmount = Number(it.unit_price || 0) * Number(it.quantity || 0);

      return {
        name:    it.name_snapshot ? (it.name_snapshot + (it.variant_name ? ` (${it.variant_name})` : '')) : (it.description || 'Unknown Item'),
        qty:     Number(it.quantity),
        rate:    Number(it.unit_price),
        amount:  pureAmount,
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
  push(padLine(`Order: ${data.invoice.orderNumber}`, data.invoice.isTakeaway ? '' : 'Dine In', W));
  
  if (data.invoice.table) {
      if (data.invoice.isTakeaway) {
          const custName = data.customer.name || data.invoice.table;
          push(`Take-away: ${custName}`);
      } else {
          push(`Table: ${data.invoice.table}`);
      }
  }
  
  // FIX: Don't print the name twice if it's a takeaway
  if (data.customer.phone) {
      if (data.invoice.isTakeaway) {
          push(`Ph: ${data.customer.phone}`);
      } else {
          push(padLine(data.customer.name || '', data.customer.phone, W));
      }
  }
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
  if (data.totals.cgst > 0) push(padLine('CGST', data.totals.cgst.toFixed(2), W));
  if (data.totals.sgst > 0) push(padLine('SGST', data.totals.sgst.toFixed(2), W));
  if (data.totals.igst > 0) push(padLine('IGST', data.totals.igst.toFixed(2), W));
  if (data.totals.serviceCharge > 0) push(padLine('Svc Charge', data.totals.serviceCharge.toFixed(2), W));
  if (data.totals.roundOff) push(padLine('Round Off', data.totals.roundOff.toFixed(2), W));
  hr('-');
  push(padLine('TOTAL', `Rs. ${data.totals.grand.toFixed(2)}`, W));
  hr('=');

  for (const p of data.payments) {
    push(padLine(p.mode.toUpperCase(), p.amount.toFixed(2), W));
    if (p.ref) push(`  Ref: ${p.ref}`);
  }
  
  if (data.totals.balance > 0) {
    hr('-');
    push(padLine('BALANCE DUE', data.totals.balance.toFixed(2), W));
  }
  
  hr('-');
  push(data.footer.thanks);
  return out.join('\n');
}

export function buildReceiptHTML(data) {
  const rows = data.items.map(it => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">${it.rate.toFixed(2)}</td>
      <td style="text-align:right">${it.amount.toFixed(2)}</td>
    </tr>
  `).join('');

  const line = (label, val) => `
    <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
      <span>${label}</span><span>${val}</span>
    </div>
  `;

  return `
    <div style="font-family:monospace; width:300px; margin:0 auto; padding:10px; background:#fff; color:#000;">
      <div style="text-align:center; margin-bottom:10px;">
        <div style="font-weight:bold; font-size:1.2em;">${data.header.name}</div>
        ${data.header.address ? `<div>${data.header.address}</div>` : ''}
        ${data.header.phone ? `<div>Ph: ${data.header.phone}</div>` : ''}
      </div>
      <div style="border-bottom:1px dashed #000; margin:5px 0;"></div>
      
      <div>Inv: ${data.invoice.number} <span style="float:right">${data.invoice.date}</span></div>
      <div>Order: ${data.invoice.orderNumber} ${data.invoice.isTakeaway ? '' : '<span style="float:right">Dine In</span>'}</div>
      ${data.invoice.table ? `<div>${data.invoice.isTakeaway ? 'Take-away: ' + (data.customer.name || data.invoice.table) : 'Table: ' + data.invoice.table}</div>` : ''}
      
      ${data.customer.phone ? `<div>${!data.invoice.isTakeaway ? data.customer.name + ' • ' : ''}${data.customer.phone}</div>` : ''}
      <div style="border-bottom:1px dashed #000; margin:5px 0;"></div>
      
      <table style="width:100%; font-size:0.9em; margin-bottom:5px;">
        <thead><tr><th style="text-align:left">Item</th><th>Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      
      <div style="border-bottom:1px dashed #000; margin:5px 0;"></div>
      
      ${line('Subtotal', '₹' + data.totals.gross.toFixed(2))}
      ${data.totals.discount > 0 ? line('Discount', '-₹' + data.totals.discount.toFixed(2)) : ''}
      ${data.totals.cgst > 0 ? line('CGST', '₹' + data.totals.cgst.toFixed(2)) : ''}
      ${data.totals.sgst > 0 ? line('SGST', '₹' + data.totals.sgst.toFixed(2)) : ''}
      ${data.totals.igst > 0 ? line('IGST', '₹' + data.totals.igst.toFixed(2)) : ''}
      ${data.totals.serviceCharge > 0 ? line('Svc Charge', '₹' + data.totals.serviceCharge.toFixed(2)) : ''}
      ${data.totals.roundOff !== 0 ? line('Round Off', data.totals.roundOff.toFixed(2)) : ''}
      
      <div style="border-bottom:1px dashed #000; margin:5px 0;"></div>
      
      <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.1em; margin-bottom:5px;">
        <span>TOTAL</span><span>₹${data.totals.grand.toFixed(2)}</span>
      </div>
      
      ${data.payments.map(p => line(p.mode.toUpperCase(), '₹' + p.amount.toFixed(2))).join('')}
      ${data.totals.balance > 0 ? `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top:5px; color:red;"><span>BALANCE DUE</span><span>₹${data.totals.balance.toFixed(2)}</span></div>` : ''}
      
      <div style="border-bottom:1px dashed #000; margin:10px 0;"></div>
      <div style="text-align:center; font-size:0.8em;">${data.footer.thanks}</div>
    </div>
  `;
}
