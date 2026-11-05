import { saveSnapshot, loadSnapshot } from './offline-db.js';

// Cache-aside wrapper:
// 1. Try the network first.
// 2. On success → write to IndexedDB and return the fresh data.
// 3. On failure → read the last cached snapshot.
// 4. If no cache exists → re-throw the original error.

export async function cachedQuery(key, fetcher, { ttlMs = 0 } = {}) {
  // 1. Try to load from cache FIRST (Instant Load)
  const snap = await loadSnapshot(key).catch(() => null);
  
  if (snap && snap.data !== undefined) {
    // FIRE AND FORGET: Fetch fresh data in the background to update cache for next time
    fetcher().then(fresh => {
        saveSnapshot(key, { data: fresh, at: Date.now() }).catch(() => {});
    }).catch(err => {
        console.warn(`[cache] background update failed for "${key}"`, err?.message || err);
    });
    
    // Return the cached data immediately so the UI loads instantly
    return { data: snap.data, cached: true, at: snap.at };
  }

  // 2. If NO cache exists, we must wait for the network
  try {
    const fresh = await fetcher();
    saveSnapshot(key, { data: fresh, at: Date.now() }).catch(() => {});
    return { data: fresh, cached: false, at: Date.now() };
  } catch (err) {
    console.warn(`[cache] network failed and no cache exists for "${key}"`, err?.message || err);
    throw err;
  }
}

// Same as cachedQuery but returns a fallback value instead of throwing
// when both network and cache fail.
export async function cachedQuerySafe(key, fetcher, fallback = []) {
  try {
    const result = await cachedQuery(key, fetcher);
    return result;
  } catch {
    return { data: fallback, cached: true, at: 0, empty: true };
  }
}

// Cache keys — central place so we don't typo them
export const CACHE_KEYS = {
  categories: (tenantId, outletId) => `menu:categories:${tenantId}:${outletId}`,
  items:      (tenantId)           => `menu:items:${tenantId}`,
  variants:   (tenantId)           => `menu:variants:${tenantId}`,
  taxRates:   (tenantId)           => `tax:rates:${tenantId}`,
  stations:   (outletId)           => `stations:${outletId}`,
  tables:     (outletId)           => `tables:${outletId}`,
  areas:      (outletId)           => `areas:${outletId}`,
  hsnCodes:   (tenantId)           => `hsn:codes:${tenantId}`,
};

// Report how much cached data we have for an outlet
export async function inspectCache(tenantId, outletId) {
  const keys = [
    CACHE_KEYS.categories(tenantId, outletId),
    CACHE_KEYS.items(tenantId),
    CACHE_KEYS.variants(tenantId),
    CACHE_KEYS.taxRates(tenantId),
    CACHE_KEYS.stations(outletId),
    CACHE_KEYS.tables(outletId),
    CACHE_KEYS.areas(outletId),
  ];
  const out = {};
  for (const k of keys) {
    const snap = await loadSnapshot(k).catch(() => null);
    out[k] = snap ? { rows: Array.isArray(snap.data) ? snap.data.length : 'n/a', age_ms: Date.now() - snap.at } : null;
  }
  return out;
}
