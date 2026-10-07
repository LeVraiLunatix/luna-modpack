// Encodage/décodage PNG minimalistes (sans dépendance) et une petite toile RGBA.
import { crc32, deflateSync, inflateSync } from "node:zlib";

export class Canvas {
  constructor(width, height, fill = [0, 0, 0, 0]) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) this.data.set(fill, i * 4);
  }

  get(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(rgba, (y * this.width + x) * 4);
  }

  // Composite « source over » d'une couleur RGBA (composantes 0-255, alpha 0-1 en 4e position).
  blend(x, y, [r, g, b, a = 1]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const i = (y * this.width + x) * 4;
    const da = this.data[i + 3];
    const oa = a + da * (1 - a);
    for (let c = 0; c < 3; c++)
      this.data[i + c] = oa ? ([r, g, b][c] * a + this.data[i + c] * da * (1 - a)) / oa : 0;
    this.data[i + 3] = oa;
  }

  rect(x, y, w, h, rgba) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.blend(i, j, rgba);
  }

  // Agrandit chaque pixel en un bloc scale×scale (pixel art net).
  upscale(scale) {
    const out = new Canvas(this.width * scale, this.height * scale);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) out.set(x, y, this.get(Math.floor(x / scale), Math.floor(y / scale)));
    return out;
  }

  toPng() {
    return encodePng(this.width, this.height, (x, y) => this.get(x, y));
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pixel(x, y) renvoie [r, g, b, a] avec r,g,b en 0-255 et a en 0-1.
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = row + 1 + x * 4;
      raw[o] = clamp255(r);
      raw[o + 1] = clamp255(g);
      raw[o + 2] = clamp255(b);
      raw[o + 3] = clamp255(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Décodeur limité aux PNG 8 bits non entrelacés (gris, RGB, palette, gris+alpha, RGBA).
export function decodePng(buf) {
  let p = 8, width, height, type, palette, trns;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("PNG non pris en charge");
      type = data[9];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = v & 255;
    }
  }
  const canvas = new Canvas(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * stride + x * channels;
      let rgba;
      if (type === 0) rgba = [px[o], px[o], px[o], 1];
      else if (type === 2) rgba = [px[o], px[o + 1], px[o + 2], 1];
      else if (type === 4) rgba = [px[o], px[o], px[o], px[o + 1] / 255];
      else if (type === 6) rgba = [px[o], px[o + 1], px[o + 2], px[o + 3] / 255];
      else {
        const i = px[o];
        rgba = [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] / 255 : 1];
      }
      canvas.set(x, y, rgba);
    }
  return canvas;
}
