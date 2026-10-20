import { supabase } from '../supabase-client.js';
import { store } from '../store.js';
import { el, toast } from '../utils.js';
import { navigate } from '../router.js';
import { loadTables } from './tables.js';

let channel   = null;
let tickTimer = null;
let audioCtx  = null;

const state = {
  stations: [],
  kots: [],
  itemsByKot: new Map(),
  stationFilter: 'all',
  soundEnabled: true,
  lastKotIds: new Set(),
};

export async function renderKDS(root) {
  if (!store.state.outlet) throw new Error('No outlet in session');
  if (!store.state.tables?.length) await loadTables();

  state.stations      = await fetchStations();
  state.stationFilter = localStorage.getItem('kds.station') || 'all';
  state.soundEnabled  = localStorage.getItem('kds.sound') !== 'off';
  state.itemsByKot    = new Map();

  root.innerHTML = '';

  const overlay = el('div', { class: 'fixed inset-0 z-[100] bg-slate-900 text-white flex flex-col' });

  const header = buildHeader(root);
  overlay.appendChild(header);

  const grid = el('div', {
    id: 'kds-grid',
    class: 'flex-1 overflow-y-auto p-4 grid gap-4 content-start',
    style: 'grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));',
  });
  overlay.appendChild(grid);

  const empty = el('div', {
    id: 'kds-empty',
    class: 'hidden flex-1 flex items-center justify-center',
  }, [
    el('div', { class: 'text-center select-none' }, [
      el('div', { class: 'text-7xl mb-4 opacity-30' }, '🍽️'),
      el('div', { class: 'text-2xl text-slate-500 font-medium' }, 'All caught up'),
      el('div', { class: 'text-sm text-slate-600 mt-1' }, 'Waiting for new orders…'),
    ]),
  ]);
  overlay.appendChild(empty);

  root.appendChild(overlay);

  const initAudioOnce = () => {
    initAudio();
    overlay.removeEventListener('click', initAudioOnce);
    overlay.removeEventListener('touchstart', initAudioOnce);
  };
  overlay.addEventListener('click', initAudioOnce);
  overlay.addEventListener('touchstart', initAudioOnce);

  await refreshAll(grid, empty);
  state.lastKotIds = new Set(state.kots.map(k => k.id));

  subscribe(grid, empty);

  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => paintGrid(grid, empty), 15000);

  window.addEventListener('beforeunload', cleanup, { once: true });
}

function cleanup() {
  if (channel)   { supabase.removeChannel(channel); channel = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function buildHeader(root) {
  const header = el('div', { class: 'flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 flex-wrap gap-3' });

  const left = el('div', { class: 'flex items-center gap-3' }, [
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium flex items-center gap-1.5',
      onclick: () => { cleanup(); navigate('dashboard'); },
    }, ['←', el('span', { class: 'hidden sm:inline' }, 'Back')]),
    el('div', {}, [
      el('div', { class: 'font-semibold text-base leading-tight' }, 'Kitchen Display'),
      el('div', { class: 'text-xs text-slate-400 leading-tight' }, store.state.outlet?.name || ''),
    ]),
  ]);

  const stationBar = el('div', { id: 'kds-stations', class: 'flex items-center gap-1.5 flex-wrap' });
  paintStationChips(stationBar);

  const right = el('div', { class: 'flex items-center gap-1.5' }, [
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm',
      title: 'Toggle sound',
      onclick: (e) => {
        state.soundEnabled = !state.soundEnabled;
        localStorage.setItem('kds.sound', state.soundEnabled ? 'on' : 'off');
        e.currentTarget.textContent = state.soundEnabled ? '🔔' : '🔕';
        if (state.soundEnabled) { initAudio(); beep('new'); }
      },
    }, state.soundEnabled ? '🔔' : '🔕'),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm',
      title: 'Fullscreen',
      onclick: toggleFullscreen,
    }, '⛶'),
    el('button', {
      class: 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm',
      title: 'Refresh',
      onclick: async () => {
        await refreshAll(
          document.getElementById('kds-grid'),
          document.getElementById('kds-empty'),
        );
        toast('Refreshed', 'info', 1000);
      },
    }, '⟳'),
  ]);

  header.appendChild(left);
  header.appendChild(stationBar);
  header.appendChild(right);
  return header;
}

