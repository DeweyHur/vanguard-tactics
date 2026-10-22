import { CHUNK_H, CHUNK_W, HEX_W, ODD_OFF, ROW_STEP, TILE_H, type Tileset } from './vm2data';

/** palette entries are R,G,B,flag; pixel value v -> palette[v-17]; 16 = transparent */
export function atlasCanvas(ts: Tileset, lut: Uint8Array): HTMLCanvasElement {
  const n = ts.chunks; const c = document.createElement('canvas'); c.width = CHUNK_W; c.height = CHUNK_H * n;
  const g = c.getContext('2d')!; const img = g.createImageData(CHUNK_W, CHUNK_H * n); const px = img.data;
  for (let i = 0; i < CHUNK_W * CHUNK_H * n; i++) { const v = ts.atlas[i]; px.set(lut.subarray(v * 4, v * 4 + 4), i * 4); }
  g.putImageData(img, 0, 0); return c;
}
/** indexed 8-bit image -> canvas through a 256-entry RGBA lut */
export function indexedCanvas(pix: Uint8Array, w: number, h: number, lut: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!; const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(lut.subarray(pix[i] * 4, pix[i] * 4 + 4), i * 4);
  g.putImageData(img, 0, 0); return c;
}

export class TileRenderer {
  atlas: HTMLCanvasElement; cache = new Map<number, HTMLCanvasElement>();
  constructor(public ts: Tileset, lut: Uint8Array) { this.atlas = atlasCanvas(ts, lut); }
  tile(idx: number): HTMLCanvasElement {
    let c = this.cache.get(idx);
    if (c) return c;
    c = document.createElement('canvas'); c.width = HEX_W; c.height = TILE_H; const g = c.getContext('2d')!;
    const d = this.ts.defs[idx];
    for (let half = 0; half < 2; half++) {
      const list = half ? d.right : d.left;
      for (let k = 0; k < 24; k++) { const i = list[k]; if (i === 0x7ff || i >= this.ts.chunks) continue; g.drawImage(this.atlas, 0, i * CHUNK_H, CHUNK_W, CHUNK_H, half * CHUNK_W, (23 - k) * CHUNK_H, CHUNK_W, CHUNK_H); }
    }
    this.cache.set(idx, c); return c;
  }
  /** top slab row used by the tile (for thumbnails) */
  topRow(idx: number): number {
    const d = this.ts.defs[idx]; let top = 0;
    for (let k = 0; k < 24; k++) if (d.left[k] !== 0x7ff || d.right[k] !== 0x7ff) top = k;
    return 23 - top;
  }
}

export const cellOrigin = (r: number, c: number) => ({ x: c * HEX_W + (r % 2) * ODD_OFF + 8, base: r * ROW_STEP + TILE_H + 8 });
export const worldSize = () => ({ w: 32 * HEX_W + ODD_OFF + 16, h: 32 * ROW_STEP + TILE_H + 16 });

export function drawMap(g: CanvasRenderingContext2D, rend: TileRenderer, grid: Uint16Array) {
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) { const o = cellOrigin(r, c); g.drawImage(rend.tile(grid[r * 32 + c]), o.x, o.base - TILE_H); }
}

export function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number) {
  g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx + 24, cy - 9); g.lineTo(cx + 24, cy + 9); g.lineTo(cx, cy + 18); g.lineTo(cx - 24, cy + 9); g.lineTo(cx - 24, cy - 9); g.closePath();
}

/** nearest cell to a world point, using each cell's cap centre (height-aware) */
export function pickCell(ts: Tileset, grid: Uint16Array, wx: number, wy: number): { r: number; c: number } | null {
  let best: { r: number; c: number } | null = null, bd = 1e9;
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
    const o = cellOrigin(r, c); const h = ts.defs[grid[r * 32 + c]].height; const cx = o.x + 24, cy = o.base - 18 - 12 * h;
    const d = Math.hypot((wx - cx) / 24, (wy - cy) / 18); if (d <= bd) { bd = d; best = { r, c }; } // ties: front (later) row wins, matching draw order
  }
  return bd < 1.1 ? best : null;
}

