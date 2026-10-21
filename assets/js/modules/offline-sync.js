import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast } from '../utils.js';
import { CONFIG } from '../../../config.js';
import { enqueue, listPending, updateOperation, deleteOperation, countPending } from './offline-db.js';

const state = {
  online: navigator.onLine,
  syncing: false,
  pendingCount: 0,
  listeners: new Set(),
};

let _pingTimer = null;

function notify() {
  state.listeners.forEach(fn => {
    try { fn({ ...state }); } catch {}
  });
}

export function subscribe(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
export function getState() { return { ...state }; }
export function isOnline() { return state.online; }

async function probe() {
  if (!navigator.onLine) return false;
  try {
    // Ping Supabase directly to check internet, not the local server
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status === 401; 
  } catch {
    return false;
  }
}

async function checkConnectivity() {
  const wasOnline = state.online;
  const ok = await probe();
  state.online = ok;
  if (wasOnline !== ok) {
    notify();
    if (ok) sync();
  }
}

export function startMonitoring() {
  window.addEventListener('online',  () => { state.online = true;  notify(); sync(); });
  window.addEventListener('offline', () => { state.online = false; notify(); });

  if (_pingTimer) clearInterval(_pingTimer);
  _pingTimer = setInterval(checkConnectivity, 15000);
  checkConnectivity();
  countPending().then(n => { state.pendingCount = n; notify(); });
}

export async function sync() {
  if (state.syncing || !state.online) return;
  state.syncing = true;
  notify();
  try {
    const pending = await listPending(50);
    for (const op of pending) {
      try {
        let result;
        if (op.type === 'order:create')   result = await pushOrder(op);
        else if (op.type === 'payment:create') result = await pushPayment(op);
        await deleteOperation(op.id);
      } catch (err) {
        const attempts = (op.attempts || 0) + 1;
        await updateOperation(op.id, { attempts, status: attempts >= 5 ? 'failed' : 'pending', error: String(err.message) });
        break;
      }
    }
    state.pendingCount = await countPending();
    notify();
  } finally {
    state.syncing = false;
    notify();
  }
}

async function pushOrder(op) { return await supabase.rpc('sync_offline_order', { p_payload: op.payload }); }
async function pushPayment(op) { return await supabase.rpc('sync_offline_payment', { p_payload: op.payload }); }

export async function queueOrder(payload) { const op = await enqueue({ type: 'order:create', payload }); state.pendingCount = await countPending(); notify(); return op; }
export async function queuePayment(payload) { const op = await enqueue({ type: 'payment:create', payload }); state.pendingCount = await countPending(); notify(); return op; }

export function buildConnectionBadge(onClickQueue) {
  const badge = el('button', { class: 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition' });
  function repaint() {
    badge.innerHTML = '';
    const { online, syncing, pendingCount } = state;
    let dotCls = 'bg-emerald-400', label = 'Online';
    if (syncing) { dotCls = 'bg-amber-400 animate-pulse'; label = 'Syncing…'; }
    else if (online && pendingCount > 0) { dotCls = 'bg-amber-400'; label = `${pendingCount} queued`; }
    else if (!online) { dotCls = 'bg-red-500 animate-pulse'; label = pendingCount > 0 ? `Offline · ${pendingCount}` : 'Offline'; }

    badge.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
      online && pendingCount === 0 ? 'bg-emerald-900/40 text-emerald-200' :
      online ? 'bg-amber-900/40 text-amber-200' : 'bg-red-900/40 text-red-200'
    }`;
    badge.appendChild(el('span', { class: `inline-block w-2 h-2 rounded-full ${dotCls}` }));
    badge.appendChild(el('span', {}, label));
  }
  subscribe(repaint);
  repaint();
  badge.addEventListener('click', () => onClickQueue && onClickQueue());
  return badge;
}

export async function openQueueModal() {
  const { listAll } = await import('./offline-db.js');
  const ops = await listAll();
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[90] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });
  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Offline Queue'),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));
  const body = el('div', { class: 'p-5 space-y-3 max-h-[60vh] overflow-y-auto' });
  if (!ops.length) body.appendChild(el('div', { class: 'text-center text-slate-400 py-8' }, 'Queue is empty'));
  else ops.forEach(op => body.appendChild(el('div', { class: 'border border-slate-200 rounded-lg p-3' }, [ el('div', { class: 'text-sm font-medium' }, op.type) ])));
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
