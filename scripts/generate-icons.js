/* Genera los íconos PNG de la PWA (huella de perro sobre fondo teal)
   sin dependencias: rasteriza círculos/elipses y codifica el PNG a mano.
   Uso: node scripts/generate-icons.js */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x1d, 0x7a, 0x74];
const FG = [0xff, 0xff, 0xff];

// Formas de la huella en coordenadas 0..100 (igual que favicon.svg)
const SHAPES = [
  { cx: 50, cy: 62, rx: 17, ry: 14 },
  { cx: 31, cy: 42, rx: 7.5, ry: 7.5 },
  { cx: 43.5, cy: 33, rx: 7.5, ry: 7.5 },
  { cx: 56.5, cy: 33, rx: 7.5, ry: 7.5 },
  { cx: 69, cy: 42, rx: 7.5, ry: 7.5 },
];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function insidePaw(x, y) {
  for (const s of SHAPES) {
    const dx = (x - s.cx) / s.rx;
    const dy = (y - s.cy) / s.ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const SS = 3; // supersampling 3x3 para bordes suaves
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filtro: none
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 100;
          const y = ((py + (sy + 0.5) / SS) / size) * 100;
          if (insidePaw(x, y)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const off = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[off + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profundidad
  ihdr[9] = 2;  // color RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makePng(size));
  console.log(`✓ icon-${size}.png`);
}
