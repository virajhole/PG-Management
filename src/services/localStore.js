/**
 * Tiny synchronous key/value store on top of localStorage.
 *
 * When storage is unavailable (private mode, disabled cookies, SSR) we degrade
 * to an in-memory map rather than crash. The probe result is cached so a normal
 * browser never mixes the two sources.
 */

const memoryFallback = new Map();
let storageAvailable = null;
let warned = false;

function getStorage() {
  if (storageAvailable !== null) return storageAvailable ? window.localStorage : null;
  try {
    const probe = '__pgm_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storageAvailable = true;
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn('[storage] localStorage unavailable, falling back to in-memory storage.', error);
    }
    storageAvailable = false;
  }
  return storageAvailable ? window.localStorage : null;
}

/** Test seam: forget the probe result and the in-memory mirror. */
export function resetStorageCache() {
  storageAvailable = null;
  warned = false;
  memoryFallback.clear();
}

export function readJSON(key, fallback = null) {
  const store = getStorage();
  if (!store) return memoryFallback.has(key) ? memoryFallback.get(key) : fallback;
  try {
    const raw = store.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[storage] could not parse "${key}", using fallback.`, error);
    return fallback;
  }
}

export function writeJSON(key, value) {
  const store = getStorage();
  if (!store) {
    memoryFallback.set(key, value);
    return false;
  }
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[storage] could not persist "${key}", keeping value in memory.`, error);
    memoryFallback.set(key, value);
    return false;
  }
}

export function removeKey(key) {
  memoryFallback.delete(key);
  const store = getStorage();
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const KEYS = {
  customers: 'pgm.customers.v1',
  settings: 'pgm.settings.v1',
  session: 'pgm.session.v1',
  seeded: 'pgm.seeded.v1',
};
