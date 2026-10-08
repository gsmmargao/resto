import { CONFIG } from '../../config.js';

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class')      node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return node;
}

export function fmtMoney(n) {
  const val = Number(n || 0);
  return new Intl.NumberFormat(CONFIG.LOCALE, {
    style: 'currency', currency: CONFIG.CURRENCY, minimumFractionDigits: 2,
  }).format(val);
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(CONFIG.LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  return `${Math.floor(s/3600)}h`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

export function toast(msg, type = 'info', ms = 3000) {
  const colors = {
    info:    'bg-slate-800 text-white',
    success: 'bg-emerald-600 text-white',
    error:   'bg-red-600 text-white',
    warn:    'bg-amber-500 text-black',
  };
  const box = el('div', {
    class: `fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 opacity-0 translate-y-[-8px] ${colors[type]}`,
  }, msg);
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.remove('opacity-0', 'translate-y-[-8px]'));
  setTimeout(() => {
    box.classList.add('opacity-0', 'translate-y-[-8px]');
    setTimeout(() => box.remove(), 320);
  }, ms);
}

export function confirmDialog(message, title = 'Confirm') {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-4' });
    const card = el('div', { class: 'bg-white rounded-xl shadow-2xl w-full max-w-sm p-5' }, [
      el('h3', { class: 'text-lg font-semibold text-slate-800 mb-2' }, title),
      el('p',  { class: 'text-slate-600 text-sm mb-5 whitespace-pre-line' }, message),
      el('div', { class: 'flex justify-end gap-2' }, [
        el('button', {
          class: 'px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
          onclick: () => { overlay.remove(); resolve(false); },
        }, 'Cancel'),
        el('button', {
          class: 'px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium',
          onclick: () => { overlay.remove(); resolve(true); },
        }, 'Confirm'),
      ]),
    ]);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

export function logoutAndReload() {
  sessionStorage.clear();
  location.reload();
}
