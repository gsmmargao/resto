import { supabase } from '../supabase-client.js';
import { store } from '../store.js';

const round2 = n => Math.round(Number(n || 0) * 100) / 100;

export async function saveInvoiceAndPayments({ orderId, totals, customer, payments, tipAmount }) {
  const tenant  = store.state.tenant;
  const outlet  = store.state.outlet;
  const session = store.state.session;
  const member  = store.state.member;

  if (!tenant || !outlet) throw new Error('No tenant / outlet');

  // 1. Customer lookup / create
  let customerId = null;
  if (customer.phone) {
    const { data: existing } = await supabase
      .from('customers')
      .select('id, name, gstin')
      .eq('tenant_id', tenant.id)
      .eq('phone', customer.phone)
      .maybeSingle();

    if (existing) {
      customerId = existing.id;
      const updates = {};
      if (customer.name  && !existing.name)  updates.name  = customer.name;
      if (customer.gstin && !existing.gstin) updates.gstin = customer.gstin;
      if (Object.keys(updates).length) {
        await supabase.from('customers').update(updates).eq('id', customerId);
      }
    } else {
      const { data: created, error } = await supabase.from('customers').insert({
        tenant_id: tenant.id,
        phone:     customer.phone,
        name:      customer.name  || null,
        gstin:     customer.gstin || null,
      }).select('id').single();
      if (error) throw error;
      customerId = created.id;
    }
  }

  // 2. Fetch order items
  const { data: items, error: itErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .neq('status', 'cancelled');
  if (itErr) throw itErr;
  if (!items?.length) throw new Error('No items on order');

  // 3. Attach customer to order
  await supabase.from('orders').update({
    customer_id:    customerId,
    customer_phone: customer.phone || null,
    customer_name:  customer.name  || null,
  }).eq('id', orderId);

  // 4. Invoice number
  const { data: invNo, error: seqErr } = await supabase.rpc('next_doc_number', {
    p_outlet: outlet.id, p_doc_type: 'invoice',
  });
  if (seqErr) throw seqErr;

  // 5. Split tax into CGST/SGST (intra-state assumption)
  const cgst = round2(totals.tax / 2);
  const sgst = round2(totals.tax / 2);
  const igst = 0;

  const totalPaid    = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const grandWithTip = round2(totals.grand + Number(tipAmount || 0));

  // 6. Insert invoice
  const { data: invoice, error: invErr } = await supabase.from('invoices').insert({
    tenant_id:        tenant.id,
    outlet_id:        outlet.id,
    order_id:         orderId,
    invoice_number:   invNo,
    invoice_type:     'tax_invoice',
    place_of_supply:  outlet.state_code || null,
    is_interstate:    false,
    customer_id:      customerId,
    customer_name:    customer.name  || null,
    customer_phone:   customer.phone || null,
    customer_gstin:   customer.gstin || null,
    gross_total:      round2(totals.gross),
    discount_total:   round2(totals.discount),
    taxable_value:    round2(totals.taxable),
    cgst_amount:      cgst,
    sgst_amount:      sgst,
    igst_amount:      igst,
    service_charge:   round2(totals.serviceCharge),
    round_off:        round2(totals.roundOff),
    grand_total:      grandWithTip,
    amount_paid:      totalPaid,
    balance_due:      round2(grandWithTip - totalPaid),
    status:           totalPaid >= grandWithTip - 0.01 ? 'paid' : 'partially_paid',
    created_by:       session?.user?.id || null,
  }).select().single();
  if (invErr) throw invErr;

  // 7. Invoice items
  const invItems = items.map(it => {
    const lineTax = Number(it.tax_amount || 0);
    return {
      tenant_id:       tenant.id,
      invoice_id:      invoice.id,
      order_item_id:   it.id,
      description:     it.name_snapshot + (it.variant_name ? ` (${it.variant_name})` : ''),
      hsn_code:        it.hsn_code,
      quantity:        it.quantity,
      unit:            'NOS',
      unit_price:      it.unit_price,
      discount_amount: it.discount_amount,
      taxable_value:   it.taxable_amount,
      tax_rate:        it.tax_rate,
      cgst_amount:     round2(lineTax / 2),
      sgst_amount:     round2(lineTax / 2),
      igst_amount:     0,
      cess_amount:     0,
      line_total:      it.line_total,
    };
  });
  const { error: iiErr } = await supabase.from('invoice_items').insert(invItems);
  if (iiErr) throw iiErr;

  // 8. Payments — linked to open cash register
  const tipPerPay = payments.length ? round2(Number(tipAmount || 0) / payments.length) : 0;
  const payRows = payments.map(p => ({
    tenant_id:        tenant.id,
    outlet_id:        outlet.id,
    order_id:         orderId,
    invoice_id:       invoice.id,
    customer_id:      customerId,
    cash_register_id: store.state.cashRegister?.id || null,
    mode:             p.mode,
    amount:           round2(p.amount),
    tip_amount:       tipPerPay,
    tendered_amount:  p.tendered || null,
    change_amount:    p.tendered ? round2(Math.max(0, p.tendered - p.amount)) : null,
    reference_no:     p.reference || null,
    status:           'success',
    received_by:      member?.id || null,
    paid_at:          new Date().toISOString(),
  }));
  const { error: pErr } = await supabase.from('payments').insert(payRows);
  if (pErr) throw pErr;

  // 9. Update order
  const paidEnough = totalPaid >= grandWithTip - 0.01;
  await supabase.from('orders').update({
    status:      paidEnough ? 'paid' : 'partially_paid',
    tip_amount:  round2(tipAmount),
    cashier_id:  member?.id || null,
    billed_at:   new Date().toISOString(),
    closed_at:   paidEnough ? new Date().toISOString() : null,
  }).eq('id', orderId);

  return { invoice, items, payments: payRows, customer };
}
