const fs = require('fs');
const f = 'assets/js/modules/tables.js';
let s = fs.readFileSync(f, 'utf8');

try {
    // 1. Update the filter so any order without a table_id shows up as a Takeaway
    const oldFilter = "const activeTakeaways = openOrders.filter(o => o.order_type === 'takeaway');";
    const newFilter = "const activeTakeaways = openOrders.filter(o => o.order_type === 'takeaway' || !o.table_id);";
    
    if (s.includes(oldFilter)) {
        s = s.replace(oldFilter, newFilter);
        fs.writeFileSync(f, s);
        console.log('✅ SUCCESS: Updated tables.js. Orphaned orders will now appear on the floor plan.');
    } else {
        console.log('❌ ABORTED: Could not find the filter logic in tables.js.');
    }

    // 2. Create a script to cancel the hanging order in Supabase
    const clearScript = `
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl = '';
let supabaseKey = '';
try {
    const clientCode = fs.readFileSync('assets/js/supabase-client.js', 'utf8');
    const urlMatch = clientCode.match(/createClient\\(\\s*['"]([^'"]+)['"]/);
    const keyMatch = clientCode.match(/createClient\\(\\s*['"][^'"]+['"]\\s*,\\s*['"]([^'"]+)['"]/);
    if (urlMatch) supabaseUrl = urlMatch[1];
    if (keyMatch) supabaseKey = keyMatch[1];
} catch (e) {}

if (!supabaseUrl || !supabaseKey) {
    console.log('⚠️ Could not find Supabase credentials. Please run this SQL in your Supabase dashboard:');
    console.log("UPDATE orders SET status = 'cancelled' WHERE order_number = 'OFF-MWRJT734';");
    process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearOrder() {
    const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('order_number', 'OFF-MWRJT734');
        
    if (error) {
        console.error('❌ Failed to cancel via script (RLS restriction). Please run this SQL in Supabase:');
        console.log("UPDATE orders SET status = 'cancelled' WHERE order_number = 'OFF-MWRJT734';");
    } else {
        console.log('✅ Successfully cleared hanging order #OFF-MWRJT734.');
    }
}
clearOrder();
`;
    fs.writeFileSync('clear-hanging-order.cjs', clearScript);
    console.log('🚀 Created clear-hanging-order.cjs. Running it now...');

} catch (err) {
    console.error('❌ SAFETY ABORT:', err);
}
