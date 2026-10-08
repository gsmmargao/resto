import { CONFIG } from '../../config.js';
import { store } from './store.js';
import { $, el, toast, logoutAndReload } from './utils.js';
import { getSession, signIn, signOut, loadContext, onAuthChange } from './auth.js';
import { initRouter, register, navigate } from './router.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderKDS } from './modules/kds.js';
import { renderCash, loadOpenShift } from './modules/cash.js';
import { renderReports } from './modules/reports.js';
import { renderStock } from './modules/stock.js';
import { renderMenuAdmin } from './modules/admin/menu-admin.js';
import { renderStaffAdmin } from './modules/admin/staff-admin.js';
import { renderFloorAdmin } from './modules/admin/floor-admin.js';
import { renderSupplierAdmin } from './modules/admin/supplier-admin.js';
import { renderPurchaseAdmin } from './modules/admin/purchase-admin.js';
import { renderIngredientAdmin } from './modules/admin/ingredient-admin.js';
import { renderRecipeAdmin } from './modules/admin/recipe-admin.js';
import { renderLoyaltyAdmin } from './modules/admin/loyalty-admin.js';
import { renderTemplateAdmin } from './modules/admin/template-admin.js';
import { buildOutletSwitcher } from './modules/outlet-switcher.js';
import { startMonitoring, buildConnectionBadge, openQueueModal, sync } from './modules/offline-sync.js';
import { renderCustomerDisplay } from './modules/customer-display.js';
import { loadCatalog } from './modules/menu.js';

function renderLogin(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6' });

  card.appendChild(el('div', { class: 'text-center mb-6' }, [
    el('div', { class: 'text-2xl font-bold text-slate-900' }, CONFIG.APP_NAME),
    el('div', { class: 'text-sm text-slate-500 mt-1' }, 'Restaurant POS'),
  ]));

  const email = el('input', {
    type: 'email', placeholder: 'you@restaurant.com', autocomplete: 'email',
    class: 'w-full px-3 py-2.5 rounded-lg border border-slate-300 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });
  const pass = el('input', {
    type: 'password', placeholder: 'Password', autocomplete: 'current-password',
    class: 'w-full px-3 py-2.5 rounded-lg border border-slate-300 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
  });
  const btn = el('button', {
    class: 'w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition',
  }, 'Sign in');

  async function doLogin() {
    btn.disabled = true; btn.textContent = 'Signing in…';
    try { await signIn(email.value.trim(), pass.value); }
    catch (e) { toast(e.message || 'Sign-in failed', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  }
  btn.addEventListener('click', doLogin);
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  card.appendChild(email);
  card.appendChild(pass);
  card.appendChild(btn);
  card.appendChild(el('div', { class: 'text-xs text-slate-400 text-center mt-4' }, 'Contact admin if you cannot sign in'));
  wrap.appendChild(card);
  root.appendChild(wrap);
  setTimeout(() => email.focus(), 50);
}

function renderShell(root) {
  root.innerHTML = '';
  const shell = el('div', { class: 'h-screen flex flex-col bg-slate-100' });

  const canManage = ['owner','admin','manager'].includes(store.state.member?.role);

  const navBtns = [
    el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap',
      onclick: () => navigate('dashboard'),
    }, 'POS'),
    el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap',
      onclick: () => navigate('kds'),
    }, 'Kitchen'),
    el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap',
      onclick: () => navigate('cash'),
    }, 'Cash'),
    el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap',
      onclick: () => navigate('stock'),
    }, 'Stock'),
    el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap',
      onclick: () => navigate('reports'),
    }, 'Reports'),
  ];

  if (canManage) {
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('menu-admin'),
    }, '⚙ Menu'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('staff-admin'),
    }, '👥 Staff'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('floor-admin'),
    }, '🪑 Floor'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('supplier-admin'),
    }, '🚚 Suppliers'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('purchase-admin'),
    }, '📦 Purchases'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('ingredient-admin'),
    }, '🥕 Ingredients'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('recipe-admin'),
    }, '📖 Recipes'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('loyalty-admin'),
    }, '🎁 Loyalty'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-xs font-semibold whitespace-nowrap',
      onclick: () => navigate('template-admin'),
    }, '💬 Templates'));
    navBtns.push(el('button', {
      class: 'px-2.5 py-1 rounded-lg bg-slate-600 hover:bg-slate-500 text-xs font-semibold whitespace-nowrap',
      onclick: () => openCustomerDisplayWindow(),
      title: 'Open customer display in a separate window',
    }, '🖥️ Display'));
  }

  const topbar = el('div', { class: 'flex items-center justify-between px-4 py-2 bg-slate-900 text-white overflow-x-auto' }, [
    el('div', { class: 'flex items-center gap-3 shrink-0' }, [
      el('span', { class: 'font-semibold text-base' }, store.state.tenant?.name || CONFIG.APP_NAME),
      buildOutletSwitcher(),
    ]),
    el('div', { class: 'flex items-center gap-1.5 text-sm shrink-0' }, [
      ...navBtns,
      el('span', { class: 'text-slate-300 hidden lg:inline ml-2' }, store.state.profile?.full_name || store.state.session?.user?.email || ''),
      el('span', { class: 'px-2 py-0.5 rounded-full bg-indigo-600 text-[10px] uppercase font-semibold tracking-wide' }, store.state.member?.role || ''),
      buildConnectionBadge(() => openQueueModal()),
      el('button', {
        class: 'text-slate-300 hover:text-white text-xs ml-2',
        onclick: async () => { if (confirm('Sign out?')) { await signOut(); logoutAndReload(); } },
      }, 'Sign out'),
    ]),
  ]);

  const view = el('div', { id: 'app-view', class: 'flex-1 min-h-0' });

  shell.appendChild(topbar);
  shell.appendChild(view);
  root.appendChild(shell);

  register('dashboard', renderDashboard);
  register('kds', renderKDS);
  register('cash', renderCash);
  register('stock', renderStock);
  register('reports', renderReports);
  register('menu-admin', renderMenuAdmin);
  register('staff-admin', renderStaffAdmin);
  register('floor-admin', renderFloorAdmin);
  register('supplier-admin', renderSupplierAdmin);
  register('purchase-admin', renderPurchaseAdmin);
  register('ingredient-admin', renderIngredientAdmin);
  register('recipe-admin', renderRecipeAdmin);
  register('loyalty-admin', renderLoyaltyAdmin);
  register('template-admin', renderTemplateAdmin);
  register('customer-display', renderCustomerDisplay);
  initRouter('dashboard');
}