function paintStationChips(container) {
  container.innerHTML = '';
  const chips = [{ id: 'all', name: 'All Stations' }, ...state.stations];

  chips.forEach(s => {
    const active = state.stationFilter === s.id;
    const chip = el('button', {
      class: `px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition
              ${active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`,
      onclick: () => {
        state.stationFilter = s.id;
        localStorage.setItem('kds.station', s.id);
        paintStationChips(container);
        paintGrid(
          document.getElementById('kds-grid'),
          document.getElementById('kds-empty'),
        );
      },
    }, s.name);
    container.appendChild(chip);
  });
}

async function fetchStations() {
  const { data } = await supabase
    .from('kitchen_stations')
    .select('*')
    .eq('outlet_id', store.state.outlet.id)
    .eq('is_active', true)
    .order('sort_order');
  return data || [];
}

async function refreshAll(grid, empty) {
  const outletId = store.state.outlet.id;

  // FIXED: Removed the broken tenant_members join
  const { data: kots, error: kErr } = await supabase
    .from('kots')
    .select('*')
    .eq('outlet_id', outletId)
    .in('status', ['pending', 'acknowledged', 'preparing', 'ready'])
    .order('created_at', { ascending: true });

  if (kErr) { 
    console.error('[KDS] Failed to load KOTs:', kErr); 
    return; 
  }

  state.kots = kots || [];
  state.itemsByKot = new Map();

  if (state.kots.length) {
    const kotIds = state.kots.map(k => k.id);
    const { data: items, error: iErr } = await supabase
      .from('kot_items')
      .select('*')
      .in('kot_id', kotIds);
    if (iErr) console.error(iErr);
    (items || []).forEach(it => {
      if (!state.itemsByKot.has(it.kot_id)) state.itemsByKot.set(it.kot_id, []);
      state.itemsByKot.get(it.kot_id).push(it);
    });
  }

  paintGrid(grid, empty);
}

function paintGrid(grid, empty) {
  if (!grid) return;
  grid.innerHTML = '';

  const filtered = state.kots.filter(k => {
    if (state.stationFilter !== 'all' && k.station_id !== state.stationFilter) return false;
    return true;
  });

  if (!filtered.length) {
    grid.classList.add('hidden');
    empty?.classList.remove('hidden');
    empty?.classList.add('flex');
    return;
  }

  grid.classList.remove('hidden');
  empty?.classList.add('hidden');
  empty?.classList.remove('flex');

  filtered.forEach(kot => grid.appendChild(buildCard(kot)));
}

function buildCard(kot) {
  const items  = state.itemsByKot.get(kot.id) || [];
  const ageMin = (Date.now() - new Date(kot.created_at).getTime()) / 60000;

  let accent = 'border-emerald-500';
  let bg     = 'bg-slate-800';
  let badge  = 'bg-emerald-500/20 text-emerald-300';
  if (kot.status === 'ready') { accent = 'border-sky-400';   bg = 'bg-slate-800/70'; badge = 'bg-sky-500/20 text-sky-300'; }
  else if (ageMin > 15)       { accent = 'border-red-500 animate-pulse'; badge = 'bg-red-500/20 text-red-300'; }
  else if (ageMin > 10)       { accent = 'border-orange-500'; badge = 'bg-orange-500/20 text-orange-300'; }
  else if (ageMin > 5)        { accent = 'border-amber-400';  badge = 'bg-amber-400/20 text-amber-300'; }

  const card = el('div', {
    class: `${bg} border-2 ${accent} rounded-xl overflow-hidden flex flex-col shadow-lg transition`,
    'data-kot': kot.id,
  });

  const top = el('div', { class: 'px-3 py-2 flex items-center justify-between border-b border-slate-700' }, [
    el('div', { class: 'flex items-center gap-2 min-w-0' }, [
      el('span', { class: 'font-bold text-lg leading-none' }, `#${kot.kot_number}`),
      el('span', { class: `text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${badge}` }, kot.status),
    ]),
    el('div', { class: 'text-right' }, [
      el('div', { class: 'font-mono text-sm text-slate-300' }, formatElapsed(ageMin)),
      el('div', { class: 'text-[10px] text-slate-500 leading-tight' },
        kot.order_type === 'dine_in' ? (kot.table_name || 'Dine-in') : kot.order_type.replace('_',' ')),
    ]),
  ]);
  card.appendChild(top);

  const body = el('div', { class: 'px-3 py-2 flex-1 overflow-y-auto max-h-64' });
  if (!items.length) {
    body.appendChild(el('div', { class: 'text-slate-500 text-sm italic' }, 'No items'));
  } else {
    items.forEach(it => {
      body.appendChild(el('div', { class: 'flex items-start gap-2 py-1.5 border-b border-slate-700/50 last:border-0' }, [
        el('span', { class: 'font-bold text-base w-8 shrink-0 text-white' }, `${Number(it.quantity)}×`),
        el('div', { class: 'flex-1 min-w-0' }, [
          el('div', { class: 'text-sm font-medium text-white leading-tight truncate' }, it.name_snapshot),
          it.variant_name ? el('div', { class: 'text-xs text-slate-400 leading-tight' }, it.variant_name) : null,
          it.notes ? el('div', { class: 'text-xs italic text-amber-300 leading-tight mt-0.5' }, `↳ ${it.notes}`) : null,
        ].filter(Boolean)),
      ]));
    });
  }
  card.appendChild(body);

  const footer = el('div', { class: 'p-2 border-t border-slate-700 bg-slate-900/50' });

  if (kot.status === 'pending') {
    footer.appendChild(actionBtn('Acknowledge', 'bg-amber-500 hover:bg-amber-400 text-black', () => advance(kot, 'acknowledged')));
  } else if (kot.status === 'acknowledged') {
    footer.appendChild(actionBtn('Start Cooking', 'bg-indigo-500 hover:bg-indigo-400', () => advance(kot, 'preparing')));
  } else if (kot.status === 'preparing') {
    footer.appendChild(actionBtn('Mark Ready', 'bg-emerald-500 hover:bg-emerald-400 text-black', () => advance(kot, 'ready')));
  } else if (kot.status === 'ready') {
    footer.appendChild(actionBtn('Served / Bumped', 'bg-sky-500 hover:bg-sky-400 text-black', () => advance(kot, 'served')));
  }

  card.appendChild(footer);
  return card;
}

