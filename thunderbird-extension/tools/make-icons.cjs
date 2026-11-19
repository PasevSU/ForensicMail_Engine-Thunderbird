#!/usr/bin/env node
/*
 * Icon generator for the add-on.
 *
 * Thunderbird needs real PNG files: `manifest.json` cannot point at a drawing, an
 * SVG or a message string, and Gecko drops an add-on whose declared icon is
 * missing. Nothing in this repository was a binary asset before, so the icons are
 * generated from code and committed — the same rule the rest of the framework
 * follows: the artefact in the repository is reproducible from the source next to
 * it.
 *
 * Why a generator and not four checked-in blobs nobody can read:
 *   - the shape is described once, in numbers, and every size comes from the same
 *     description, so the 16 px and the 128 px icon can never drift apart;
 *   - the palette lives in one place (`PALETTE`), so a rebrand is a two-line edit;
 *   - the encoding is plain PNG (deflate + CRC32) with no dependency, so the
 *     "no runtime dependencies" rule of the repository still holds.
 *
 * Run it after editing the shape or the palette:
 *
 *   node thunderbird-extension/tools/make-icons.cjs
 *
 * It writes thunderbird-extension/icons/pasevsu-<size>.png for every size in
 * `SIZES`. The files are LF-irrelevant (binary) and are expected to be committed.
 *
 * This file lives in a subdirectory on purpose: `tools/check-repo.cjs` scans the
 * top level of `thunderbird-extension/` for Node.js code, because everything there
 * runs inside a MailExtension where `require()` does not exist. This generator is
 * the opposite of that — it runs in Node, before packaging — so it must not be
 * mistaken for add-on source.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];

/*
 * The emblem: a shield (the evidence is sealed, not merely attached) with a check
 * mark inside it (the seal verified). Colours are deliberately dark enough to stay
 * legible on both a light and a dark Thunderbird toolbar, which is why the check is
 * pure white and the shield carries its own light rim instead of relying on the
 * theme background.
 */
const PALETTE = {
  rim: [0x2f, 0x7f, 0xa8, 0xff],
  body: [0x0f, 0x2c, 0x4d, 0xff],
  mark: [0xff, 0xff, 0xff, 0xff],
};

/* Anti-aliasing samples per axis. 4 means 16 samples per pixel: enough for a 16 px
 * icon, invisible on the 128 px one, and fast enough to regenerate in a moment. */
const SUPERSAMPLE = 4;

/** CRC32 table, built once. PNG requires it per chunk regardless of deflate. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/**
 * CRC32 of a buffer, as PNG specifies it.
 *
 * @param {Buffer} buffer Bytes to checksum.
 * @returns {number} Unsigned 32-bit checksum.
 */
function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * One PNG chunk: length, type, payload, CRC32 over type+payload.
 *
 * @param {string} type Four ASCII characters, e.g. `IHDR`.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} The encoded chunk.
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * Encode an RGBA bitmap as a PNG file.
 *
 * @param {number} width Pixel width.
 * @param {number} height Pixel height.
 * @param {Uint8Array} rgba Row-major RGBA bytes, 4 per pixel.
 * @returns {Buffer} A complete PNG file.
 */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte; filter 0 (None) keeps the
  // encoder small and the output is still deflated, so the files stay tiny.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Is a normalised point inside the shield?
 *
 * The shield is described in 0..1 coordinates so the same numbers serve every pixel
 * size: two vertical flanks from a rounded top down to the shoulders at 55 % height,
 * then a curve that closes in a point at 92 % height.
 *
 * @param {number} x Horizontal position, 0..1.
 * @param {number} y Vertical position, 0..1.
 * @returns {boolean} `true` when the point belongs to the body.
 */
