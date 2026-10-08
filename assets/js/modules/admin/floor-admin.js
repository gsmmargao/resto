import { supabase } from '../../supabase-client.js';
import { store } from '../../store.js';
import { el, toast, confirmDialog } from '../../utils.js';

// ============================================================
// CONSTANTS
// ============================================================
const GRID = 30;                       // grid size in canvas units (px at zoom 1)
const MIN_SIZE = 60;
const MAX_SIZE = 400;
const DEFAULT_SIZE = 100;

const SHAPES = [
  { id: 'square', label: 'Square',  css: 'rounded-lg' },
  { id: 'rect',   label: 'Rect',    css: 'rounded-lg' },
  { id: 'round',  label: 'Round',   css: 'rounded-full' },
  { id: 'bar',    label: 'Bar',     css: 'rounded-full' },
];

const state = {
  areas: [],
  tables: [],
  openOrders: [],
  currentAreaId: null,
  selectedId: null,
  zoom: 1,
  dirty: false,
  dragging: null,   // { id, startX, startY, origX, origY, moved }
  resizing: null,   // { id, edge, startX, startY, origX, origY, origW, origH }
  loaded: false,
};

// ============================================================
// ENTRY
// ============================================================
export async function renderFloorAdmin(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'h-full flex items-center justify-center text-slate-400 text-sm' }, 'Loading floor plan…'));

  try {
    if (!state.loaded) await loadAll();
    paint(root);
  } catch (err) {
    console.error('[floor-admin]', err);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'p-6 text-red-600 text-sm font-mono' }, 'Error: ' + (err.message || err)));
  }
}

async function loadAll() {
  const outletId = store.state.outlet?.id;
  const tenantId = store.state.tenant?.id;
  if (!outletId || !tenantId) throw new Error('No outlet / tenant');

  const [areaRes, tableRes, orderRes] = await Promise.all([
    supabase.from('floor_areas').select('*').eq('outlet_id', outletId).order('sort_order'),
    supabase.from('dining_tables').select('*').eq('outlet_id', outletId).order('sort_order'),
    supabase.from('orders')
      .select('id, order_number, table_id, status, grand_total, placed_at')
      .eq('outlet_id', outletId)
      .in('status', ['open','in_kitchen','partially_ready','ready','served','billed','partially_paid']),
  ]);

  state.areas = areaRes.data || [];
  state.tables = tableRes.data || [];
  state.openOrders = orderRes.data || [];

  if (!state.currentAreaId && state.areas.length) state.currentAreaId = state.areas[0].id;
  state.loaded = true;
}

async function refresh() {
  state.loaded = false;
  await loadAll();
}

// ============================================================
// LAYOUT
// ============================================================
function paint(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'h-full flex flex-col bg-slate-100' });

  wrap.appendChild(renderTopBar(root));
  wrap.appendChild(renderCanvasWrap(root));

  if (state.selectedId) {
    wrap.appendChild(renderPropertiesDrawer(root));
  }

  root.appendChild(wrap);
}

// ============================================================
// TOP BAR
// ============================================================
function renderTopBar(root) {
  const bar = el('div', { class: 'bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto flex-wrap' });

  // Area chips
  const areaChips = el('div', { class: 'flex items-center gap-1.5 mr-2' });
  state.areas.forEach(a => {
    const active = a.id === state.currentAreaId;
    areaChips.appendChild(el('button', {
      class: `px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`,
      onclick: () => { state.currentAreaId = a.id; state.selectedId = null; paint(root); },
    }, a.name));
  });
  areaChips.appendChild(el('button', {
    class: 'px-2 py-1.5 rounded-lg text-xs font-medium border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 whitespace-nowrap',
    onclick: () => openAreaEditor(root, null),
    title: 'New floor area',
  }, '+ Area'));
  bar.appendChild(areaChips);

  bar.appendChild(el('div', { class: 'w-px h-6 bg-slate-200 mx-1 hidden sm:block' }));

  bar.appendChild(el('button', {
    class: 'px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap',
    onclick: () => addTable(root),
  }, '+ Add Table'));

  bar.appendChild(el('button', {
    class: 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
    onclick: (e) => { e.currentTarget.disabled = true; rotateSelected(root); e.currentTarget.disabled = false; },
    title: 'Rotate selected table 90°',
  }, '↻ Rotate'));

  bar.appendChild(el('button', {
    class: `px-3 py-1.5 rounded-lg text-xs font-medium ${state.dirty ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`,
    onclick: async () => { if (state.dirty) await savePositions(root); },
  }, state.dirty ? '● Save Layout' : 'Saved'));

  // Spacer
  bar.appendChild(el('div', { class: 'flex-1' }));

  // Zoom
  const zoomBar = el('div', { class: 'flex items-center gap-1' });
  zoomBar.appendChild(zoomBtn('−', () => setZoom(root, state.zoom - 0.1)));
  zoomBar.appendChild(el('span', { class: 'text-xs text-slate-600 font-mono w-12 text-center' }, Math.round(state.zoom * 100) + '%'));
  zoomBar.appendChild(zoomBtn('+', () => setZoom(root, state.zoom + 0.1)));
  zoomBar.appendChild(zoomBtn('1:1', () => setZoom(root, 1)));
  bar.appendChild(zoomBar);

  return bar;
}

