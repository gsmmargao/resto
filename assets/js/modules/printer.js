import { ESCPOSBuilder, padLine } from './escpos.js';
import { toast } from '../utils.js';

// ============================================================
// STATE
// ============================================================
let usbDevice = null;
let serialPort = null;
let serialWriter = null;

const PRINTER_FILTERS = [
  { vendorId: 0x04b8 },   // Epson
  { vendorId: 0x0519 },   // Star Micronics
  { vendorId: 0x1504 },   // Bixolon
  { vendorId: 0x154f },   // SNBC
  { vendorId: 0x1fc9 },   // Custom
  { vendorId: 0x20d1 },   // Rongta
  { vendorId: 0x28e9 },   // XPrinter
  { vendorId: 0x0fe6 },   // Gprinter
  { vendorId: 0x0493 },   // TVS
  { vendorId: 0x067b },   // Prolific USB-Serial
];

const BRIDGE_URL = 'http://localhost:9100';

// ============================================================
// WEBUSB
// ============================================================
export async function connectUSB() {
  if (!('usb' in navigator)) {
    toast('WebUSB not supported — use Chrome or Edge', 'warn');
    return null;
  }
  try {
    usbDevice = await navigator.usb.requestDevice({ filters: PRINTER_FILTERS });
    await usbDevice.open();
    if (usbDevice.configuration === null) await usbDevice.selectConfiguration(1);
    const iface = usbDevice.configuration.interfaces[0];
    await usbDevice.claimInterface(iface.interfaceNumber);

    const endpoint = iface.alternates[0].endpoints.find(
      e => e.direction === 'out' && e.type === 'bulk'
    );
    if (!endpoint) throw new Error('No bulk OUT endpoint found');
    usbDevice._endpointNumber = endpoint.endpointNumber;

    toast(`Connected: ${usbDevice.productName || 'USB Printer'}`, 'success');
    return usbDevice;
  } catch (e) {
    console.error('[printer] USB connect failed:', e);
    toast('USB connection cancelled or failed', 'error');
    return null;
  }
}

export async function printUSB(bytes) {
  if (!usbDevice) throw new Error('No USB printer connected');
  await usbDevice.transferOut(usbDevice._endpointNumber, bytes);
}

export function isUSBConnected() { return !!usbDevice; }

export async function disconnectUSB() {
  if (usbDevice) {
    try { await usbDevice.close(); } catch {}
    usbDevice = null;
  }
}

// ============================================================
// WEBSERIAL
// ============================================================
export async function connectSerial() {
  if (!('serial' in navigator)) {
    toast('WebSerial not supported — use Chrome or Edge', 'warn');
    return null;
  }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    serialWriter = serialPort.writable.getWriter();
    toast('Serial printer connected', 'success');
    return serialPort;
  } catch (e) {
    console.error('[printer] Serial connect failed:', e);
    toast('Serial connection cancelled or failed', 'error');
    return null;
  }
}

export async function printSerial(bytes) {
  if (!serialWriter) throw new Error('No serial printer connected');
  await serialWriter.write(bytes);
}

export function isSerialConnected() { return !!serialWriter; }

