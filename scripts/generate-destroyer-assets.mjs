// Generates the destroyer (Zerstörer) sprite and appends it to the unit sprite
// atlas used by UnitPass (WebGL renderer).
//
// Mirrors scripts/generate-submarine-assets.mjs: the unit atlas is a single row
// of 13x13 RGBA cells, one per mobile unit. Sprites are grayscale PNGs whose
// pixels use exactly three gray bands — 180 (light), 130 (mid) and 70 (dark) —
// which the GPU colorizes per player. This script decodes the committed atlas,
// appends one new column for the destroyer, and re-encodes it. It also emits
// the standalone sprite used by the canvas2D SpriteLoader path.
//
// Usage: node scripts/generate-destroyer-assets.mjs

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const ATLAS_PATH = path.join(root, "resources/atlases/unit-atlas.png");
const SPRITE_PATH = path.join(root, "resources/sprites/destroyer.png");

const CELL = 13;
const LIGHT = 180;
const MID = 130;
const DARK = 70;

// 11x11 destroyer: sleek surface hull, twin gun turrets, mast.
// "." = transparent, "A" = light, "C" = mid, "B" = dark.
const DESTROYER_ART = [
  "...........",
  "...A...A...",
  "..AAA.AAA..",
  "..AAAAAAAA.",
  ".AAAAAAAAAA",
  "AAAAAAAAAAA",
  "ABBBBBBBBBB",
  "ABBBBBBBBBB",
  "..BBBBBBBB.",
  "...........",
  "...........",
];

function artToRgba(art) {
  const h = art.length;
  const w = art[0].length;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = art[y][x];
      const i = (y * w + x) * 4;
      if (ch === ".") continue;
      const g = ch === "A" ? LIGHT : ch === "C" ? MID : DARK;
      px[i] = g;
      px[i + 1] = g;
      px[i + 2] = g;
      px[i + 3] = 255;
    }
  }
  return { px, w, h };
}

// ---------------------------------------------------------------------------
// PNG decode (8-bit, color types 2/6 only — the atlas is RGBA).
// ---------------------------------------------------------------------------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  const idat = [];
  const ihdr = {};
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr.width = data.readUInt32BE(0);
      ihdr.height = data.readUInt32BE(4);
      ihdr.bitDepth = data[8];
      ihdr.colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const bpp = ihdr.colorType === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(ihdr.height * stride);
  for (let y = 0; y < ihdr.height; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      let v = row[x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 255;
      }
      out[y * stride + x] = v;
    }
  }
  return { ...ihdr, data: out, bpp, stride };
}

// ---------------------------------------------------------------------------
// PNG encode (RGBA, 8-bit, filter 0 per scanline).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// dstStride is in BYTES (pixels per row × 4).
function stampInto(dst, dstStride, sprite, offsetX, offsetY) {
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const srcI = (y * sprite.w + x) * 4;
      if (sprite.px[srcI + 3] === 0) continue;
      const dx = offsetX + x;
      const dy = offsetY + y;
      const dstI = dy * dstStride + dx * 4;
      sprite.px.copy(dst, dstI, srcI, srcI + 4);
    }
  }
}

const destroyer = artToRgba(DESTROYER_ART);

// 1. Standalone sprite (11x11).
writeFileSync(
  SPRITE_PATH,
  encodePng(destroyer.w, destroyer.h, destroyer.px),
);
console.log(`wrote ${SPRITE_PATH} (${destroyer.w}x${destroyer.h})`);

// 2. Append the destroyer as a new column of the committed unit atlas.
const atlas = decodePng(readFileSync(ATLAS_PATH));
if (atlas.height !== CELL) {
  throw new Error(`unexpected atlas height ${atlas.height}`);
}
const newWidth = atlas.width + CELL;
const newData = Buffer.alloc(newWidth * CELL * 4);
for (let y = 0; y < CELL; y++) {
  atlas.data.copy(
    newData,
    y * newWidth * 4,
    y * atlas.stride,
    y * atlas.stride + atlas.stride,
  );
}
const offsetX = atlas.width + Math.floor((CELL - destroyer.w) / 2);
const offsetY = Math.floor((CELL - destroyer.h) / 2);
stampInto(newData, newWidth * 4, destroyer, offsetX, offsetY);
writeFileSync(ATLAS_PATH, encodePng(newWidth, CELL, newData));
console.log(`wrote ${ATLAS_PATH} (${newWidth}x${CELL})`);