function zoomBtn(label, onClick) {
  return el('button', {
    class: 'w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
    onclick: onClick,
  }, label);
}

function setZoom(root, z) {
  state.zoom = Math.max(0.4, Math.min(2, z));
  paint(root);
}

// ============================================================
// CANVAS
// ============================================================
function renderCanvasWrap(root) {
  const wrap = el('div', { class: 'flex-1 min-h-0 overflow-auto bg-slate-100 p-4' });
  const stage = el('div', {
    class: 'relative bg-white rounded-xl border border-slate-200 shadow-sm mx-auto',
    style: `width: ${1200 * state.zoom}px; height: ${800 * state.zoom}px; background-image: linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px); background-size: ${GRID * state.zoom}px ${GRID * state.zoom}px; background-position: 0 0;`,
    onclick: (e) => {
      if (e.target === stage) { state.selectedId = null; paint(root); }
    },
  });

  const tablesInArea = state.tables.filter(t => t.area_id === state.currentAreaId);

  tablesInArea.forEach(t => stage.appendChild(buildTable(t, stage, root)));

  // Empty state
  if (!tablesInArea.length) {
    stage.appendChild(el('div', { class: 'absolute inset-0 flex items-center justify-center pointer-events-none' }, [
      el('div', { class: 'text-center text-slate-400' }, [
        el('div', { class: 'text-5xl mb-2 opacity-40' }, '🪑'),
        el('div', { class: 'text-sm font-medium' }, 'No tables in this area'),
        el('div', { class: 'text-xs mt-1' }, 'Click "+ Add Table" to start'),
      ]),
    ]));
  }

  wrap.appendChild(stage);
  return wrap;
}

function buildTable(t, stage, root) {
  const isSelected = state.selectedId === t.id;
  const openOrder = state.openOrders.find(o => o.table_id === t.id);
  const shape = SHAPES.find(s => s.id === t.shape)?.css || 'rounded-lg';

  const baseCls = `absolute select-none cursor-move flex items-center justify-center text-center font-semibold shadow-sm transition-colors`;
  const statusCls = openOrder
    ? 'bg-red-500 hover:bg-red-600 text-white border-red-600'
    : 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600';
  const selectCls = isSelected ? 'ring-4 ring-indigo-400 ring-offset-2 ring-offset-white z-10' : '';

  const node = el('div', {
    class: `${baseCls} ${shape} ${statusCls} ${selectCls} border-2`,
    style: `left: ${t.pos_x * state.zoom}px; top: ${t.pos_y * state.zoom}px; width: ${t.width * state.zoom}px; height: ${t.height * state.zoom}px; transform: rotate(${t.rotation || 0}deg);`,
    'data-table-id': t.id,
    onclick: (e) => { e.stopPropagation(); state.selectedId = t.id; paint(root); },
    onpointerdown: (e) => startDrag(e, t, stage, root),
  }, [
    el('div', { class: 'px-1 text-center pointer-events-none' }, [
      el('div', { class: 'text-sm font-bold leading-tight' }, t.name),
      el('div', { class: 'text-[10px] opacity-90 leading-tight' }, `${t.capacity} pax`),
      openOrder ? el('div', { class: 'text-[9px] font-mono opacity-90 mt-0.5' }, `#${openOrder.order_number}`) : null,
    ].filter(Boolean)),
  ]);

  // Resize handles (only when selected)
  if (isSelected) {
    ['nw', 'ne', 'sw', 'se'].forEach(edge => {
      node.appendChild(el('div', {
        class: `absolute w-4 h-4 bg-white border-2 border-indigo-500 rounded-full cursor-${edge === 'nw' || edge === 'se' ? 'nwse' : 'nesw'}-resize`,
        style: `${edge.includes('n') ? 'top:-8px' : 'bottom:-8px'}; ${edge.includes('w') ? 'left:-8px' : 'right:-8px'};`,
        onpointerdown: (e) => { e.stopPropagation(); startResize(e, t, edge, root); },
      }));
    });
  }

  return node;
}

