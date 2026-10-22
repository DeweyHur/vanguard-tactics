import { CHUNK_H, CHUNK_W, HEX_W, ODD_OFF, ROW_STEP, TILE_H, type Tileset } from './vm2data';

/** palette entries are R,G,B,flag; pixel value v -> palette[v-17]; 16 = transparent */
export function atlasCanvas(ts: Tileset): HTMLCanvasElement {
  const n = ts.chunks; const c = document.createElement('canvas'); c.width = CHUNK_W; c.height = CHUNK_H * n;
  const g = c.getContext('2d')!; const img = g.createImageData(CHUNK_W, CHUNK_H * n); const px = img.data;
  const pal = ts.pal; const ncol = pal.length >> 2;
  for (let i = 0; i < CHUNK_W * CHUNK_H * n; i++) {
    const v = ts.atlas[i]; const o = i * 4;
    if (v === 16) continue;
    const k = v - 17;
    if (k >= 0 && k < ncol) { px[o] = pal[k * 4]; px[o + 1] = pal[k * 4 + 1]; px[o + 2] = pal[k * 4 + 2]; }
    else { const gr = Math.min(255, (v - 16) * 2 + 40); px[o] = px[o + 1] = px[o + 2] = gr; }
    px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

export class TileRenderer {
  atlas: HTMLCanvasElement; cache = new Map<number, HTMLCanvasElement>();
  constructor(public ts: Tileset) { this.atlas = atlasCanvas(ts); }
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
