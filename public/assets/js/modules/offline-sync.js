import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast } from '../utils.js';
import { enqueue, listPending, updateOperation, deleteOperation, countPending } from './offline-db.js';

// ============================================================
// STATE
// ============================================================
const state = {
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
  pendingCount: 0,
  listeners: new Set(),
};

let _pingTimer = null;

function notify() {
  state.listeners.forEach(fn => {
    try { fn({ ...state }); } catch {}
  });
}

export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function getState() { return { ...state }; }
export function isOnline() { return state.online; }

// ============================================================
// ONLINE DETECTION
// ============================================================
async function probe() {
  try {
    const res = await fetch(`${import.meta.env?.BASE_URL || ''}/favicon.ico`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok || res.status === 404; // 404 still means we reached a server
  } catch {
    return false;
  }
}

async function checkConnectivity() {
  const wasOnline = state.online;
  const ok = navigator.onLine && (await probe());
  state.online = ok;
  if (wasOnline !== ok) {
    notify();
    if (ok) {
      console.log('[offline] back online — triggering sync');
      sync();
    } else {
      console.log('[offline] went offline');
    }
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

// ============================================================
// SYNC
// ============================================================
export async function sync() {
  if (state.syncing) return;
  if (!state.online) return;

  state.syncing = true;
  notify();

  try {
    const pending = await listPending(50);
    console.log(`[sync] processing ${pending.length} pending operations`);

    for (const op of pending) {
      try {
        let result;
        if (op.type === 'order:create')   result = await pushOrder(op);
        else if (op.type === 'payment:create') result = await pushPayment(op);
        else throw new Error('Unknown operation type: ' + op.type);

        await deleteOperation(op.id);
        console.log(`[sync] ✓ ${op.type} ${op.id}`);
      } catch (err) {
        console.error(`[sync] ✗ ${op.type} ${op.id}`, err);
        const attempts = (op.attempts || 0) + 1;
        if (attempts >= 5) {
          await updateOperation(op.id, { status: 'failed', attempts, error: String(err.message || err) });
        } else {
          await updateOperation(op.id, { attempts, error: String(err.message || err) });
        }
        // Stop processing on first failure to preserve ordering
        break;
      }
    }

    state.lastSync = Date.now();
    state.pendingCount = await countPending();
    notify();

    if (state.pendingCount === 0 && pending.length > 0) {
      toast(`Synced ${pending.length} queued operation${pending.length > 1 ? 's' : ''}`, 'success');
    }
  } catch (err) {
    console.error('[sync] top-level failure:', err);
  } finally {
    state.syncing = false;
    notify();
  }
}

async function pushOrder(op) {
  const { data, error } = await supabase.rpc('sync_offline_order', { p_payload: op.payload });
  if (error) throw error;
  if (data?.duplicate) console.log('[sync] order already existed:', data.order_id);
  return data;
}

async function pushPayment(op) {
  const { data, error } = await supabase.rpc('sync_offline_payment', { p_payload: op.payload });
  if (error) throw error;
  if (data?.duplicate) console.log('[sync] payment already existed');
  return data;
}

// ============================================================
// QUEUE HELPERS — called by kot.js / billing.js when offline
// ============================================================
export async function queueOrder(payload) {
  const op = await enqueue({ type: 'order:create', payload });
  state.pendingCount = await countPending();
  notify();
  return op;
}

export async function queuePayment(payload) {
  const op = await enqueue({ type: 'payment:create', payload });
  state.pendingCount = await countPending();
  notify();
  return op;
}

// ============================================================
// UI — connection badge
// ============================================================
export function buildConnectionBadge(onClickQueue) {
  const badge = el('button', {
    class: 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition',
  });

  function repaint() {
    badge.innerHTML = '';
    const { online, syncing, pendingCount } = state;

    let dotCls, label;
    if (syncing) {
      dotCls = 'bg-amber-400 animate-pulse';
      label = 'Syncing…';
    } else if (online && pendingCount === 0) {
      dotCls = 'bg-emerald-400';
      label = 'Online';
    } else if (online && pendingCount > 0) {
      dotCls = 'bg-amber-400';
      label = `${pendingCount} queued`;
    } else {
      dotCls = 'bg-red-500 animate-pulse';
      label = pendingCount > 0 ? `Offline · ${pendingCount}` : 'Offline';
    }

    badge.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
      online && pendingCount === 0 ? 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200' :
      online ? 'bg-amber-900/40 hover:bg-amber-900/60 text-amber-200' :
      'bg-red-900/40 hover:bg-red-900/60 text-red-200'
    }`;

    badge.appendChild(el('span', { class: `inline-block w-2 h-2 rounded-full ${dotCls}` }));
    badge.appendChild(el('span', {}, label));
  }

  subscribe(repaint);
  repaint();
  badge.addEventListener('click', () => onClickQueue && onClickQueue());
  return badge;
}

// ============================================================
// UI — queue modal
// ============================================================
import('./offline-db.js').then(({ listAll }) => {});

export async function openQueueModal() {
  const { listAll } = await import('./offline-db.js');
  const { inspectCache } = await import('./offline-cache.js');
  const ops = await listAll();

  const cacheInfo = await inspectCache(
    store.state.tenant?.id,
    store.state.outlet?.id,
  ).catch(() => ({}));

  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[90] flex items-start md:items-center justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8' });

  card.appendChild(el('div', { class: 'px-5 py-4 border-b border-slate-200 flex items-center justify-between' }, [
    el('div', {}, [
      el('h3', { class: 'font-bold text-lg text-slate-800' }, 'Offline Queue'),
      el('p', { class: 'text-xs text-slate-500 mt-0.5' }, `${ops.length} operation${ops.length !== 1 ? 's' : ''} stored locally`),
    ]),
    el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none', onclick: () => overlay.remove() }, '×'),
  ]));

  const body = el('div', { class: 'p-5 space-y-3 max-h-[60vh] overflow-y-auto' });

  // Cache summary
  const cacheCard = el('div', { class: 'bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1' });
  cacheCard.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1' }, 'Offline Cache'));
  Object.entries(cacheInfo).forEach(([k, v]) => {
    const shortKey = k.split(':').slice(0, 2).join(':');
    cacheCard.appendChild(el('div', { class: 'flex justify-between text-[11px]' }, [
      el('span', { class: 'text-slate-600 font-mono truncate' }, shortKey),
      v
        ? el('span', { class: 'text-emerald-700 font-medium' }, `${v.rows} rows · ${Math.round(v.age_ms / 1000)}s ago`)
        : el('span', { class: 'text-slate-400 italic' }, 'empty'),
    ]));
  });
  body.appendChild(cacheCard);

  if (!ops.length) {
    body.appendChild(el('div', { class: 'text-center text-slate-400 py-8' }, [
      el('div', { class: 'text-4xl mb-2 opacity-40' }, '✓'),
      el('div', { class: 'text-sm' }, 'Queue is empty'),
    ]));
  } else {
    ops.forEach(op => {
      const statusColors = {
        pending: 'bg-amber-100 text-amber-700',
        failed:  'bg-red-100 text-red-700',
      };
      const status = op.status || 'pending';

      body.appendChild(el('div', { class: 'border border-slate-200 rounded-lg p-3' }, [
        el('div', { class: 'flex items-center justify-between gap-2' }, [
          el('div', { class: 'flex items-center gap-2 min-w-0' }, [
            el('span', { class: `text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${statusColors[status] || 'bg-slate-100 text-slate-600'}` }, status),
            el('span', { class: 'text-sm font-medium text-slate-800 truncate' }, op.type),
            op.attempts > 0 ? el('span', { class: 'text-[10px] text-slate-400' }, `· ${op.attempts} attempt${op.attempts > 1 ? 's' : ''}`) : null,
          ].filter(Boolean)),
          el('span', { class: 'text-[10px] text-slate-400 whitespace-nowrap' }, new Date(op.queued_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
        ]),
        op.payload ? el('pre', { class: 'mt-2 text-[10px] text-slate-500 bg-slate-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-32' },
          JSON.stringify(op.payload, null, 2).slice(0, 500)) : null,
        op.error ? el('div', { class: 'mt-2 text-[11px] text-red-600 bg-red-50 rounded p-2' }, op.error) : null,
        el('div', { class: 'mt-2 flex justify-end gap-1' }, [
          status === 'failed' ? el('button', {
            class: 'text-[10px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium',
            onclick: async () => {
              const { updateOperation } = await import('./offline-db.js');
              await updateOperation(op.id, { status: 'pending', attempts: 0, error: null });
              toast('Requeued', 'success', 1000);
              overlay.remove();
              sync();
            },
          }, 'Retry') : null,
          el('button', {
            class: 'text-[10px] px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-medium',
            onclick: async () => {
              if (!confirm('Delete this operation permanently?')) return;
              const { deleteOperation } = await import('./offline-db.js');
              await deleteOperation(op.id);
              toast('Deleted', 'success', 1000);
              overlay.remove();
            },
          }, 'Delete'),
        ].filter(Boolean)),
      ]));
    });
  }

  card.appendChild(body);

  const footer = el('div', { class: 'px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl' }, [
    el('button', {
      class: 'text-xs text-red-600 hover:text-red-700 font-medium',
      onclick: async () => {
        if (!confirm('Clear the entire local queue? This cannot be undone.')) return;
        const { clearAll } = await import('./offline-db.js');
        await clearAll();
        toast('Queue cleared', 'success');
        overlay.remove();
      },
    }, 'Clear All'),
    el('div', { class: 'flex items-center gap-2' }, [
      el('button', {
        class: 'px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium',
        onclick: () => overlay.remove(),
      }, 'Close'),
      el('button', {
        class: `px-4 py-2 rounded-lg text-sm font-semibold ${state.online ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`,
        disabled: state.online ? null : true,
        onclick: () => { overlay.remove(); sync(); },
      }, 'Sync Now'),
    ]),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
