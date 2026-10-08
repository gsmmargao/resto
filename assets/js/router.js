import { store } from './store.js';

const routes = new Map();

export function register(name, handler) {
  routes.set(name, handler);
}

export function navigate(name, params = {}) {
  if (!routes.has(name)) { console.warn('Unknown route:', name); return; }
  store.patch('ui', { route: name, ...params });
  history.replaceState({ route: name, params }, '', `#${name}`);
  const app = document.getElementById('app-view');
  if (!app) return;
  app.innerHTML = '';
  routes.get(name)(app, params);
}

export function initRouter(defaultRoute = 'dashboard') {
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1) || defaultRoute;
    navigate(name);
  });
  navigate(location.hash.slice(1) || defaultRoute);
}
