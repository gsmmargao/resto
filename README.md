# RestoPOS

A mobile-responsive Restaurant POS built on Vanilla JS + Tailwind + Supabase.

## Setup

1. Copy `config.example.js` → `config.js` and fill in Supabase URL + anon key.
2. Serve locally: `python3 -m http.server 5173`
3. Open http://localhost:5173

## Modules

- POS (menu + cart + variants + add-ons)
- Table Management + Floor Plan
- Real-time KOT to kitchen stations
- KDS (Kitchen Display) with alerts
- Billing + GST Invoice + ESC/POS printer
- Cash Register Shift + Reconciliation
- Reports (Sales, Items, Staff, Cash)
- Recipes + Stock Deduction
- Inventory UI + Wastage + Reorder
- Menu Admin (categories, items, variants, add-ons)
