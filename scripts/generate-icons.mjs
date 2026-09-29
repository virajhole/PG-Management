/**
 * Generates the PWA icon set with no image dependencies.
 *
 * Everything is rasterised by hand into an RGBA buffer and encoded as PNG with
 * Node's built-in zlib. Shapes are drawn with 4x4 supersampling, so the edges
 * come out smooth without pulling in a canvas library.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public');
const SS = 4; // supersampling factor per axis

const BRAND = [0x1f, 0x3c, 0xf4]; // #1f3cf4
const WHITE = [0xff, 0xff, 0xff];
const SOFT = [0xbf, 0xcc, 0xff]; // lighter brand for the roof

// ------------------------------------------------------------------ canvas

function createCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0) return;
  const i = (y * canvas.size + x) * 4;
  const d = canvas.data;
  const a = Math.min(1, alpha);
  d[i] = Math.round(d[i] * (1 - a) + r * a);
  d[i + 1] = Math.round(d[i + 1] * (1 - a) + g * a);
  d[i + 2] = Math.round(d[i + 2] * (1 - a) + b * a);
  d[i + 3] = Math.max(d[i + 3], Math.round(255 * a));
}

/** Fill any shape by sampling SS x SS sub-pixels per pixel. */
function fill(canvas, colour, inside) {
  const { size } = canvas;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (inside(px, py)) hits += 1;
        }
      }
      if (hits > 0) blend(canvas, x, y, colour, hits / (SS * SS));
    }
  }
}

// --------------------------------------------------------------- geometry

/** Rounded rectangle, used for the app icon background. */
function roundedRect(x0, y0, x1, y1, radius) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
}

/** Even-odd ray casting for a polygon given as [[x, y], ...]. */
function polygon(points) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

// ------------------------------------------------------------ png encoder

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());

  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(canvas) {
  const { size, data } = canvas;
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ icons

/** House-on-rounded-square mark, drawn at any size. */
function drawIcon(size, { maskable = false } = {}) {
  const canvas = createCanvas(size);
  const u = (n) => (n / 100) * size; // work in a 100x100 design grid

  if (maskable) {
    // Maskable icons must fill the whole square; the safe zone is the inner 80%.
    fill(canvas, BRAND, () => true);
  } else {
    fill(canvas, BRAND, roundedRect(0, 0, size - 1, size - 1, u(22)));
  }

  const scale = maskable ? 0.8 : 1;
  const cx = size / 2;
  const cy = size / 2;
  const s = (n) => n * scale; // shrink the glyph for the maskable safe zone

  // Roof
  const roofBottom = cy - s(2);
  const roofHalf = s(30);
  fill(
    canvas,
    SOFT,
    polygon([
      [cx, cy - s(34)],
      [cx - roofHalf, roofBottom],
      [cx + roofHalf, roofBottom],
    ]),
  );

  // House body
  fill(
    canvas,
    WHITE,
    (x, y) => x >= cx - s(21) && x <= cx + s(21) && y >= roofBottom && y <= cy + s(28),
  );

  // Door
  fill(
    canvas,
    BRAND,
    (x, y) =>
      Math.abs(x - cx) <= s(8) &&
      y >= cy + s(6) &&
      y <= cy + s(28) &&
      (() => {
        // Rounded top on the doorway.
        const top = cy + s(6);
        if (y <= top + s(8)) {
          const dy = y - (top + s(8));
          return dx(x, cx, s(8)) + dy * dy <= s(8) ** 2;
        }
        return true;
      })(),
  );

  // Windows
  for (const dir of [-1, 1]) {
    const wx = cx + dir * s(13.5);
    fill(canvas, BRAND, (x, y) => Math.abs(x - wx) <= s(4) && y >= cy + s(4) && y <= cy + s(14));
  }

  return canvas;
}

function dx(x, cx, r) {
  const d = Math.abs(x - cx);
  return d <= r ? 0 : d - r;
}

// -------------------------------------------------------------------- run

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size, maskable } of targets) {
  const png = encodePNG(drawIcon(size, { maskable }));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`wrote ${file} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
