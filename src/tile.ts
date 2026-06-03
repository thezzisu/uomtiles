// Recolor canonical binary mask PNG (stored as #2980b9 α=255) into a different
// (color, alpha) at request time. Uses a tiny custom PNG parser/writer keeping
// the IHDR + IDAT structure but replacing the palette/tRNS.
//
// Our stored PNGs are paletted (palette+alpha index PNG-8). To recolor we
// only need to rewrite PLTE + tRNS chunks; IDAT bytes are untouched, so
// this is O(1) per tile regardless of pixel count.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

interface Chunk {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
}

function parsePng(buf: Uint8Array): Chunk[] {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) throw new Error("Not a PNG");
  }
  const chunks: Chunk[] = [];
  let p = 8;
  while (p < buf.length) {
    const len = readU32(buf, p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const data = buf.subarray(p + 8, p + 8 + len);
    const raw = buf.subarray(p, p + 8 + len + 4);
    chunks.push({ type, data, raw });
    p += 8 + len + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + 4);
  writeU32(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput[0] = out[4];
  crcInput[1] = out[5];
  crcInput[2] = out[6];
  crcInput[3] = out[7];
  crcInput.set(data, 4);
  writeU32(out, 8 + data.length, crc32(crcInput));
  return out;
}

/**
 * Recolor a palette PNG produced by our binarise pipeline.
 * Replaces PLTE and tRNS to make opaque entries -> (r,g,b,alpha) and
 * transparent entries -> (0,0,0,0).
 *
 * Heuristic for which palette index is "opaque": find the tRNS entry
 * with the largest alpha. That's the one we recolor.
 */
export function recolorMaskPng(input: Uint8Array, r: number, g: number, b: number, alpha: number): Uint8Array {
  const chunks = parsePng(input);
  const ihdr = chunks.find(c => c.type === "IHDR");
  if (!ihdr) throw new Error("missing IHDR");
  const colorType = ihdr.data[9];
  // Paletted: colorType === 3. If not paletted (rare for our pipeline), fallback to passthrough.
  if (colorType !== 3) return input;

  const plte = chunks.find(c => c.type === "PLTE");
  const trns = chunks.find(c => c.type === "tRNS");
  if (!plte) return input;
  const nEntries = Math.floor(plte.data.length / 3);
  const newPlte = new Uint8Array(plte.data);
  const trnsLen = trns ? trns.data.length : 0;
  const newTrns = new Uint8Array(Math.max(trnsLen, nEntries));
  if (trns) newTrns.set(trns.data);
  for (let i = trnsLen; i < nEntries; i++) newTrns[i] = 255;

  // Find which palette index is the "opaque content" - the one with non-zero
  // alpha (server's binarised tiles have palette index 0 = transparent
  // background, 1 = opaque content - but be flexible).
  let opaqueIdx = -1;
  for (let i = 0; i < newTrns.length; i++) {
    if (newTrns[i] >= 200) {
      opaqueIdx = i;
      break;
    }
  }
  if (opaqueIdx < 0) {
    // No opaque entry — pick the brightest palette entry as the "content" color
    let maxSum = -1;
    for (let i = 0; i < nEntries; i++) {
      const sum = newPlte[i * 3] + newPlte[i * 3 + 1] + newPlte[i * 3 + 2];
      if (sum > maxSum) {
        maxSum = sum;
        opaqueIdx = i;
      }
    }
  }
  newPlte[opaqueIdx * 3] = r;
  newPlte[opaqueIdx * 3 + 1] = g;
  newPlte[opaqueIdx * 3 + 2] = b;
  newTrns[opaqueIdx] = alpha;

  // Stitch new PNG
  const out: Uint8Array[] = [new Uint8Array(PNG_SIG)];
  for (const c of chunks) {
    if (c.type === "PLTE") {
      out.push(makeChunk("PLTE", newPlte));
    } else if (c.type === "tRNS") {
      out.push(makeChunk("tRNS", newTrns));
    } else if (c.type === "IHDR") {
      out.push(c.raw);
    } else if (c.type !== "tRNS" || trns) {
      out.push(c.raw);
    } else {
      out.push(c.raw);
    }
  }
  // If no tRNS originally existed, insert one after PLTE
  if (!trns) {
    // Find PLTE index in out, insert tRNS after it
    const result: Uint8Array[] = [];
    for (const piece of out) {
      result.push(piece);
      if (piece.length >= 8) {
        const t = String.fromCharCode(piece[4], piece[5], piece[6], piece[7]);
        if (t === "PLTE") result.push(makeChunk("tRNS", newTrns));
      }
    }
    return concat(result);
  }
  return concat(out);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function parseColorHex(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  if (h.length !== 6) return [0x29, 0x80, 0xb9];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function clampAlpha(a: string | number): number {
  const n = typeof a === "string" ? parseInt(a, 10) : a;
  if (!Number.isFinite(n)) return 153;
  return Math.max(0, Math.min(255, n));
}

// ----- Overzoom: pixel-perfect sub-region extract + nearest-neighbor upscale -----
//
// UOM polygons are unions of axis-aligned rectangles whose minimum primitive
// size is well > 1 z=13 pixel. Therefore at z>13 the correct visual is each
// z=13 pixel rendered as a sharp 2^dz × 2^dz block — NOT bilinear smoothing.
//
// Algorithm: decode paletted IDAT → extract correct 1/(2^dz × 2^dz) sub-region
// → nearest-neighbor upscale → re-encode IDAT.

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPalette(stream: Uint8Array, w: number, h: number): Uint8Array {
  // 1 byte filter + w bytes of palette indices per row.
  const expected = h * (1 + w);
  if (stream.length < expected) throw new Error(`unfilter: expected ${expected} bytes, got ${stream.length}`);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ft = stream[y * (1 + w)];
    const rowStart = y * (1 + w) + 1;
    const dstStart = y * w;
    if (ft === 0) {
      // None
      for (let x = 0; x < w; x++) out[dstStart + x] = stream[rowStart + x];
    } else if (ft === 1) {
      // Sub: cur = raw + prev
      out[dstStart] = stream[rowStart];
      for (let x = 1; x < w; x++) out[dstStart + x] = (stream[rowStart + x] + out[dstStart + x - 1]) & 0xff;
    } else if (ft === 2) {
      // Up: cur = raw + above
      for (let x = 0; x < w; x++) {
        const above = y > 0 ? out[(y - 1) * w + x] : 0;
        out[dstStart + x] = (stream[rowStart + x] + above) & 0xff;
      }
    } else if (ft === 3) {
      // Average: cur = raw + floor((left + above) / 2)
      for (let x = 0; x < w; x++) {
        const left = x > 0 ? out[dstStart + x - 1] : 0;
        const above = y > 0 ? out[(y - 1) * w + x] : 0;
        out[dstStart + x] = (stream[rowStart + x] + ((left + above) >> 1)) & 0xff;
      }
    } else if (ft === 4) {
      // Paeth
      for (let x = 0; x < w; x++) {
        const left = x > 0 ? out[dstStart + x - 1] : 0;
        const above = y > 0 ? out[(y - 1) * w + x] : 0;
        const upperLeft = x > 0 && y > 0 ? out[(y - 1) * w + x - 1] : 0;
        out[dstStart + x] = (stream[rowStart + x] + paethPredictor(left, above, upperLeft)) & 0xff;
      }
    } else {
      throw new Error(`unknown filter ${ft} at row ${y}`);
    }
  }
  return out;
}

function refilterNone(pixels: Uint8Array, w: number, h: number): Uint8Array {
  // Add filter type 0 (None) at start of each row.
  const out = new Uint8Array(h * (1 + w));
  for (let y = 0; y < h; y++) {
    out[y * (1 + w)] = 0;
    out.set(pixels.subarray(y * w, (y + 1) * w), y * (1 + w) + 1);
  }
  return out;
}

/**
 * Pixel-perfect overzoom for paletted PNG-8.
 * @param input  256×256 paletted PNG
 * @param dz     extra zoom levels beyond native (1..N)
 * @param subX   sub-tile x within parent (0..2^dz-1)
 * @param subY   sub-tile y within parent (0..2^dz-1)
 * @returns new 256×256 paletted PNG showing only the (subX, subY) quadrant of
 *          the parent, with each parent pixel repeated 2^dz times in both dims.
 */
export async function overzoomTile(input: Uint8Array, dz: number, subX: number, subY: number): Promise<Uint8Array> {
  if (dz <= 0) return input;
  const chunks = parsePng(input);
  const ihdr = chunks.find(c => c.type === "IHDR");
  if (!ihdr) throw new Error("missing IHDR");
  const w = readU32(ihdr.data, 0);
  const h = readU32(ihdr.data, 4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  if (w !== 256 || h !== 256 || bitDepth !== 8 || colorType !== 3) return input;

  // Concat IDAT
  const idatChunks = chunks.filter(c => c.type === "IDAT");
  if (idatChunks.length === 0) return input;
  let totalIdat = 0;
  for (const c of idatChunks) totalIdat += c.data.length;
  const idatRaw = new Uint8Array(totalIdat);
  {
    let off = 0;
    for (const c of idatChunks) {
      idatRaw.set(c.data, off);
      off += c.data.length;
    }
  }
  const decompressed = await inflateZlib(idatRaw);
  const pixels = unfilterPalette(decompressed, w, h);

  // Extract sub-region + nearest-neighbor upscale
  const subSize = 256 >> dz;
  if (subSize < 1) return input;
  const out = new Uint8Array(256 * 256);
  const sx0 = subX * subSize;
  const sy0 = subY * subSize;
  for (let dy = 0; dy < 256; dy++) {
    const srcY = sy0 + (dy >> dz);
    const srcRow = srcY * 256;
    const dstRow = dy * 256;
    for (let dx = 0; dx < 256; dx++) {
      out[dstRow + dx] = pixels[srcRow + sx0 + (dx >> dz)];
    }
  }

  const refiltered = refilterNone(out, 256, 256);
  const recompressed = await deflateZlib(refiltered);

  // Rebuild PNG: keep IHDR/PLTE/tRNS, replace IDAT, keep IEND
  const newParts: Uint8Array[] = [new Uint8Array(PNG_SIG)];
  let idatInserted = false;
  for (const c of chunks) {
    if (c.type === "IDAT") {
      if (!idatInserted) {
        newParts.push(makeChunk("IDAT", recompressed));
        idatInserted = true;
      }
      continue;
    }
    newParts.push(c.raw);
  }
  return concat(newParts);
}
