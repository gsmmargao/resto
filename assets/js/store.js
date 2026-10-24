const listeners = new Map();

export const store = {
  state: {
    session: null, profile: null, member: null, tenant: null, outlet: null,
    availableOutlets: [],
    tables: [], areas: [], categories: [], menuItems: [], variants: [],
    openOrders: [], cashRegister: null,
    cart: {
      orderId: null, orderType: 'dine_in', tableId: null, guestCount: 1, items: [],
      discount: { type: 'percent', value: 0, amount: 0, name: '' },
      serviceChargePct: 0, deliveryCharge: 0, tipAmount: 0,
      totals: { gross:0, taxable:0, tax:0, discount:0, serviceCharge:0, roundOff:0, grand:0 },
    },
    ui: { route: 'dashboard', loading: false, activeTable: null, activeCategory: null, search: '' },
  },
  subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  },
  set(key, value) {
    this.state[key] = value;
    (listeners.get(key) || []).forEach(fn => fn(value, this.state));
    (listeners.get('*') || []).forEach(fn => fn(key, value, this.state));
  },
  patch(key, partial) {
    this.state[key] = { ...this.state[key], ...partial };
    (listeners.get(key) || []).forEach(fn => fn(this.state[key], this.state));
    (listeners.get('*') || []).forEach(fn => fn(key, this.state[key], this.state));
  },
};

// Expose store globally so our quick action script can access it
window.store = store;
