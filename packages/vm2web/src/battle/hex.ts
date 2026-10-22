/** 32x32 "odd-r" offset hex grid (odd rows shifted half a hex to the right), matching the VM2 tilemap layout. */
export const W = 32, H = 32;
export type Cell = { r: number; c: number };
export const key = (r: number, c: number) => r * W + c;
export const inBounds = (r: number, c: number) => r >= 0 && r < H && c >= 0 && c < W;

export function neighbors(r: number, c: number): Cell[] {
  const odd = r & 1; const out: Cell[] = [];
  const d = odd ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]] : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  for (const [dr, dc] of d) { const nr = r + dr, nc = c + dc; if (inBounds(nr, nc)) out.push({ r: nr, c: nc }); }
  return out;
}
/** offset -> cube coords */
function cube(r: number, c: number) { const x = c - (r - (r & 1)) / 2; const z = r; return [x, -x - z, z]; }
export function dist(a: Cell, b: Cell): number {
  const p = cube(a.r, a.c), q = cube(b.r, b.c);
  return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
}
