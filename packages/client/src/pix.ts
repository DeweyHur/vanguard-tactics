/**
 * Tiny pixel-art rasterizer: draws primitives into an indexed buffer with
 * automatic 1px outlines and two-tone shading, then bakes to a canvas.
 */
export type Color = string;

export interface Prim {
  /** shade: darken bottom-right third, 1px highlight on top-left edge */
  shade?: boolean;
  /** draw a 1px outline around the primitive (default true) */
  outline?: boolean;
  /** highlight color override */
  hi?: Color;
  /** shadow color override */
  lo?: Color;
}

function darken(hex: Color, f: number): Color {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function lighten(hex: Color, f: number): Color {
  const n = parseInt(hex.slice(1), 16);
  const l = (v: number) => Math.min(255, Math.round(v + (255 - v) * f));
  const r = l((n >> 16) & 255), g = l((n >> 8) & 255), b = l(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const OUTLINE = '#1a1020';

export class Pix {
  px: (Color | null)[];
  constructor(public w: number, public h: number) {
    this.px = new Array(w * h).fill(null);
  }
  private set(x: number, y: number, c: Color) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): Color | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x];
  }
  dot(x: number, y: number, c: Color) { this.set(Math.round(x), Math.round(y), c); }

  /** fill a mask (set of pixels) with shading + outline */
  private paint(mask: Set<number>, c: Color, p: Prim = {}) {
    if (mask.size === 0) return;
    const has = (x: number, y: number) => mask.has(y * this.w + x);
    let x0 = this.w, y0 = this.h, x1 = 0, y1 = 0;
    for (const k of mask) { const x = k % this.w, y = Math.floor(k / this.w); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    if (p.outline !== false) {
      for (const k of mask) {
        const x = k % this.w, y = Math.floor(k / this.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has(x + dx, y + dy)) this.set(x + dx, y + dy, OUTLINE);
      }
    }
    const lo = p.lo ?? darken(c, 0.72), hi = p.hi ?? lighten(c, 0.35);
    for (const k of mask) {
      const x = k % this.w, y = Math.floor(k / this.w);
      let col = c;
      if (p.shade) {
        const t = (x - x0) / bw + (y - y0) / bh;
        if (t > 1.25) col = lo;
        if ((!has(x - 1, y) || !has(x, y - 1)) && t < 0.9) col = hi;
      }
      this.set(x, y, col);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, p?: Prim) {
    const m = new Set<number>();
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / (rx + 0.5), dy = (y + 0.5 - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1 && x >= 0 && y >= 0 && x < this.w && y < this.h) m.add(y * this.w + x);
    }
    this.paint(m, c, p);
  }
  rect(x: number, y: number, w: number, h: number, c: Color, p?: Prim) {
    const m = new Set<number>();
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) m.add(yy * this.w + xx);
    this.paint(m, c, p);
  }
  /** rounded rect */
  rrect(x: number, y: number, w: number, h: number, r: number, c: Color, p?: Prim) {
    const m = new Set<number>();
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const cx = Math.min(Math.max(xx + 0.5, x + r), x + w - r), cy = Math.min(Math.max(yy + 0.5, y + r), y + h - r);
      const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r && xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) m.add(yy * this.w + xx);
    }
    this.paint(m, c, p);
  }
  /** thick line */
  line(x0: number, y0: number, x1: number, y1: number, t: number, c: Color, p?: Prim) {
    const m = new Set<number>();
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const r = (t - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if (Math.abs(xx - x) <= r + 0.01 && Math.abs(yy - y) <= r + 0.01 && xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) m.add(yy * this.w + xx);
      }
    }
    this.paint(m, c, p);
  }
  /** convex/concave polygon via scanline (even-odd) */
  poly(pts: [number, number][], c: Color, p?: Prim) {
    const m = new Set<number>();
    const ys = pts.map((q) => q[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs: number[] = [];
      const sy = y + 0.5;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.floor(xs[i]); x < Math.ceil(xs[i + 1]); x++) if (x >= 0 && y >= 0 && x < this.w && y < this.h) m.add(y * this.w + x);
    }
    this.paint(m, c, p);
  }
  /** ring (hollow ellipse) — e.g. bows, wheels */
  ring(cx: number, cy: number, rx: number, ry: number, t: number, c: Color, p?: Prim) {
    const m = new Set<number>();
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const inner = (rx - t) / rx;
      if (d <= 1.0 && d >= inner && x >= 0 && y >= 0 && x < this.w && y < this.h) m.add(y * this.w + x);
    }
    this.paint(m, c, p);
  }

  /** stamp another Pix (e.g. flipped) */
  flipX(): Pix {
    const o = new Pix(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.px[y * this.w + (this.w - 1 - x)] = this.px[y * this.w + x];
    return o;
  }

  toCanvas(scale = 1): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w * scale; c.height = this.h * scale;
    const g = c.getContext('2d')!;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const col = this.px[y * this.w + x];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
    return c;
  }
}