// ============================================================
// LOCAL BRIDGE
// ============================================================
export async function checkBridge() {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function printViaBridge(base64Bytes) {
  const res = await fetch(`${BRIDGE_URL}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: base64Bytes }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Bridge print failed: ' + err);
  }
}

// ============================================================
// BROWSER FALLBACK
// ============================================================
export function printHTML(html) {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) { toast('Popup blocked — allow popups to print', 'warn'); return; }
  w.document.write(`
    <!doctype html><html><head><title>Receipt</title>
      <style>
        @page { size: 80mm auto; margin: 2mm; }
        body { font-family: 'Courier New', monospace; font-size: 11px; margin: 0; padding: 4px; }
        .receipt { width: 72mm; }
        .center { text-align: center; }
        .r { text-align: right; }
        .row { display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 1px 0; font-size: 11px; }
        th { text-align: left; border-bottom: 1px dashed #000; }
        hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
        .bold { font-weight: bold; }
        .big { font-size: 13px; }
      </style>
    </head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
}

export function downloadEscPos(bytes, filename = 'receipt.bin') {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// ESC/POS RECEIPT BUILDER
// ============================================================
export function buildReceiptBytes(data) {
  const W = 48;
  const b = new ESCPOSBuilder({ width: W });

  b.init();
  b.align('center').bold(true).doubleHeight(true).doubleWidth(true);
  b.line(data.header.name.toUpperCase());
  b.size(true).bold(false);
  if (data.header.address) b.line(data.header.address);
  if (data.header.phone)   b.line(`Ph: ${data.header.phone}`);
  if (data.header.gstin)   b.line(`GSTIN: ${data.header.gstin}`);
  if (data.header.fssai)   b.line(`FSSAI: ${data.header.fssai}`);

  b.align('left').hr('=');
  b.line(padLine(`Inv: ${data.invoice.number}`, data.invoice.date, W));
  b.line(padLine(`Order: ${data.invoice.orderNumber}`,
                 data.invoice.orderType.replace('_',' '), W));
  if (data.invoice.table) b.line(`Table: ${data.invoice.table}`);
  if (data.customer.phone) b.line(padLine(data.customer.name || '', data.customer.phone, W));
  if (data.customer.gstin) b.line(`GSTIN: ${data.customer.gstin}`);
  b.hr('-');
  b.line(padLine('Item', 'Amount', W));
  b.hr('-');

  for (const it of data.items) {
    b.line(it.name);
    b.line(padLine(`  ${it.qty} x ${it.rate.toFixed(2)}`, it.amount.toFixed(2), W));
  }
  b.hr('-');

  b.line(padLine('Subtotal', data.totals.gross.toFixed(2), W));
  if (data.totals.discount > 0)
    b.line(padLine('Discount', `-${data.totals.discount.toFixed(2)}`, W));
//   b.line(padLine('Taxable',  data.totals.taxable.toFixed(2), W));
//   if (data.totals.cgst > 0) b.line(padLine('CGST', data.totals.cgst.toFixed(2), W));
//   if (data.totals.sgst > 0) b.line(padLine('SGST', data.totals.sgst.toFixed(2), W));
  if (data.totals.igst > 0) b.line(padLine('IGST', data.totals.igst.toFixed(2), W));
  if (data.totals.serviceCharge > 0)
    b.line(padLine('Svc Charge', data.totals.serviceCharge.toFixed(2), W));
  if (data.totals.roundOff)
    b.line(padLine('Round Off', data.totals.roundOff.toFixed(2), W));
  b.hr('-');
  b.bold(true);
  b.line(padLine('TOTAL', `Rs. ${data.totals.grand.toFixed(2)}`, W));
  b.bold(false).hr('=');

  for (const p of data.payments) {
    b.line(padLine(p.mode.toUpperCase(), p.amount.toFixed(2), W));
    if (p.ref) b.line(`  Ref: ${p.ref}`);
  }
  b.hr('-').align('center');
  b.line(data.footer.thanks);
  b.feed(3).cut();
  return b.bytes();
}

// ============================================================
// CASH DRAWER KICK
// ============================================================
export function buildDrawerKickBytes() {
  return new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
}

export async function openCashDrawer() {
  const bytes = buildDrawerKickBytes();
  try {
    if (isUSBConnected()) {
      await printUSB(bytes);
    } else if (isSerialConnected()) {
      await printSerial(bytes);
    } else if (await checkBridge()) {
      await printViaBridge(uint8ToBase64(bytes));
    } else {
      toast('No printer connected', 'warn');
    }
  } catch (e) {
    console.error('[printer] Drawer kick failed:', e);
  }
}

// ============================================================
// HELPERS
// ============================================================
export function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ============================================================
// KOT PRINTING (Kitchen Order Ticket)
// ============================================================
export function buildKOTBytes({ kot, items, tableName, waiterName, orderType }) {
  const W = 48;
  const b = new ESCPOSBuilder({ width: W });

  b.init();
  
  // Header
  b.align('center').bold(true).doubleHeight(true).doubleWidth(true);
  b.line('KITCHEN ORDER');
  b.size(true).bold(false);
  b.hr('=');

  // Metadata
  b.align('left').bold(true);
  b.line(padLine(`KOT: ${kot.kot_number}`, tableName ? `Table: ${tableName}` : orderType.toUpperCase(), W));
  b.bold(false);
  b.line(padLine(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), waiterName ? `Waiter: ${waiterName}` : '', W));
  b.hr('-');

  // Items
  for (const it of items) {
    b.bold(true).doubleHeight(true);
    b.line(`${Number(it.quantity)} x ${it.name_snapshot}`);
    b.doubleHeight(false).bold(false);
    
    if (it.variant_name) b.line(`   > ${it.variant_name}`);
    if (it.notes) b.line(`   * ${it.notes}`);
    b.line(); // spacing
  }

  b.hr('=');
  b.align('center');
  b.line('PLEASE PREPARE');
  b.feed(3).cut();

  return b.bytes();
}

export async function printKOT(kotData) {
  if (!isUSBConnected()) {
    console.warn('[printer] KOT not printed: No USB printer connected');
    return false;
  }
  try {
    const bytes = buildKOTBytes(kotData);
    await printUSB(bytes);
    return true;
  } catch (err) {
    console.error('[printer] KOT print failed:', err);
    return false;
  }
}
