import { openDB } from 'idb';

/**
 * IndexedDB wrapper for binary-ish blobs (customer photos, Aadhaar/PAN scans).
 *
 * Images are kept out of localStorage on purpose: a few compressed scans would
 * blow past the ~5 MB string quota. Records only hold the returned image id, so
 * this module can be swapped for Firebase Storage / S3 without the UI caring.
 */

const DB_NAME = 'pg-manager-db';
const DB_VERSION = 1;
const IMAGE_STORE = 'images';

let dbPromise = null;

function getDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function putImage(id, dataUrl) {
  const db = await getDB();
  await db.put(IMAGE_STORE, { id, dataUrl, savedAt: new Date().toISOString() }, id);
  return id;
}

export async function getImage(id) {
  if (!id) return null;
  const db = await getDB();
  const record = await db.get(IMAGE_STORE, id);
  return record?.dataUrl ?? null;
}

export async function deleteImage(id) {
  if (!id) return;
  const db = await getDB();
  await db.delete(IMAGE_STORE, id);
}

export async function listImageIds() {
  const db = await getDB();
  return db.getAllKeys(IMAGE_STORE);
}

export async function clearImages() {
  const db = await getDB();
  await db.clear(IMAGE_STORE);
}

/** Rough on-disk usage of the image store, for the Settings screen. */
export async function getStorageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      percent: estimate.quota ? estimate.usage / estimate.quota : 0,
    };
  } catch {
    return null;
  }
}
