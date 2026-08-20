/**
 * Gerador minimalista de PNG (RGBA 8-bit) sem dependências.
 * Usado para criar as texturas do mod (bola, ícones, pack icon).
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function hex(h) {
  const m = h.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
    a: m.length >= 8 ? parseInt(m.slice(6, 8), 16) : 255,
  };
}

/** Cria um canvas RGBA simples com primitivas de desenho. */
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4); // transparente
  }
  px(x, y, color) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = typeof color === 'string' ? hex(color) : color;
    const i = (y * this.w + x) * 4;
    // alpha blend simples
    const a = c.a / 255;
    if (a >= 1) {
      this.data[i] = c.r; this.data[i + 1] = c.g; this.data[i + 2] = c.b; this.data[i + 3] = 255;
    } else if (a > 0) {
      const ia = 1 - a;
      this.data[i] = Math.round(c.r * a + this.data[i] * ia);
      this.data[i + 1] = Math.round(c.g * a + this.data[i + 1] * ia);
      this.data[i + 2] = Math.round(c.b * a + this.data[i + 2] * ia);
      this.data[i + 3] = Math.min(255, Math.round(this.data[i + 3] * ia + 255 * a));
    }
  }
  fillRect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, color);
  }
  circle(cx, cy, r, color) {
    const r2 = r * r;
    for (let j = Math.floor(cy - r - 1); j <= cy + r + 1; j++) {
      for (let i = Math.floor(cx - r - 1); i <= cx + r + 1; i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.px(i, j, color);
      }
    }
  }
  ellipse(cx, cy, rx, ry, color) {
    const r2 = 1 / (rx * rx + ry * ry);
    for (let j = Math.floor(cy - ry - 1); j <= cy + ry + 1; j++) {
      for (let i = Math.floor(cx - rx - 1); i <= cx + rx + 1; i++) {
        const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(i, j, color);
      }
    }
  }
  /** Polígono preenchido (regra do raio) a partir de pontos [[x,y],...]. */
  poly(pts, color) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let j = Math.floor(minY); j <= Math.ceil(maxY); j++) {
      for (let i = Math.floor(minX); i <= Math.ceil(maxX); i++) {
        if (pointInPoly(i + 0.5, j + 0.5, pts)) this.px(i, j, color);
      }
    }
  }
  pentagon(cx, cy, r, rotDeg, color) {
    const pts = [];
    const rot = (rotDeg * Math.PI) / 180;
    for (let k = 0; k < 5; k++) {
      const a = rot + (k * 2 * Math.PI) / 5;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    this.poly(pts, color);
  }
  /** Duplica a região [sx,sy,sx+w,sy+h] escalada por `s` em (dx,dy). */
  blitScaled(src, sx, sy, w, h, dx, dy, s) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const si = ((sy + j) * src.w + (sx + i)) * 4;
        if (src.data[si + 3] === 0) continue;
        const c = { r: src.data[si], g: src.data[si + 1], b: src.data[si + 2], a: src.data[si + 3] };
        for (let jj = 0; jj < s; jj++) for (let ii = 0; ii < s; ii++) this.px(dx + i * s + ii, dy + j * s + jj, c);
      }
    }
  }
  toPNG(path) {
    const { w, h, data } = this;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0; // filtro none
      data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.concat([
      sig,
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(path, png);
    return png.length;
  }
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

module.exports = { Canvas, hex };
