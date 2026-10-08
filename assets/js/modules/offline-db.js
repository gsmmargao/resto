// Lightweight IndexedDB wrapper — no dependencies.

const DB_NAME = 'resto-offline';
const DB_VERSION = 1;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('operations')) {
        const store = db.createObjectStore('operations', { keyPath: 'id' });
        store.createIndex('queued_at', 'queued_at');
        store.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'key' });
      }
    };
  });
}

// ---------------- Operation queue ----------------

export async function enqueue(op) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readwrite');
    const store = tx.objectStore('operations');
    const record = {
      id: crypto.randomUUID(),
      queued_at: Date.now(),
      attempts: 0,
      status: 'pending',
      ...op,
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function listPending(limit = 50) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readonly');
    const idx = tx.objectStore('operations').index('queued_at');
    const out = [];
    idx.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || out.length >= limit) return resolve(out);
      if (cursor.value.status === 'pending') out.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function listAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readonly');
    const req = tx.objectStore('operations').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.queued_at - a.queued_at));
    req.onerror = () => reject(req.error);
  });
}

export async function updateOperation(id, patch) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readwrite');
    const store = tx.objectStore('operations');
    const get = store.get(id);
    get.onsuccess = () => {
      const existing = get.result;
      if (!existing) return resolve(null);
      const merged = { ...existing, ...patch };
      const put = store.put(merged);
      put.onsuccess = () => resolve(merged);
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

export async function deleteOperation(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readwrite');
    const req = tx.objectStore('operations').delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function countPending() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', 'readonly');
    const idx = tx.objectStore('operations').index('queued_at');
    let n = 0;
    idx.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(n);
      if (cursor.value.status === 'pending') n++;
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Snapshots ----------------

export async function saveSnapshot(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const req = tx.objectStore('snapshots').put({ key, value, updated_at: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['operations', 'snapshots'], 'readwrite');
    tx.objectStore('operations').clear();
    tx.objectStore('snapshots').clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