// ============================================================
// DRAG
// ============================================================
function startDrag(e, t, stage, root) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = t.pos_x;
  const origY = t.pos_y;

  state.selectedId = t.id;
  state.dragging = { id: t.id, startX, startY, origX, origY, moved: false };

  const node = stage.querySelector(`[data-table-id="${t.id}"]`);
  if (node) node.classList.add('cursor-grabbing', 'ring-4', 'ring-indigo-400');

  function onMove(ev) {
    const dx = (ev.clientX - startX) / state.zoom;
    const dy = (ev.clientY - startY) / state.zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.dragging.moved = true;

    let nx = origX + dx;
    let ny = origY + dy;

    // Snap to grid (hold Shift to disable)
    if (!ev.shiftKey) {
      nx = Math.round(nx / GRID) * GRID;
      ny = Math.round(ny / GRID) * GRID;
    }

    // Clamp inside canvas
    nx = Math.max(0, Math.min(1200 - t.width, nx));
    ny = Math.max(0, Math.min(800 - t.height, ny));

    // Live update
    t.pos_x = nx;
    t.pos_y = ny;
    if (node) {
      node.style.left = `${nx * state.zoom}px`;
      node.style.top  = `${ny * state.zoom}px`;
    }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (node) node.classList.remove('cursor-grabbing', 'ring-4', 'ring-indigo-400');
    if (state.dragging?.moved) {
      state.dirty = true;
      // Repaint just the top bar so Save becomes active
      const topBar = root.querySelector('.bg-white.border-b');
      if (topBar && topBar.parentElement) {
        const fresh = renderTopBar(root);
        topBar.parentElement.replaceChild(fresh, topBar);
      }
    }
    state.dragging = null;
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ============================================================
// RESIZE
// ============================================================
function startResize(e, t, edge, root) {
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = t.pos_x;
  const origY = t.pos_y;
  const origW = t.width;
  const origH = t.height;

  state.resizing = { id: t.id, edge };

  const node = document.querySelector(`[data-table-id="${t.id}"]`);

  function onMove(ev) {
    const dx = (ev.clientX - startX) / state.zoom;
    const dy = (ev.clientY - startY) / state.zoom;

    let nx = origX, ny = origY, nw = origW, nh = origH;

    if (edge.includes('e')) nw = origW + dx;
    if (edge.includes('w')) { nw = origW - dx; nx = origX + dx; }
    if (edge.includes('s')) nh = origH + dy;
    if (edge.includes('n')) { nh = origH - dy; ny = origY + dy; }

    nw = Math.max(MIN_SIZE, Math.min(MAX_SIZE, nw));
    nh = Math.max(MIN_SIZE, Math.min(MAX_SIZE, nh));

    // Snap size
    if (!ev.shiftKey) {
      nw = Math.round(nw / GRID) * GRID;
      nh = Math.round(nh / GRID) * GRID;
    }

    // Clamp inside canvas
    nx = Math.max(0, nx);
    ny = Math.max(0, ny);
    if (nx + nw > 1200) nw = 1200 - nx;
    if (ny + nh > 800)  nh = 800 - ny;

    t.pos_x = nx; t.pos_y = ny; t.width = nw; t.height = nh;

    if (node) {
      node.style.left = `${nx * state.zoom}px`;
      node.style.top  = `${ny * state.zoom}px`;
      node.style.width = `${nw * state.zoom}px`;
      node.style.height = `${nh * state.zoom}px`;
    }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    state.dirty = true;
    state.resizing = null;
    const topBar = root.querySelector('.bg-white.border-b');
    if (topBar && topBar.parentElement) {
      const fresh = renderTopBar(root);
      topBar.parentElement.replaceChild(fresh, topBar);
    }
    paint(root);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ============================================================
// PROPERTIES DRAWER
// ============================================================
function renderPropertiesDrawer(root) {
  const t = state.tables.find(x => x.id === state.selectedId);
  if (!t) return el('div', { class: 'hidden' });

  const drawer = el('div', { class: 'bg-white border-t border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end' });

  drawer.appendChild(propField('Name', el('input', {
    type: 'text', value: t.name, class: 'w-28 px-2 py-1.5 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { t.name = e.target.value; state.dirty = true; },
    onchange: () => paint(root),
  })));

  drawer.appendChild(propField('Capacity', el('input', {
    type: 'number', min: 1, value: t.capacity, class: 'w-20 px-2 py-1.5 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    oninput: (e) => { t.capacity = Number(e.target.value) || 1; state.dirty = true; },
    onchange: () => paint(root),
  })));

  drawer.appendChild(propField('Shape', el('select', {
    class: 'px-2 py-1.5 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { t.shape = e.target.value; state.dirty = true; paint(root); },
  }, SHAPES.map(s => el('option', { value: s.id, selected: t.shape === s.id ? true : null }, s.label)))));

  drawer.appendChild(propField('Area', el('select', {
    class: 'px-2 py-1.5 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
    onchange: (e) => { t.area_id = e.target.value || null; state.dirty = true; paint(root); },
  }, [
    el('option', { value: '' }, '— unassigned —'),
    ...state.areas.map(a => el('option', { value: a.id, selected: t.area_id === a.id ? true : null }, a.name)),
  ])));

  drawer.appendChild(propField('Size (W×H)', el('div', { class: 'text-xs text-slate-600 font-mono bg-slate-50 px-2 py-2 rounded border border-slate-200' },
    `${Math.round(t.width)} × ${Math.round(t.height)}`)));

  drawer.appendChild(el('div', { class: 'flex items-center gap-1.5 ml-auto' }, [
    el('button', {
      class: 'px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium',
      onclick: () => copyQRLink(t),
    }, '📱 Copy QR Link'),
    el('button', {
      class: 'px-3 py-1.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium',
      onclick: () => showQR(t),
    }, '🔳 Show QR'),
    el('button', {
      class: 'px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium',
      onclick: () => deleteTable(root, t),
    }, '🗑 Delete'),
  ]));

  return drawer;
}

function propField(label, control) {
  return el('div', {}, [
    el('label', { class: 'block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1' }, label),
    control,
  ]);
}

// ============================================================
// ACTIONS
// ============================================================
async function addTable(root) {
  if (!state.currentAreaId) { toast('Create a floor area first', 'warn'); return; }

  // Find a free grid slot
  const inArea = state.tables.filter(t => t.area_id === state.currentAreaId);
  let posX = GRID * 4, posY = GRID * 4;
  const occupied = new Set(inArea.map(t => `${t.pos_x},${t.pos_y}`));
  while (occupied.has(`${posX},${posY}`)) {
    posX += GRID;
    if (posX > 1000) { posX = GRID * 4; posY += GRID; }
  }

  const name = nextTableName(state.currentAreaId);

  const { data, error } = await supabase.from('dining_tables').insert({
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    area_id: state.currentAreaId,
    name,
    capacity: 4,
    shape: 'square',
    pos_x: posX,
    pos_y: posY,
    width: DEFAULT_SIZE,
    height: DEFAULT_SIZE,
    rotation: 0,
    status: 'available',
    is_active: true,
    sort_order: state.tables.length + 1,
  }).select().single();

  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  state.tables.push(data);
  state.selectedId = data.id;
  toast('Table added', 'success');
  paint(root);
}

function nextTableName(areaId) {
  const inArea = state.tables.filter(t => t.area_id === areaId);
  const prefix = state.areas.find(a => a.id === areaId)?.name?.charAt(0).toUpperCase() || 'T';
  let n = inArea.length + 1;
  const names = new Set(inArea.map(t => t.name));
  while (names.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

async function rotateSelected(root) {
  const t = state.tables.find(x => x.id === state.selectedId);
  if (!t) { toast('Select a table first', 'warn'); return; }
  t.rotation = ((t.rotation || 0) + 90) % 360;
  state.dirty = true;
  paint(root);
}

async function deleteTable(root, t) {
  const ok = await confirmDialog(
    `Delete table "${t.name}"? This cannot be undone.`,
    'Delete table?',
  );
  if (!ok) return;

  const { error } = await supabase.from('dining_tables').update({ is_active: false }).eq('id', t.id);
  if (error) { toast('Failed: ' + error.message, 'error'); return; }

  state.tables = state.tables.filter(x => x.id !== t.id);
  state.selectedId = null;
  toast('Table deleted', 'success');
  paint(root);
}

async function savePositions(root) {
  if (!state.dirty) return;
  const updates = state.tables.map(t => ({
    id: t.id,
    pos_x: Math.round(t.pos_x),
    pos_y: Math.round(t.pos_y),
    width: Math.round(t.width),
    height: Math.round(t.height),
    rotation: t.rotation || 0,
    name: t.name,
    capacity: t.capacity,
    shape: t.shape,
    area_id: t.area_id,
    updated_at: new Date().toISOString(),
  }));

  let failed = 0;
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase.from('dining_tables').update(patch).eq('id', id);
    if (error) { console.error(error); failed++; }
  }

  if (failed) toast(`${failed} table(s) failed to save`, 'error');
  else { toast('Layout saved', 'success'); state.dirty = false; }
  paint(root);
}

// ============================================================
// QR CODE
// ============================================================
function buildQRUrl(token) {
  const base = location.origin + location.pathname.replace(/\/[^/]*$/, '');
  return `${base}/#order?t=${token}`;
}

function copyQRLink(t) {
  const url = buildQRUrl(t.qr_token);
  navigator.clipboard.writeText(url)
    .then(() => toast('QR link copied', 'success'))
    .catch(() => toast('Copy failed', 'error'));
}

function showQR(t) {
  const url = buildQRUrl(t.qr_token);
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 text-center' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800 mb-1' }, t.name));
  card.appendChild(el('p', { class: 'text-xs text-slate-500 mb-4' }, 'Scan to order from this table'));

  const qrImg = el('img', {
    src: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`,
    class: 'mx-auto rounded-lg border border-slate-200',
    width: '240', height: '240',
    alt: 'QR',
  });
  card.appendChild(qrImg);

  card.appendChild(el('div', { class: 'text-[10px] text-slate-400 mt-3 font-mono break-all' }, url));

  const row = el('div', { class: 'grid grid-cols-2 gap-2 mt-4' }, [
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium',
      onclick: () => { copyQRLink(t); },
    }, 'Copy Link'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-semibold',
      onclick: () => { window.print(); },
    }, 'Print'),
  ]);
  card.appendChild(row);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ============================================================
// AREA EDITOR
// ============================================================
function openAreaEditor(root, area) {
  const isNew = !area;
  const draft = area ? { ...area } : {
    tenant_id: store.state.tenant.id,
    outlet_id: store.state.outlet.id,
    name: '',
    description: '',
    floor_level: 0,
    sort_order: state.areas.length + 1,
    is_active: true,
  };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4' });

  card.appendChild(el('h3', { class: 'font-bold text-lg text-slate-800' }, isNew ? 'New Floor Area' : 'Edit Area'));

  card.appendChild(el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, 'Name *'),
    el('input', {
      type: 'text', value: draft.name, placeholder: 'e.g. Main Hall, Terrace, Bar',
      class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
      oninput: (e) => { draft.name = e.target.value; },
    }),
  ]));

  card.appendChild(el('div', {}, [
    el('label', { class: 'block text-xs font-medium text-slate-600 mb-1' }, 'Description'),
    el('input', {
      type: 'text', value: draft.description || '', placeholder: 'Optional',
      class: 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
      oninput: (e) => { draft.description = e.target.value; },
    }),
  ]));

  const footer = el('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
    el('button', {
      class: 'py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm',
      onclick: () => overlay.remove(),
    }, 'Cancel'),
    el('button', {
      class: 'py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!draft.name || !draft.name.trim()) { toast('Name required', 'warn'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const payload = {
            tenant_id: draft.tenant_id,
            outlet_id: draft.outlet_id,
            name: draft.name.trim(),
            description: draft.description?.trim() || null,
            floor_level: draft.floor_level || 0,
            sort_order: draft.sort_order || 0,
            is_active: true,
          };
          if (isNew) {
            const { data, error } = await supabase.from('floor_areas').insert(payload).select().single();
            if (error) throw error;
            state.areas.push(data);
            state.currentAreaId = data.id;
          } else {
            const { error } = await supabase.from('floor_areas').update(payload).eq('id', area.id);
            if (error) throw error;
            const idx = state.areas.findIndex(a => a.id === area.id);
            if (idx >= 0) state.areas[idx] = { ...state.areas[idx], ...payload };
          }
          toast(isNew ? 'Area created' : 'Area saved', 'success');
          overlay.remove();
          paint(root);
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      },
    }, isNew ? 'Create' : 'Save'),
  ]);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => card.querySelector('input')?.focus(), 50);
}
