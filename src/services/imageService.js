import { uploadImage, getImageUrl, deleteImage as removeImage, emptyStorage } from './supabase.js';

/**
 * Identity documents (customer photos, Aadhaar/PAN scans) - private Supabase
 * Storage instead of IndexedDB.
 *
 * Images are kept out of the database rows on purpose: records only hold a
 * storage *path*, and the object itself lives in a private bucket that is only
 * ever read through a short-lived signed URL. Nobody with just the anon key can
 * guess a document: the bucket is not public and the RLS policy requires the
 * first path segment to be the signed-in user's own id.
 */

export async function putImage(path, dataUrl) {
  return uploadImage(path, dataUrl);
}

export async function getImage(path) {
  if (!path) return null;
  return getImageUrl(path);
}

export async function deleteImage(path) {
  if (!path) return;
  return removeImage(path);
}

export async function clearImages() {
  return emptyStorage();
}