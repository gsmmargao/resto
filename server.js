const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let printer = null;
try {
  printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: '/dev/usb/lp1',
    characterSet: 'SLOVENIA',
    removeSpecialCharacters: true,
    lineCharacter: '-',
    width: 42, 
  });
  console.log('✅ Thermal Printer Interface Initialized');
} catch (e) {
  console.log('⚠️ Printer not found. Check USB connection.');
}

function formatKOTDate(waiterName) {
  const d = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return `${time} ${weekday} ${day}${month}${year} . ${waiterName || 'admin'}`;
}

// ==========================================
// 1. KOT PRINT ENDPOINT
// ==========================================
app.post('/api/print-kot', async (req, res) => {
  const { kot, items, tableName, waiterName } = req.body;
  console.log(`[Received] KOT Request for Table: ${tableName}`);
  
  if (!printer) return res.status(500).send({ error: 'Printer not connected.' });

  try {
    printer.clear();
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.setTextDoubleWidth();
    printer.println(`KOT ${kot}`);
    printer.println(`Table ${tableName}`);
    
    printer.setTextNormal();
    printer.bold(false);
    printer.println(formatKOTDate(waiterName));
    printer.drawLine();

    printer.alignLeft();
    items.forEach(it => {
      printer.bold(true);
      printer.setTextDoubleHeight();
      printer.setTextDoubleWidth();
      printer.println(`${it.quantity}x ${it.name}`);
      
      printer.setTextNormal();
      printer.bold(false);
      
      if (it.variant) printer.println(`   > ${it.variant}`);
      if (it.notes) printer.println(`   * ${it.notes}`);
      printer.newLine();
    });

    printer.drawLine();
    printer.newLine();
    printer.newLine();
    printer.cut();
    
    await printer.execute();
    console.log(`✅ [Printed] KOT: ${kot} | Table: ${tableName}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Print error:', err);
    res.status(500).send({ error: err.message });
  }
});

// ==========================================
// 2. BILL PRINT ENDPOINT
// ==========================================
app.post('/api/print-bill', async (req, res) => {
  const { header, invoice, items, totals, payments, customer } = req.body;
  console.log(`[Received] Bill Request: ${invoice?.number}`);
  
  if (!printer) return res.status(500).send({ error: 'Printer not connected.' });

  try {
    printer.clear();
    
    // Header
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.setTextDoubleWidth();
    printer.println(header?.name || 'RESTAURANT');
    
    printer.setTextNormal();
    printer.bold(false);
    if (header?.address) printer.println(header.address);
    if (header?.phone) printer.println(`PH: ${header.phone}`);
    
    printer.newLine();
    printer.alignLeft();
    printer.println(`Table ${invoice?.table || '-'} ${invoice?.date}`);
    printer.println(`Bill ID: ${invoice?.number} Customer : ${customer?.name || ''}`);
    
    printer.newLine();
    printer.bold(true);
    printer.println('FOOD & BEVERAGE');
    printer.bold(false);
    printer.drawLine();
    
    printer.println('Item                  Qt    Rate     Amt');
    printer.drawLine();

    items.forEach(it => {
      printer.bold(true);
      let name = it.name.length > 18 ? it.name.substring(0, 18) : it.name.padEnd(18, ' ');
      printer.print(name);
      
      printer.bold(false);
      let qty = String(it.qty).padEnd(5, ' ');
      let rate = Number(it.rate).toFixed(2).padStart(8, ' ');
      let amt = Number(it.amount).toFixed(2).padStart(8, ' ');
      printer.println(`${qty}${rate}${amt}`);
    });
    
    printer.drawLine();
    
    printer.leftRight('Food and Beverage:', Number(totals?.grand || 0).toFixed(0));
    
    printer.drawLine();
    
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println(`Grand Total: Rs. ${Number(totals?.grand || 0).toFixed(2)}`);
    
    printer.setTextNormal();
    printer.bold(false);
    printer.println('Thank You ! Visit Again !');
    
    printer.alignLeft();
    printer.println('FSSAI: 10626002000038');
    
    printer.newLine();
    printer.newLine();
    printer.cut();
    
    await printer.execute();
    console.log(`✅ [Printed] Bill: ${invoice?.number}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Bill Print error:', err);
    res.status(500).send({ error: err.message });
  }
});

// ==========================================
// START HTTPS SERVER
// ==========================================
const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

https.createServer(options, app).listen(3000, '0.0.0.0', () => {
  console.log('🚀 Local HTTPS Server running on https://0.0.0.0:3000');
});
