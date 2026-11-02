import { store } from './store.js';

// Use window object to prevent duplicate module instances
if (!window.__ROUTER__) {
  window.__ROUTER__ = { routes: new Map() };
}
const routerState = window.__ROUTER__;

export function register(name, handler) {
  routerState.routes.set(name, handler);
  console.log(`[router] Registered: ${name}`);
}

export function navigate(name, params = {}, retries = 20) {
  if (!routerState.routes.has(name)) { 
    console.warn(`[router] Route "${name}" not ready, retrying in 50ms (${retries} left)...`);
    
    if (retries <= 0) {
      console.error(`[router] Gave up waiting for route: ${name}`);
      return;
    }
    
    setTimeout(() => navigate(name, params, retries - 1), 50);
    return; 
  }
  
  // Save state for refresh persistence
  store.patch('ui', { route: name, ...params });
  
  // Push to history so back button works
  const newHash = `#${name}`;
  if (location.hash !== newHash) {
      history.pushState({ route: name, params }, '', newHash);
  }
  
  // Save for refresh
  sessionStorage.setItem('app_route', name);
  if (Object.keys(params).length > 0) {
      sessionStorage.setItem('app_params', JSON.stringify(params));
  } else {
      sessionStorage.removeItem('app_params');
  }

  const app = document.getElementById('app-view');
  if (!app) { 
    console.warn('[router] #app-view not found, retrying in 50ms...');
    if (retries <= 0) {
      console.error('[router] Gave up waiting for #app-view');
      return;
    }
    setTimeout(() => navigate(name, params, retries - 1), 50);
    return; 
  }
  
  app.innerHTML = '';
  
  try {
    routerState.routes.get(name)(app, params);
    console.log(`[router] Navigated to: ${name}`);
  } catch (err) {
    console.error(`[router] Error rendering "${name}":`, err);
  }
}

export function initRouter(defaultRoute = 'dashboard') {
  // Browser back/forward
  window.addEventListener('popstate', () => {
    const name = location.hash.slice(1) || defaultRoute;
    const savedParams = sessionStorage.getItem('app_params');
    navigate(name, savedParams ? JSON.parse(savedParams) : {});
  });

  // Manual hash changes
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1) || defaultRoute;
    const savedParams = sessionStorage.getItem('app_params');
    navigate(name, savedParams ? JSON.parse(savedParams) : {});
  });

  // Initial navigation
  const lastRoute = sessionStorage.getItem('app_route') || location.hash.slice(1) || defaultRoute;
  const savedParams = sessionStorage.getItem('app_params');
  navigate(lastRoute, savedParams ? JSON.parse(savedParams) : {});
}
