import {
  Compression,
  EtagMismatch,
  PMTiles,
  type RangeResponse,
  ResolvedValueCache,
  type Source,
  TileType,
} from "pmtiles";

export type Env = {
  BUCKET: R2Bucket;
  PMTILES_KEY: string;
  DJI_KEY: string;
  ALLOWED_ORIGINS?: string;
  CACHE_CONTROL?: string;
};

class KeyNotFoundError extends Error {}

async function nativeDecompress(buf: ArrayBuffer, c: Compression): Promise<ArrayBuffer> {
  if (c === Compression.None || c === Compression.Unknown) return buf;
  if (c === Compression.Gzip) {
    const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  throw new Error(`Unsupported compression: ${c}`);
}

const PMT_CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);

class R2Source implements Source {
  constructor(private env: Env, private key: string) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const resp = await this.env.BUCKET.get(this.key, {
      range: { offset, length },
      onlyIf: etag ? { etagMatches: etag } : undefined,
    });
    if (!resp) throw new KeyNotFoundError(`R2 object ${this.key} not found`);
    const ob = resp as R2ObjectBody;
    if (!ob.body) throw new EtagMismatch();
    return {
      data: await ob.arrayBuffer(),
      etag: ob.etag,
      cacheControl: ob.httpMetadata?.cacheControl,
      expires: ob.httpMetadata?.cacheExpiry?.toISOString(),
    };
  }
}

let _pmt: PMTiles | undefined;
export function getPMT(env: Env): PMTiles {
  if (!_pmt) _pmt = new PMTiles(new R2Source(env, env.PMTILES_KEY), PMT_CACHE, nativeDecompress);
  return _pmt;
}

export { TileType };
