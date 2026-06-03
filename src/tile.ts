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
