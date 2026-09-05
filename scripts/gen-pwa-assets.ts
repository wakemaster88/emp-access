/**
 * Erzeugt die PWA-Grafiken ohne native Abhaengigkeiten:
 *   - public/splash/*.png          iOS-Startbilder (dunkel, Logo mittig)
 *   - public/icon-*-maskable.png   Android-Icons mit Sicherheitszone
 *
 * Aufruf: npx tsx scripts/gen-pwa-assets.ts
 * Ein kleiner PNG-Codec (8 Bit, RGB/RGBA, nicht interlaced) reicht dafuer;
 * sips oder sharp wuerden Alpha nicht so behandeln, wie wir es brauchen.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { SPLASH_BACKGROUND, SPLASH_DEVICES, splashFile } from "../src/lib/pwa-splash";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC = path.join(ROOT, "public");

// ---------- PNG lesen ----------
interface Rgba { width: number; height: number; data: Uint8Array }

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readPng(file: string): Rgba {
  const buf = readFileSync(file);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error(`${file}: kein PNG`);
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`${file}: nur 8-Bit RGB/RGBA ohne Interlace (ist depth=${bitDepth} type=${colorType} interlace=${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = row[x * bpp]; out[o + 1] = row[x * bpp + 1]; out[o + 2] = row[x * bpp + 2];
      out[o + 3] = bpp === 4 ? row[x * bpp + 3] : 255;
    }
    prev = row;
  }
  return { width, height, data: out };
}

// ---------- PNG schreiben (RGB) ----------
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, Buffer.from(data)])));
  return Buffer.concat([len, typeBuf, Buffer.from(data), crc]);
}
function writePng(file: string, width: number, height: number, rgb: Uint8Array) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
  writeFileSync(file, png);
}

// ---------- Verkleinern (Flaechenmittel, alpha-gewichtet) ----------
function resize(src: Rgba, dw: number, dh: number): Rgba {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * src.height) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * src.width) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * src.width + sx) * 4;
          const al = src.data[o + 3];
          r += src.data[o] * al; g += src.data[o + 1] * al; b += src.data[o + 2] * al; a += al; n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: dw, height: dh, data: out };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Bild mit Hintergrundfarbe fuellen und das Logo mittig alpha-blenden. */
function compose(width: number, height: number, bg: string, logo: Rgba, logoSize: number): Uint8Array {
  const [br, bgc, bb] = hexToRgb(bg);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) { rgb[i * 3] = br; rgb[i * 3 + 1] = bgc; rgb[i * 3 + 2] = bb; }
  const scale = logoSize / Math.max(logo.width, logo.height);
  const small = resize(logo, Math.round(logo.width * scale), Math.round(logo.height * scale));
  const ox = Math.round((width - small.width) / 2);
  const oy = Math.round((height - small.height) / 2);
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      const s = (y * small.width + x) * 4;
      const a = small.data[s + 3] / 255;
      if (a === 0) continue;
      const d = ((oy + y) * width + (ox + x)) * 3;
      rgb[d] = Math.round(small.data[s] * a + rgb[d] * (1 - a));
      rgb[d + 1] = Math.round(small.data[s + 1] * a + rgb[d + 1] * (1 - a));
      rgb[d + 2] = Math.round(small.data[s + 2] * a + rgb[d + 2] * (1 - a));
    }
  }
  return rgb;
}

function main() {
  const logoDark = readPng(path.join(PUBLIC, "logo-dark.png")); // helle Schrift fuer dunklen Grund
  const logoLight = readPng(path.join(PUBLIC, "logo.png")); // dunkle Schrift fuer hellen Grund
  mkdirSync(path.join(PUBLIC, "splash"), { recursive: true });

  let count = 0;
  for (const d of SPLASH_DEVICES) {
    const orientations: Array<"portrait" | "landscape"> = d.landscape ? ["portrait", "landscape"] : ["portrait"];
    for (const o of orientations) {
      const w = (o === "portrait" ? d.width : d.height) * d.ratio;
      const h = (o === "portrait" ? d.height : d.width) * d.ratio;
      const logoSize = Math.round(Math.min(w, h) * 0.32);
      writePng(path.join(PUBLIC, splashFile(d, o)), w, h, compose(w, h, SPLASH_BACKGROUND, logoDark, logoSize));
      count++;
    }
  }
  // Maskable-Icons: Android schneidet bis zu 20 % je Seite ab – Logo auf 56 %
  // der Kante, damit es im sicheren Kreis bleibt.
  for (const size of [192, 512]) {
    writePng(path.join(PUBLIC, `icon-${size}-maskable.png`), size, size, compose(size, size, "#ffffff", logoLight, Math.round(size * 0.56)));
  }
  console.log(`${count} Splash-Screens + 2 Maskable-Icons erzeugt (public/splash, public/icon-*-maskable.png)`);
}

main();
