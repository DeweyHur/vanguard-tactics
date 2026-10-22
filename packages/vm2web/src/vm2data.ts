import { readArchive, decompress } from './lbdat';

export const TERRAIN: Record<number, string> = { 0: '평지', 1: '사막', 2: '수풀', 3: '습지', 4: '적설', 5: '썩은늪', 6: '수면판', 7: '물(깊이1)', 8: '물(깊이2)', 9: '물(깊이3)', 10: '장애물', 11: '허공', 12: '마법석(땅)', 13: '마법석(물)', 14: '마법석(불)', 15: '마법석(하늘)', 16: '벽' };
export const ELEMENT: Record<number, string> = { 1: '땅', 2: '물', 3: '불', 4: '하늘' };
export const MOVETYPE: Record<number, string> = { 0: '걷기', 1: '걷기2', 2: '헤엄', 3: '헤엄2', 4: '날기' };
export const MAP_COUNT = 52, MASTER_FIRST = 52, MASTER_COUNT = 38;
export const CHUNK_W = 24, CHUNK_H = 12, HEX_W = 48, ROW_STEP = 18, ODD_OFF = 24, TILE_H = 24 * CHUNK_H;

// ---------- cp949 ----------
const dec949 = new TextDecoder('euc-kr');
let enc949: Map<string, number[]> | null = null;
export function decodeK(b: Uint8Array): string { return dec949.decode(b); }
export function encodeK(s: string): Uint8Array {
  if (!enc949) {
    enc949 = new Map();
    for (let c = 0; c < 128; c++) enc949.set(String.fromCharCode(c), [c]);
    for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x41; b <= 0xfe; b++) {
      const s = dec949.decode(new Uint8Array([a, b]));
      if (s.length === 1 && s !== '�' && !enc949.has(s)) enc949.set(s, [a, b]);
    }
  }
  const out: number[] = [];
  for (const ch of s) { const v = enc949.get(ch); if (v) out.push(...v); else out.push(0x3f); }
  return new Uint8Array(out);
}
export function cstr(b: Uint8Array, off: number, max = 1 << 20): string {
  let e = off; while (e < b.length && e < off + max && b[e] !== 0) e++;
  return decodeK(b.subarray(off, e));
}

// ---------- parsed structures ----------
export interface MapHeader { name: string; ids: number[]; nums: number[]; desc: string; desc2: string; descOff: number; desc2Off: number; raw: Uint8Array }
export interface TileDef { left: number[]; right: number[]; base: number; height: number; terrain: number; flags: number }
export interface Tileset { key: string; imgEntry: number; palEntry: number; defEntry: number; atlas: Uint8Array; chunks: number; pal: Uint8Array; defs: TileDef[] }
export interface MapInfo { index: number; header: MapHeader; tileset: Tileset; tilemapEntry: number; grid: Uint16Array }
export interface Master { index: number; name: string; cls: number; desc: string }
export interface Portrait { w: number; h: number; pixels: Uint8Array; pal: Uint8Array }
export interface Sprite { frames: Uint8Array[]; w: number; h: number }
/** DATA02 entry (blue team) holding each natial's map sprite; red team = +2. Order was identified visually. */
export const NATIAL_SPRITE: number[] = [106, 94, 98, 102, 110, 114, 118, 122, 126, 130, 134, 138, 142, 146, 150, 154, 158, 162, 166, 170, 174, 178, 182, 186];
export const MASTER_SPRITE = (m: number) => (m < 18 ? m * 4 : 72 + (m - 18) * 2);
export interface Natial { index: number; name: string; attack: string; hp: number; stats: number[][]; move: number; element: number; flag1: number; range: number; spell: number; moveType: number; cost: number }

export function parseHeader(raw: Uint8Array): MapHeader {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const ids = Array.from({ length: 8 }, (_, i) => dv.getUint32(16 + i * 4, true));
  const nums = Array.from({ length: 18 }, (_, i) => dv.getUint32(48 + i * 4, true));
  const desc = cstr(raw, 120);
  let p = -1; const after = 120 + encodeK(desc).length + 1;
  for (let i = after; i < raw.length - 1; i++) if (raw[i] === 0xa1 && raw[i + 1] === 0xb6) { p = i; break; }
  return { name: cstr(raw, 0, 16), ids, nums, desc, desc2: p > 0 ? cstr(raw, p) : '', descOff: 120, desc2Off: p, raw };
}

