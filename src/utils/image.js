/**
 * Client-side image handling.
 *
 * Phone cameras produce 3-8 MB files. We downscale to a max edge of 800px and
 * re-encode as JPEG before handing the data URL to the storage layer, which
 * keeps a few hundred ID photos comfortably inside IndexedDB.
 */

const MAX_EDGE = 800;
const DEFAULT_QUALITY = 0.72;

/** Rough byte size of a base64 data URL (base64 encodes 3 bytes in 4 chars). */
export function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

/**
 * Downscale + re-encode a picked image.
 * Resolves to `{ dataUrl, width, height, bytes, type }` or rejects with a
 * user-facing error message.
 */
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = DEFAULT_QUALITY } = {}) {
  if (!file) throw new Error('No file selected.');
  if (!file.type?.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG or HEIC).');
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('Image is too large. Please pick one under 25 MB.');
  }

  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not supported on this device.');

  // White backdrop so transparent PNGs do not turn black once encoded as JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // Step quality down until we land under a sane budget.
  let qualityStep = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', qualityStep);
  while (dataUrlBytes(dataUrl) > 400 * 1024 && qualityStep > 0.35) {
    qualityStep -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', qualityStep);
  }

  return { dataUrl, width, height, bytes: dataUrlBytes(dataUrl), type: 'image/jpeg' };
}
