import { store } from '../store.js';
import { el, toast } from '../utils.js';

const STORAGE_KEY = 'resto-active-outlet';

export function getSavedOutletId() {
  return localStorage.getItem(STORAGE_KEY) || null;
}

export function saveOutletId(id) {
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
}

export function clearSavedOutlet() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Returns a DOM node. Either a static label (when only 1 outlet),
 * or a clickable button that opens a popover listing all outlets.
 */
export function buildOutletSwitcher() {
  const outlets = store.state.availableOutlets || [];
  const current = store.state.outlet;

  // Single outlet → static label, no dropdown
  if (outlets.length <= 1) {
    return el('div', { class: 'flex items-center gap-1.5 text-xs text-slate-300' }, [
      el('span', { class: 'font-medium' }, current?.name || 'No outlet'),
      current?.code ? el('span', { class: 'text-slate-500 font-mono text-[10px]' }, `(${current.code})`) : null,
    ].filter(Boolean));
  }

  const btn = el('button', {
    class: 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium transition border border-slate-700',
    title: `${outlets.length} outlets available`,
  }, [
    el('span', { class: 'text-[10px]' }, '🏢'),
    el('span', { class: 'hidden sm:inline' }, current?.name || 'Select outlet'),
    el('span', { class: 'sm:hidden' }, current?.code || 'Outlet'),
    el('span', { class: 'text-[9px] opacity-70 ml-0.5' }, '▾'),
  ]);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPopover(btn);
  });

  return btn;
}

function openPopover(anchor) {
  const outlets = store.state.availableOutlets || [];
  const current = store.state.outlet;
  const rect = anchor.getBoundingClientRect();

  const popover = el('div', {
    class: 'fixed z-[200] bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 min-w-[260px] max-h-[70vh] overflow-y-auto',
    style: `left: ${Math.min(rect.left, window.innerWidth - 280)}px; top: ${rect.bottom + 6}px;`,
  });

  const close = (ev) => {
    if (ev && popover.contains(ev.target)) return;
    popover.remove();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', escHandler);
  };

  const escHandler = (ev) => {
    if (ev.key === 'Escape') close();
  };

  popover.appendChild(el('div', {
    class: 'px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold border-b border-slate-100 mb-1',
  }, `Switch outlet · ${outlets.length}`));

  outlets.forEach(o => {
    const isActive = o.id === current?.id;
    const isInactive = o.is_active === false;

    popover.appendChild(el('button', {
      class: `w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition ${isActive ? 'bg-indigo-50' : ''} ${isInactive ? 'opacity-50' : ''}`,
      onclick: () => {
        close();
        if (isActive) return;
        saveOutletId(o.id);
        toast(`Switching to ${o.name}…`, 'info', 900);
        setTimeout(() => location.reload(), 250);
      },
    }, [
      el('span', { class: 'w-4 text-indigo-600 font-bold text-sm shrink-0' }, isActive ? '✓' : ''),
      el('div', { class: 'flex-1 min-w-0' }, [
        el('div', { class: 'text-sm font-medium text-slate-800 truncate' }, o.name),
        (o.code || o.city || o.state)
          ? el('div', { class: 'text-[10px] text-slate-500 truncate' },
              [o.code, o.city, o.state].filter(Boolean).join(' · '))
          : null,
      ].filter(Boolean)),
      isInactive
        ? el('span', { class: 'text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 font-semibold shrink-0' }, 'INACTIVE')
        : null,
    ].filter(Boolean)));
  });

  document.body.appendChild(popover);
  setTimeout(() => document.addEventListener('click', close), 0);
  document.addEventListener('keydown', escHandler);
}