export function parseTiledefs(d: Uint8Array): TileDef[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); const out: TileDef[] = [];
  for (let t = 0; t < 512; t++) {
    const o = t * 100; const left: number[] = [], right: number[] = [];
    for (let k = 0; k < 24; k++) { left.push(dv.getUint16(o + k * 2, true)); right.push(dv.getUint16(o + 48 + k * 2, true)); }
    out.push({ left, right, base: d[o + 96], height: d[o + 97], terrain: d[o + 98], flags: d[o + 99] });
  }
  return out;
}

export class VM2Data {
  entries: Record<string, Uint8Array[]> = {};
  dec = new Map<string, Uint8Array>();
  tilesets = new Map<string, Tileset>();
  maps: MapInfo[] = [];
  masters: Master[] = [];
  exe: Uint8Array | null = null;
  extra: Record<string, Uint8Array> = {};

  load(files: Record<string, Uint8Array>) {
    for (const [name, buf] of Object.entries(files)) {
      const up = name.toUpperCase();
      if (up.endsWith('.EXE')) { this.exe = buf; continue; }
      if (!/^DATA\d\d\.DAT$/.test(up)) { this.extra[up] = buf; continue; }
      this.entries[up.replace('.DAT', '')] = readArchive(buf);
    }
    if (!this.entries.DATA10) throw new Error('DATA10.DAT가 필요합니다');
    this.maps = []; this.masters = []; this.tilesets.clear(); this.dec.clear();
    for (let i = 0; i < MAP_COUNT; i++) {
      const header = parseHeader(this.get('DATA10', i));
      const [img, pal, def, grid] = [2, 3, 4, 5].map((k) => header.ids[k] & 0xffff);
      const key = `${img}`;
      if (!this.tilesets.has(key)) {
        const atlas = this.get('DATA10', img);
        this.tilesets.set(key, { key, imgEntry: img, palEntry: pal, defEntry: def, atlas, chunks: Math.floor(atlas.length / (CHUNK_W * CHUNK_H)), pal: this.get('DATA10', pal), defs: parseTiledefs(this.get('DATA10', def)) });
      }
      const g = this.get('DATA10', grid);
      this.maps.push({ index: i, header, tileset: this.tilesets.get(key)!, tilemapEntry: grid, grid: new Uint16Array(g.buffer.slice(g.byteOffset, g.byteOffset + 2048)) });
    }
    for (let i = MASTER_FIRST; i < MASTER_FIRST + MASTER_COUNT; i++) {
      const d = this.get('DATA10', i);
      this.masters.push({ index: i, name: cstr(d, 0, 20), cls: d[20], desc: cstr(d, 28) });
    }
  }
  has(file: string) { return !!this.entries[file]; }
  /**
   * 256-entry RGBA lookup as the game assembles it (vmv2.exe @0x422c32): 10-15 SYSPAL[0..5], 16 transparent,
   * 17.. map palette (43), 60-99 CHRPAL, 100-127 SYSPAL[12..39], 240-245 SYSPAL[6..11]. Without DATA00 the
   * shared banks fall back to greys.
   */
  palette(mapPal?: Uint8Array): Uint8Array {
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { const g = i === 16 ? 0 : 128; lut[i * 4] = lut[i * 4 + 1] = lut[i * 4 + 2] = g; lut[i * 4 + 3] = i === 16 ? 0 : 255; }
    const put = (dst: number, src: Uint8Array, from: number, n: number) => { for (let k = 0; k < n && (from + k) * 4 + 2 < src.length; k++) { const o = (dst + k) * 4, q = (from + k) * 4; lut[o] = src[q]; lut[o + 1] = src[q + 1]; lut[o + 2] = src[q + 2]; lut[o + 3] = 255; } };
    if (this.entries.DATA00) { const sys = this.get('DATA00', 1), chr = this.get('DATA00', 2); put(10, sys, 0, 6); put(240, sys, 6, 6); put(100, sys, 12, 28); put(60, chr, 0, 40); }
    if (mapPal) put(17, mapPal, 0, mapPal.length >> 2);
    return lut;
  }
  /** map sprite from DATA02: 24x12 chunk atlas + placement table; every record pair is a 6x8 chunk grid = three 48x48 frames */
  sprite(entry: number): Sprite | null {
    if (!this.entries.DATA02 || !this.entries.DATA02[entry]?.length) return null;
    const atlas = this.get('DATA02', entry), defs = this.get('DATA02', entry + 1); const n = Math.floor(atlas.length / 288);
    const dv = new DataView(defs.buffer, defs.byteOffset, defs.byteLength); const frames: Uint8Array[] = [];
    for (let p = 0; p * 192 + 192 <= defs.length; p++) {
      const grid = new Uint8Array(144 * 96).fill(16);
      for (let rec = 0; rec < 2; rec++) for (let s = 0; s < 48; s++) {
        const i = dv.getUint16((p * 2 + rec) * 96 + s * 2, true); if (i === 0x7ff || i >= n) continue;
        const cx = (s >> 3) * 24, cy = (7 - (s & 7)) * 12;
        for (let y = 0; y < 12; y++) grid.set(atlas.subarray(i * 288 + y * 24, i * 288 + y * 24 + 24), (cy + y) * 144 + cx);
      }
      for (let f = 0; f < 3; f++) { const fr = new Uint8Array(48 * 96); for (let y = 0; y < 96; y++) fr.set(grid.subarray(y * 144 + f * 48, y * 144 + f * 48 + 48), y * 48); frames.push(fr); }
    }
    return { frames, w: 48, h: 96 };
  }
  /** natial portrait k (0..23) from DATA09: script entry 27+k names the image entry and its crop box */
  portrait(k: number): Portrait | null {
    if (!this.entries.DATA09) return null;
    const sc = this.get('DATA09', 27 + k); const dv = new DataView(sc.buffer, sc.byteOffset, sc.byteLength);
    for (let j = 0; j + 28 <= sc.length; j += 4) {
      const e = dv.getUint16(j, true), f = dv.getUint16(j + 2, true);
      if (f !== 9 || e < 71 || e > 117 || !(e & 1)) continue;
      const x0 = dv.getUint32(j + 12, true), y0 = dv.getUint32(j + 16, true), x1 = dv.getUint32(j + 20, true), y1 = dv.getUint32(j + 24, true);
      const w = x1 - x0, h = y1 - y0; const pixels = this.get('DATA09', e);
      if (w > 0 && h > 0 && w * h === pixels.length) return { w, h, pixels, pal: this.get('DATA09', e + 1) };
    }
    return null;
  }
  /** sound effects (DATA13 RIFF/WAVE entries) */
  sfxCount() { return this.entries.DATA13 ? this.entries.DATA13.filter((e) => e.length >= 4 && e[0] === 0x52).length : 0; }
  sfx(i: number): Uint8Array | null { const e = this.entries.DATA13?.[i]; if (!e || e.length < 12 || e[0] !== 0x52) return null; const dv = new DataView(e.buffer, e.byteOffset); return e.subarray(0, Math.min(e.length, dv.getUint32(4, true) + 8)); }
  get(file: string, i: number): Uint8Array {
    const k = `${file}:${i}`; let d = this.dec.get(k);
    if (!d) { d = decompress(this.entries[file][i]); this.dec.set(k, d); }
    return d;
  }

