import { uploadImage, getImageUrl, deleteImage as removeImage } from './supabase.js';

/**
 * Identity documents (customer photos, Aadhaar/PAN scans) - private Supabase
 * Storage. Records only hold a storage *path*; the object lives in a private
 * bucket that is only ever read through a short-lived signed URL.
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
