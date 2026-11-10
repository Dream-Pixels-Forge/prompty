import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * S3 — toolbar icons. 16/32 px are the simplified glyph (src/icons/glyph.svg,
 * rendered by scripts/icons.mjs); 48/128 px are the full mascot.
 */
const read = (/** @type {string} */ rel) => readFileSync(new URL(`../${rel}`, import.meta.url));

/**
 * Minimal PNG decoder for 8-bit RGBA, non-interlaced (what Chromium and PIL emit).
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, pixel: (x: number, y: number) => number[] }}
 */
function decodePng(buf) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let pos = 8;
  let width = 0;
  let height = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0]); // 8-bit, RGBA, no interlace
    }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)],
  };
}

/** @param {string} hex */
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** @param {string} a @param {string} b */
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const LIGHT_TOOLBAR = '#f1f3f4';
const DARK_TOOLBAR = '#202124';

describe('icon files', () => {
  for (const size of [16, 32, 48, 128]) {
    it(`icon-${size}.png is ${size}×${size} RGBA with (near-)transparent corners`, () => {
      const png = decodePng(read(`src/icons/icon-${size}.png`));
      expect([png.width, png.height]).toEqual([size, size]);
      // Antialiased rounded corners may keep a sliver of alpha (≤ 15/255).
      expect(png.pixel(0, 0)[3]).toBeLessThan(16);
      expect(png.pixel(size - 1, size - 1)[3]).toBeLessThan(16);
      expect(png.pixel(size >> 1, size >> 1)[3]).toBe(255);
    });
  }

  it('manifest icons and action.default_icon point at the right sizes', () => {
    const manifest = JSON.parse(read('src/manifest.base.json').toString());
    for (const map of [manifest.icons, manifest.action.default_icon]) {
      expect(map).toEqual({
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      });
    }
  });
});

describe('toolbar glyph (glyph.svg)', () => {
  const svg = read('src/icons/glyph.svg').toString();

  it('is a self-contained 16-unit drawing', () => {
    expect(svg).toMatch(/viewBox="0 0 16 16"/);
    // The SVG namespace URI is required and is not a fetch.
    const body = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '');
    expect(body).not.toMatch(/href|https?:|<image|<script|font-family/i);
  });

  it('uses only brand colors', () => {
    const fills = new Set(
      [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()),
    );
    expect([...fills].sort()).toEqual(['#0e0e10', '#ff6a00', '#ffffff']);
  });

  it('reads on light and dark toolbars (≥ 3:1 for an icon edge)', () => {
    // Light toolbar: the dark tile is the edge. Dark toolbar: the white monitor is.
    expect(contrast('#0e0e10', LIGHT_TOOLBAR)).toBeGreaterThanOrEqual(3);
    expect(contrast('#ffffff', DARK_TOOLBAR)).toBeGreaterThanOrEqual(3);
    // The orange cursor stands out on the tile it sits on.
    expect(contrast('#ff6a00', '#0e0e10')).toBeGreaterThanOrEqual(3);
  });

  it('16 px render keeps the glyph’s key pixels: white body, dark screen, orange cursor', () => {
    const png = decodePng(read('src/icons/icon-16.png'));
    const [r, g, b] = png.pixel(2, 6); // monitor body
    expect(Math.min(r, g, b)).toBeGreaterThan(220);
    const screen = png.pixel(5, 9); // between the eyes, on the screen
    expect(Math.max(...screen.slice(0, 3))).toBeLessThan(60);
    const cursor = png.pixel(13, 3); // orange cursor
    expect(cursor[0]).toBeGreaterThan(200);
    expect(cursor[2]).toBeLessThan(80);
  });
});