  // ---- natials (EXE) ----
  static NAT_VA = 0x46de80; static NAT_SIZE = 0x58; static NAT_COUNT = 24; static IMG_BASE = 0x400000;
  private exeSections(): [number, number, number][] {
    const b = this.exe!; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const pe = dv.getUint32(0x3c, true); const nsec = dv.getUint16(pe + 6, true); const opt = dv.getUint16(pe + 20, true);
    const secs: [number, number, number][] = [];
    for (let i = 0; i < nsec; i++) { const o = pe + 24 + opt + i * 40; secs.push([dv.getUint32(o + 12, true), Math.max(dv.getUint32(o + 8, true), dv.getUint32(o + 16, true)), dv.getUint32(o + 20, true)]); }
    return secs;
  }
  vaToOff(va: number): number {
    const rva = va - VM2Data.IMG_BASE;
    for (const [sva, size, ro] of this.exeSections()) if (rva >= sva && rva < sva + size) return rva - sva + ro;
    throw new Error('va not mapped');
  }
  private natBase = -1;
  /** file offset of the 24-record natial table: known VA for the Korean build, otherwise scan the data sections for 24 records whose +0x50/+0x54 point at short strings */
  natialTable(): number {
    if (this.natBase >= 0) return this.natBase; const b = this.exe!;
    const valid = (o: number) => { for (let i = 0; i < VM2Data.NAT_COUNT; i++) { const r = o + i * VM2Data.NAT_SIZE; if (r + 0x58 > b.length) return false; const dv = new DataView(b.buffer, b.byteOffset); for (const k of [0x50, 0x54]) { let so: number; try { so = this.vaToOff(dv.getUint32(r + k, true)); } catch { return false; } let n = 0; while (so + n < b.length && b[so + n] !== 0 && n < 32) { const c = b[so + n]; if (c < 32) return false; n++; } if (n === 0 || n >= 32) return false; } } return true; };
    try { const o = this.vaToOff(VM2Data.NAT_VA); if (valid(o)) return (this.natBase = o); } catch { /* not mapped */ }
    for (const [, size, ro] of this.exeSections()) for (let o = ro; o + VM2Data.NAT_SIZE * VM2Data.NAT_COUNT <= Math.min(b.length, ro + size); o += 4) if (valid(o)) return (this.natBase = o);
    throw new Error('네이티얼 테이블을 EXE에서 찾지 못했습니다');
  }
  natials(): Natial[] {
    if (!this.exe) return [];
    const b = this.exe; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const base = this.natialTable(); const out: Natial[] = [];
    for (let i = 0; i < VM2Data.NAT_COUNT; i++) {
      const o = base + i * VM2Data.NAT_SIZE; const u = (k: number) => dv.getUint32(o + k * 4, true);
      const stats = Array.from({ length: 5 }, (_, k) => [u(1 + 3 * k), u(2 + 3 * k), u(3 + 3 * k)]);
      out.push({ index: i, name: cstr(b, this.vaToOff(u(20))), attack: cstr(b, this.vaToOff(u(21))), hp: u(0), stats, move: u(16), element: b[o + 0x44], flag1: b[o + 0x45], range: b[o + 0x46], spell: b[o + 0x47], moveType: u(18), cost: u(19) });
    }
    return out;
  }
  patchedExe(nats: Natial[]): Uint8Array {
    const b = this.exe!.slice(); const dv = new DataView(b.buffer); const base = this.natialTable();
    for (const n of nats) {
      const o = base + n.index * VM2Data.NAT_SIZE; dv.setUint32(o, n.hp, true);
      n.stats.forEach((s, k) => s.forEach((v, l) => dv.setUint32(o + 4 + (3 * k + l) * 4, v, true)));
      dv.setUint32(o + 0x40, n.move, true); b[o + 0x44] = n.element; b[o + 0x45] = n.flag1; b[o + 0x46] = n.range; b[o + 0x47] = n.spell;
      dv.setUint32(o + 0x48, n.moveType, true); dv.setUint32(o + 0x4c, n.cost, true);
    }
    return b;
  }
}

/** write name/desc/desc2 into a copy of a map header (same byte budget as the original) */
export function patchHeader(h: MapHeader, name: string, desc: string, desc2: string, tilemapEntry?: number): Uint8Array {
  const raw = h.raw.slice(); const dv = new DataView(raw.buffer);
  const put = (off: number, text: string, limit: number) => {
    const enc = encodeK(text.replace(/\r\n/g, '\n'));
    if (enc.length + 1 > limit) throw new Error(`텍스트가 너무 깁니다: ${enc.length} > ${limit - 1} bytes`);
    raw.fill(0, off, off + limit); raw.set(enc, off);
  };
  put(0, name, 16);
  put(h.descOff, desc, (h.desc2Off > 0 ? h.desc2Off : raw.length) - h.descOff);
  if (h.desc2Off > 0) put(h.desc2Off, desc2, raw.length - h.desc2Off);
  if (tilemapEntry !== undefined) dv.setUint32(16 + 5 * 4, (10 << 16) | tilemapEntry, true);
  return raw;
}