function insideShield(x, y) {
  const top = 0.08;
  const shoulder = 0.55;
  const tip = 0.92;
  const halfWidth = 0.36;
  const cx = 0.5;

  if (y < top || y > tip) {
    return false;
  }
  // Rounded top: a quarter circle of radius `halfWidth` centred a radius below `top`.
  if (y < top + halfWidth * 0.42) {
    const radius = halfWidth * 0.9;
    const dy = top + radius - y;
    return Math.abs(x - cx) <= Math.sqrt(Math.max(0, radius * radius - dy * dy));
  }
  if (y <= shoulder) {
    return Math.abs(x - cx) <= halfWidth;
  }
  // Taper: linear from the shoulder to the tip, squared off so the tip reads as a
  // point rather than a needle.
  const t = (y - shoulder) / (tip - shoulder);
  const width = halfWidth * (1 - t) * (1 - t * 0.35);
  return Math.abs(x - cx) <= Math.max(width, 0);
}

/**
 * Is a normalised point inside the check mark?
 *
 * Two thick segments: a short down-stroke and a long up-stroke. Thickness is given
 * in normalised units, so the stroke keeps the same visual weight at every size
 * (and does not collapse to nothing on the 16 px icon).
 *
 * @param {number} x Horizontal position, 0..1.
 * @param {number} y Vertical position, 0..1.
 * @returns {boolean} `true` when the point belongs to the mark.
 */
function insideMark(x, y) {
  const thickness = 0.085;
  const segments = [
    // down-stroke: from the left shoulder of the tick to the elbow
    [
      [0.34, 0.5],
      [0.46, 0.63],
    ],
    // up-stroke: from the elbow to the top right
    [
      [0.46, 0.63],
      [0.68, 0.37],
    ],
  ];
  return segments.some(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)
    );
    const px = ax + t * dx;
    const py = ay + t * dy;
    return Math.hypot(x - px, y - py) <= thickness;
  });
}

/**
 * Colour of a normalised point, or `null` for transparent.
 *
 * @param {number} x Horizontal position, 0..1.
 * @param {number} y Vertical position, 0..1.
 * @returns {number[] | null} RGBA quadruple, or `null` outside the emblem.
 */
function colourAt(x, y) {
  if (!insideShield(x, y)) {
    return null;
  }
  if (insideMark(x, y)) {
    return PALETTE.mark;
  }
  // Rim: a point is on the band when stepping in any direction leaves the shield,
  // which is a cheap erosion — the morphological way to say "within `inset` of the
  // border" without measuring a distance to a curve that has no closed form here.
  const inset = 0.06;
  const rim =
    !insideShield(x - inset, y) ||
    !insideShield(x + inset, y) ||
    !insideShield(x, y - inset) ||
    !insideShield(x, y + inset);
  return rim ? PALETTE.rim : PALETTE.body;
}

/**
 * Render one icon size to RGBA bytes.
 *
 * @param {number} size Edge length in pixels.
 * @returns {Uint8Array} Row-major RGBA bytes.
 */
function renderIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const colour = colourAt(x, y);
          if (!colour) {
            continue;
          }
          r += colour[0] * colour[3];
          g += colour[1] * colour[3];
          b += colour[2] * colour[3];
          a += colour[3];
        }
      }
      const offset = (py * size + px) * 4;
      if (a === 0) {
        continue;
      }
      // Premultiplied average, converted back to straight alpha.
      rgba[offset] = Math.round(r / a);
      rgba[offset + 1] = Math.round(g / a);
      rgba[offset + 2] = Math.round(b / a);
      rgba[offset + 3] = Math.round(a / samples);
    }
  }
  return rgba;
}

/**
 * Regenerate every icon and report the file that was written.
 *
 * @returns {void}
 */
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = path.join(OUT_DIR, `pasevsu-${size}.png`);
    const png = encodePng(size, size, renderIcon(size));
    fs.writeFileSync(file, png);
    console.log(
      `${path.relative(path.join(__dirname, '..', '..'), file)}  ${size}x${size}  ${png.length} B`
    );
  }
}

main();