/** RGBA canvas for a portrait (palette R,G,B,flag; 16 = transparent) */
export function portraitCanvas(p: { w: number; h: number; pixels: Uint8Array; pal: Uint8Array }): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = p.w; c.height = p.h; const g = c.getContext('2d')!; const img = g.createImageData(p.w, p.h); const px = img.data; const n = p.pal.length >> 2;
  for (let i = 0; i < p.w * p.h; i++) { const v = p.pixels[i]; if (v < 17) continue; const k = v - 17; const o = i * 4; if (k < n) { px[o] = p.pal[k * 4]; px[o + 1] = p.pal[k * 4 + 1]; px[o + 2] = p.pal[k * 4 + 2]; } px[o + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
}

/**
 * Palette cycling for the map, the way the original animates water and magic stones without extra tile frames:
 * the map palette is laid out in 4-colour ramps, and the ramps used only by water-type terrain (plus the system
 * palette's purple stone ramp, indices 104-107) have their colours rotated every tick.
 */
const WATER_TERRAIN = new Set([5, 6, 7, 8, 9]); const STONE_TERRAIN = new Set([12, 13, 14, 15]);
export class MapAnim {
  private img: ImageData; private pos = new Map<number, Uint32Array>(); private ramps: number[][] = []; private phase = 0;
  constructor(ts: Tileset, grid: Uint16Array, private lut: Uint8Array, private world: HTMLCanvasElement) {
    const ws = worldSize(); const idx = new Uint8Array(ws.w * ws.h).fill(16);
    // compose the index buffer in draw order
    for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
      const o = cellOrigin(r, c); const d = ts.defs[grid[r * 32 + c]]; const y0 = o.base - TILE_H;
      for (let half = 0; half < 2; half++) { const list = half ? d.right : d.left;
        for (let k = 0; k < 24; k++) { const i = list[k]; if (i === 0x7ff || i >= ts.chunks) continue; const ty = y0 + (23 - k) * CHUNK_H, tx = o.x + half * CHUNK_W;
          for (let y = 0; y < CHUNK_H; y++) for (let x = 0; x < CHUNK_W; x++) { const v = ts.atlas[(i * CHUNK_H + y) * CHUNK_W + x]; if (v !== 16) idx[(ty + y) * ws.w + tx + x] = v; } } }
    }
    // which palette indices belong to water / stone tiles only
    const use = new Map<number, [number, number]>(); // index -> [water-ish uses, other uses]
    const seen = new Set<number>(); let hasStone = false;
    for (const t of grid) { if (seen.has(t)) continue; seen.add(t); const d = ts.defs[t]; const water = WATER_TERRAIN.has(d.terrain); if (STONE_TERRAIN.has(d.terrain)) hasStone = true;
      for (const list of [d.left, d.right]) for (const i of list) { if (i === 0x7ff || i >= ts.chunks) continue; for (let p = 0; p < CHUNK_W * CHUNK_H; p++) { const v = ts.atlas[i * CHUNK_H * CHUNK_W + p]; if (v === 16) continue; const u = use.get(v) ?? [0, 0]; u[water ? 0 : 1]++; use.set(v, u); } } }
    for (let a = 20; a + 3 < 60; a += 4) { let w = 0, o = 0; for (let i = a; i < a + 4; i++) { const u = use.get(i); if (u) { w += u[0]; o += u[1]; } } if (w > 200 && o < w * 0.05) this.ramps.push([a, a + 1, a + 2, a + 3]); }
    if (hasStone) this.ramps.push([104, 105, 106, 107]);
    const want = new Set(this.ramps.flat()); const lists = new Map<number, number[]>();
    for (let p = 0; p < idx.length; p++) if (want.has(idx[p])) { let l = lists.get(idx[p]); if (!l) lists.set(idx[p], (l = [])); l.push(p); }
    for (const [v, l] of lists) this.pos.set(v, Uint32Array.from(l));
    this.img = world.getContext('2d')!.getImageData(0, 0, ws.w, ws.h);
  }
  get active() { return this.pos.size > 0; }
  /** rotate every ramp one step and repaint the affected pixels */
  tick() {
    if (!this.pos.size) return; this.phase++; const px = this.img.data;
    for (const ramp of this.ramps) for (let k = 0; k < ramp.length; k++) { const v = ramp[k]; const l = this.pos.get(v); if (!l) continue; const src = ramp[(k + this.phase) % ramp.length] * 4; const r = this.lut[src], g = this.lut[src + 1], b = this.lut[src + 2];
      for (let j = 0; j < l.length; j++) { const o = l[j] * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; } }
    this.world.getContext('2d')!.putImageData(this.img, 0, 0);
  }
}