function actionBtn(label, cls, onClick) {
  return el('button', {
    class: `w-full py-3 rounded-lg font-semibold text-sm transition ${cls}`,
    onclick: (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = '…';
      onClick();
    },
  }, label);
}

async function advance(kot, newStatus) {
  const now = new Date().toISOString();
  const patch = { status: newStatus };
  if (newStatus === 'acknowledged') patch.acknowledged_at = now;
  if (newStatus === 'preparing')    patch.acknowledged_at = kot.acknowledged_at || now;
  if (newStatus === 'ready')        patch.ready_at = now;
  if (newStatus === 'served')       patch.served_at = now;

  const { error } = await supabase.from('kots').update(patch).eq('id', kot.id);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }

  const itemPatch = { status: newStatus };
  if (newStatus === 'preparing') itemPatch.started_at = now;
  if (newStatus === 'ready')     itemPatch.ready_at   = now;
  await supabase.from('kot_items').update(itemPatch).eq('kot_id', kot.id);

  kot.status = newStatus;
  Object.assign(kot, patch);
  if (newStatus === 'served') {
    state.kots = state.kots.filter(k => k.id !== kot.id);
  }
  paintGrid(
    document.getElementById('kds-grid'),
    document.getElementById('kds-empty'),
  );
}

function subscribe(grid, empty) {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  const outletId = store.state.outlet.id;

  channel = supabase
    .channel('kds-live')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'kots', filter: `outlet_id=eq.${outletId}` },
      handleChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'kot_items' },
      handleChange)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') console.log('[KDS] realtime connected');
    });

  let debounceTimer = null;
  function handleChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const beforeIds = new Set(state.kots.map(k => k.id));
      await refreshAll(grid, empty);

      const newKots = state.kots.filter(k => !beforeIds.has(k.id) && k.status === 'pending');
      if (newKots.length) {
        beep('new');
        flashTitle(newKots.length);
      }
    }, 300);
  }
}

function formatElapsed(minutes) {
  if (minutes < 1)  return '<1m';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${m}m`;
}

function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { console.warn('Audio unavailable', e); }
}

function beep(kind = 'new') {
  if (!state.soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';

  if (kind === 'new') {
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1320, now + 0.12);
    osc.frequency.setValueAtTime(880, now + 0.24);
  } else {
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(990, now + 0.10);
  }

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.5);
}

let flashTimer = null;
function flashTitle(count = 1) {
  const original = document.title;
  let on = false;
  let n = 0;
  if (flashTimer) clearInterval(flashTimer);
  flashTimer = setInterval(() => {
    document.title = on ? `🔔 ${count} new order` : original;
    on = !on;
    if (++n > 10) { clearInterval(flashTimer); document.title = original; }
  }, 800);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}
