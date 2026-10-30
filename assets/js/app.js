import { CONFIG } from '../../config.js';
import { store } from './store.js';
import { $, el, toast, logoutAndReload } from './utils.js';
import { getSession, signIn, signOut, loadContext, onAuthChange } from './auth.js';
import { initRouter, register, navigate } from './router.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderKDS } from './modules/kds.js';
import { renderCash, loadOpenShift } from './modules/cash.js';
import { renderUpiBook } from './modules/upi-book.js';
import { renderReports } from './modules/reports.js';
import { renderTipsAdmin } from './modules/admin/tips-admin.js';
import { renderStock } from './modules/stock.js';
import { renderStoreKeeper } from './modules/storekeeper.js';
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
import { renderSignup } from './modules/signup.js';
import { renderSuperAdmin } from './modules/admin/super-admin.js';
import { renderBillingUpgrade } from './modules/admin/billing-upgrade.js';
import { loadEntitlements, buildPlanBadge, maybeTrialBanner, isReadOnly, isTrialExpiringSoon, isTrialExpired } from './modules/entitlements.js';
import { navigate as navTo } from './router.js';
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
  card.appendChild(el('div', { class: 'text-center mt-5 pt-5 border-t border-slate-100' }, [
    el('span', { class: 'text-xs text-slate-500' }, 'New here? '),
    el('a', {
      href: '#signup',
      class: 'text-sm font-semibold text-indigo-600 hover:text-indigo-800',
      onclick: (e) => { e.preventDefault(); location.hash = '#signup'; location.reload(); },
    }, 'Create your restaurant →'),
  ]));
  wrap.appendChild(card);
  root.appendChild(wrap);
  setTimeout(() => email.focus(), 50);
}

function renderShell(root) {
  root.innerHTML = '';
  const shell = el('div', { class: 'h-screen flex flex-col bg-slate-100' });
  
  const topbar = el('div', { id: 'app-topbar', class: 'flex items-center justify-between px-4 py-2 bg-slate-900 text-white overflow-x-auto' });
  const navBtnCls = 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium whitespace-nowrap';
  
  function paintTopbar() {
    topbar.innerHTML = '';
    
    const isSuperAdmin = store.state.profile?.is_super_admin;

    if (isSuperAdmin) {
      topbar.appendChild(el('div', { class: 'flex items-center gap-3 shrink-0' }, [
        el('div', { class: 'font-bold text-lg text-amber-400 flex items-center gap-2' }, '🛡 Resto SaaS Admin'),
        el('span', { class: 'text-xs text-slate-400 border-l border-slate-700 pl-3' }, 'Platform Management'),
      ]));

      topbar.appendChild(el('div', { class: 'flex items-center gap-2 text-sm shrink-0' }, [
        el('button', {
          class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium transition',
          onclick: () => navigate('dashboard'),
        }, '← Exit to POS'),
        el('span', { class: 'text-slate-300 hidden sm:inline ml-2' }, store.state.profile?.full_name || store.state.session?.user?.email || ''),
        el('button', {
          class: 'text-red-400 hover:text-red-300 text-xs ml-2 font-medium',
          onclick: async () => { if (confirm('Sign out?')) { await signOut(); logoutAndReload(); } },
        }, 'Sign out'),
      ]));

    } else {
      topbar.appendChild(el('div', { class: 'flex items-center gap-3 shrink-0' }, [
        el('span', { class: 'font-semibold text-base' }, store.state.tenant?.name || CONFIG.APP_NAME),
        buildOutletSwitcher(),
      ]));

      const role = store.state.member?.role;
      const canManage = ['owner','admin','manager'].includes(role);
      
      const navBtns = [];
      
      // WAITER gets minimal tabs
      if (role === 'waiter') {
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('dashboard') }, 'POS'));
      } 
      // STORE KEEPER gets only Stock Balance
      else if (role === 'store_keeper') {
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('stock-balance') }, '📋 Stock Balance'));
      }
      // OWNER / MANAGER / CASHIER get normal tabs
      else {
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('dashboard') }, 'POS'));
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('kds') }, 'Kitchen'));
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('cash') }, 'Counter'));
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('stock') }, 'Stock'));
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('reports') }, 'Reports'));
        navBtns.push(el('button', { class: navBtnCls, onclick: () => navigate('tips-admin') }, 'Tips'));
      }

      if (canManage) {
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('menu-admin') }, '⚙ Menu'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('staff-admin') }, '👥 Staff'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('floor-admin') }, '🪑 Floor'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('supplier-admin') }, '🚚 Suppliers'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('purchase-admin') }, '📦 Purchases'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('ingredient-admin') }, '🥕 Ingredients'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-600 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('recipe-admin') }, '📖 Recipes'));
        navBtns.push(el('button', { class: 'px-2.5 py-1 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 text-xs font-semibold whitespace-nowrap', onclick: () => navigate('loyalty-admin') }, '🎁 Loyalty'));
              }

      
      topbar.appendChild(el('div', { class: 'flex items-center gap-1.5 text-sm shrink-0' }, [
        ...navBtns,
        (store.state.profile?.is_super_admin
          ? el('button', { class: 'px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold whitespace-nowrap shadow-[0_0_10px_rgba(245,158,11,0.5)]', onclick: () => navigate('super-admin') }, '🛡 Super Admin')
          : null),
        buildPlanBadge(() => navigate('billing-upgrade')),
        buildConnectionBadge(() => openQueueModal()),
        el('span', { class: 'text-slate-300 hidden lg:inline ml-2' }, store.state.profile?.full_name || store.state.session?.user?.email || ''),
        el('button', { class: 'text-slate-300 hover:text-white text-xs ml-2', onclick: async () => { if (confirm('Sign out?')) { await signOut(); logoutAndReload(); } } }, 'Sign out'),
      ].filter(Boolean)));
    }
  }

  paintTopbar();
  window.addEventListener('hashchange', paintTopbar);

  const view = el('div', { id: 'app-view', class: 'flex-1 min-h-0' });

  shell.appendChild(topbar);
  shell.appendChild(view);
  root.appendChild(shell);

  register('dashboard', renderDashboard);
  register('kds', renderKDS);
  register('cash', renderCash);
  register('upi-book', renderUpiBook);
  register('stock', renderStock);
  register('stock-balance', renderStoreKeeper);
  register('reports', renderReports);
  register('tips-admin', renderTipsAdmin);
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
  register('signup', renderSignup);
  register('super-admin', renderSuperAdmin);
  register('billing-upgrade', renderBillingUpgrade);
  
  initRouter('dashboard');
}

async function boot() {
  const root = $('#app');

  // ---- Public signup route (no login required) ----
  if (location.hash === '#signup' || location.hash === '#login') {
    if (location.hash === '#signup') {
      await renderSignup(root);
    } else {
      // Render login (fallback if hash present but session is gone)
      const session = await getSession();
      if (session) {
        const ctx = await loadContext();
        if (ctx?.member) {
          await loadCatalog();
          await loadOpenShift();
          renderShell(root);
          return;
        }
      }
      renderLogin(root);
    }
    return;
  }

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
  // If they are a super admin, bypass tenant loading entirely
  if (ctx.profile?.is_super_admin) {
    renderShell(root);
    navigate('super-admin');
    return;
  }

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

let isRendered = false;
onAuthChange(async (event) => {
  if (event === 'SIGNED_IN') {
    if (isRendered) return;
    isRendered = true;
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