async function boot() {
  const root = $('#app');

  // ---- Public QR self-order route (no login required) ----
  if (location.hash.startsWith('#order')) {
    const { renderPublicOrder } = await import('./modules/public-order.js');
    await renderPublicOrder(root);
    return;
  }

  // ---- Customer display screen (no login required; data comes via BroadcastChannel) ----
  if (location.hash.startsWith('#customer-display')) {
    await renderCustomerDisplay(root);
    return;
  }

  const session = await getSession();
  if (!session) { renderLogin(root); return; }

  const ctx = await loadContext();
  if (!ctx || !ctx.member) {
    toast('Could not load your tenant membership', 'error');
    await signOut();
    renderLogin(root);
    return;
  }

  startMonitoring();

  await loadCatalog();
  await loadOpenShift();

  renderShell(root);

  // Attempt to drain any pending operations from a prior offline session
  setTimeout(() => sync(), 1500);
}

onAuthChange(async (event) => {
  if (event === 'SIGNED_IN') {
    const ctx = await loadContext();
    if (ctx?.member) {
      await loadCatalog();
      await loadOpenShift();
      renderShell($('#app'));
    }
  }
  if (event === 'SIGNED_OUT') { renderLogin($('#app')); }
});



function openCustomerDisplayWindow() {
  const w = 900, h = 900;
  const left = window.screen.availWidth - w;
  const top = 0;
  const features = `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`;
  const win = window.open('./#customer-display', 'restoCustomerDisplay', features);
  if (!win) {
    alert('Popup blocked. Please allow popups for this site to open the customer display.');
    return;
  }
  win.focus();
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<div class="p-6 text-red-600 font-mono text-sm">Boot error: ${err.message}</div>`;
});
