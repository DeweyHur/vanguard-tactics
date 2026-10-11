import type { PlayerId } from '@vt/sim';
import { Pix, OUTLINE } from './pix';

/**
 * 64x64 procedurally rasterized chibi sprites (front-facing, weapon on the right).
 * P2 sprites are mirrored so the two sides face each other in battle.
 */
export const OWNER = { P1: { o: '#3c7ddc', O: '#204a90' }, P2: { o: '#d9403c', O: '#8a2020' } };

const C = {
  skin: '#f0c8a0', hair: '#4a2e1a', metal: '#d8dce6', metalD: '#8a90a4', wood: '#8a5a2b', gold: '#f2c14e',
  red: '#d23c3c', white: '#f4f4f4', leather: '#6b4a2b', green: '#4f8a3a', purple: '#7a4fc0', cyan: '#7fe0ff',
  horse: '#8a5a3a', horseD: '#5a3a22', grey: '#9a9a9a',
};
const SZ = 64;

type Draw = (p: Pix, b: string, own: { o: string; O: string }) => void;

// ---------- shared body parts ----------
const legs: Draw = (p, b) => {
  p.rect(24, 44, 7, 12, b, { shade: true });
  p.rect(33, 44, 7, 12, b, { shade: true });
  p.rect(23, 54, 9, 5, C.leather, { shade: true });
  p.rect(32, 54, 9, 5, C.leather, { shade: true });
};
const torso: Draw = (p, b, own) => {
  p.rrect(20, 30, 24, 17, 4, b, { shade: true });
  p.rect(29, 31, 6, 15, own.o, { shade: true, outline: false });
  p.rect(21, 42, 22, 2, C.leather, { outline: false });
  p.rect(30, 41, 4, 4, C.gold, { outline: true });
};
const arms: Draw = (p, b) => {
  p.ellipse(18, 37, 4, 6, b, { shade: true });
  p.ellipse(46, 37, 4, 6, b, { shade: true });
  p.ellipse(17, 44, 3.5, 3.5, C.skin, { shade: true });
  p.ellipse(47, 44, 3.5, 3.5, C.skin, { shade: true });
};
const head: Draw = (p) => {
  p.ellipse(32, 20, 11, 11, C.skin, { shade: true });
};
const face: Draw = (p) => {
  p.rect(27, 20, 2, 3, OUTLINE, { outline: false });
  p.rect(35, 20, 2, 3, OUTLINE, { outline: false });
  p.dot(27, 20, '#fff'); p.dot(35, 20, '#fff');
  p.rect(30, 26, 4, 1, '#b87050', { outline: false });
};
const hair: Draw = (p) => {
  p.poly([[21, 20], [21, 13], [26, 8], [32, 7], [38, 8], [43, 13], [43, 20], [40, 15], [35, 13], [29, 13], [24, 15]], C.hair, { shade: true });
};

// ---------- head gear ----------
const helmRound: Draw = (p) => {
  p.ellipse(32, 14, 12.5, 9, C.metal, { shade: true });
  p.rect(19, 17, 26, 3, C.metalD, { outline: true });
};
const helmSpike: Draw = (p) => {
  helmRound(p, '', OWNER.P1);
  p.poly([[32, -1], [29, 8], [35, 8]], C.metal, { shade: true });
};
const helmHorn: Draw = (p) => {
  helmRound(p, '', OWNER.P1);
  p.poly([[20, 12], [14, 2], [18, 2], [24, 9]], C.white, { shade: true });
  p.poly([[44, 12], [50, 2], [46, 2], [40, 9]], C.white, { shade: true });
};
const helmFull: Draw = (p) => {
  p.ellipse(32, 19, 12.5, 13, C.metal, { shade: true });
  p.rect(23, 18, 18, 3, OUTLINE, { outline: false });
  p.rect(31, 18, 2, 10, OUTLINE, { outline: false });
  p.rect(26, 25, 3, 1, OUTLINE, { outline: false }); p.rect(35, 25, 3, 1, OUTLINE, { outline: false });
  p.rect(30, 4, 4, 5, C.red, { shade: true });
};
const hood: Draw = (p) => {
  p.ellipse(32, 17, 13.5, 12.5, '#3f6f2f', { shade: true });
  p.ellipse(32, 22, 7.5, 7.5, C.skin, { outline: false });
  face(p, '', OWNER.P1);
};
const coif: Draw = (p) => {
  p.ellipse(32, 17, 13.5, 12.5, C.white, { shade: true });
  p.ellipse(32, 22, 8, 8, C.skin, { outline: false });
  face(p, '', OWNER.P1);
  p.rect(30, 3, 4, 4, C.red, { outline: false });
};
const wizHat: Draw = (p) => {
  p.ellipse(32, 12, 16, 3.5, C.purple, { shade: true });
  p.poly([[26, 12], [31, -2], [39, 4], [38, 12]], C.purple, { shade: true });
  p.rect(26, 9, 12, 2, C.gold, { outline: false });
};
const capFeather: Draw = (p) => {
  p.ellipse(32, 12, 12.5, 5.5, '#c04060', { shade: true });
  p.poly([[40, 8], [52, -2], [55, 2], [44, 11]], C.red, { shade: true });
};
const bandana: Draw = (p) => {
  p.ellipse(32, 12, 12.5, 5.5, C.red, { shade: true });
  p.poly([[42, 10], [52, 6], [53, 10], [44, 14]], C.red, { shade: true });
};

// ---------- weapons ----------
const sword: Draw = (p) => {
  p.rect(51, 12, 4, 28, C.metal, { shade: true });
  p.poly([[51, 12], [53, 7], [55, 12]], C.metal, { shade: true });
  p.rect(47, 40, 12, 3, C.gold, { shade: true });
  p.rect(51, 43, 4, 7, C.wood, { shade: true });
};
const spear: Draw = (p) => {
  p.rect(52, 6, 3, 54, C.wood, { shade: true });
  p.poly([[53.5, -1], [49, 12], [58, 12]], C.metal, { shade: true });
};
const bow: Draw = (p) => {
  p.line(48, 16, 57, 36, 3, C.wood, { shade: true });
  p.line(57, 36, 48, 56, 3, C.wood, { shade: true });
  p.line(48, 16, 48, 56, 1, C.white, { outline: false });
  p.rect(44, 35, 10, 2, C.metal, { outline: true });
};
const axe: Draw = (p) => {
  p.rect(52, 10, 3, 46, C.wood, { shade: true });
  p.poly([[55, 8], [64, 14], [64, 30], [55, 34]], C.metal, { shade: true });
};
const shield: Draw = (p, _b, own) => {
  p.rrect(3, 27, 17, 23, 5, C.metal, { shade: true });
  p.rect(10, 32, 4, 12, own.o, { outline: false });
  p.rect(7, 36, 10, 4, own.o, { outline: false });
};
const staffCross: Draw = (p) => {
  p.rect(53, 8, 3, 50, C.wood, { shade: true });
  p.rect(50, 6, 9, 3, C.gold, { shade: true });
  p.rect(53, 1, 3, 12, C.gold, { shade: true });
};
const staffOrb: Draw = (p) => {
  p.rect(53, 10, 3, 48, C.wood, { shade: true });
  p.ellipse(54.5, 8, 5.5, 5.5, C.cyan, { shade: true, hi: '#ffffff' });
};
const chain: Draw = (p) => {
  const pts: [number, number][] = [[49, 41], [53, 36], [57, 31], [61, 26]];
  for (const [x, y] of pts) p.ring(x, y, 3, 3, 1.5, C.metalD, { outline: true });
  p.poly([[60, 22], [64, 18], [64, 24], [62, 28]], C.metal, { shade: true });
};
const banner: Draw = (p, _b, own) => {
  p.rect(53, 2, 3, 56, C.wood, { shade: true });
  p.poly([[56, 4], [64, 4], [64, 18], [56, 18], [59, 11]], own.o, { shade: true });
  p.rect(53, 0, 3, 3, C.gold, { outline: true });
};
const club: Draw = (p) => {
  p.line(50, 50, 58, 16, 5, C.wood, { shade: true });
  p.ellipse(59, 12, 6, 8, C.wood, { shade: true });
  p.dot(58, 8, C.metalD); p.dot(61, 14, C.metalD); p.dot(57, 15, C.metalD);
};

// ---------- full characters ----------
const humanoid = (gear: Draw, weapon: Draw | null, hairOn = true): Draw => (p, b, own) => {
  if (weapon === shield) shield(p, b, own);
  legs(p, b, own); torso(p, b, own); arms(p, b, own); head(p, b, own);
  if (hairOn) hair(p, b, own);
  face(p, b, own);
  gear(p, b, own);
  if (weapon && weapon !== shield) weapon(p, b, own);
};

const cavalry: Draw = (p, b, own) => {
  // horse
  for (const x of [16, 24, 40, 48]) p.rect(x, 48, 5, 12, C.horse, { shade: true });
  p.ellipse(32, 44, 20, 9, C.horse, { shade: true });
  p.poly([[46, 40], [54, 24], [60, 26], [52, 44]], C.horse, { shade: true });
  p.ellipse(57, 24, 7, 5, C.horse, { shade: true });
  p.rect(60, 25, 4, 3, C.horseD, { outline: false });
  p.dot(58, 22, OUTLINE);
  p.poly([[48, 24], [52, 20], [56, 22], [54, 26]], C.horseD, { shade: true });
  p.poly([[12, 42], [6, 36], [8, 48], [12, 50]], C.horseD, { shade: true });
  p.rect(22, 36, 20, 3, C.leather, { outline: true });
  // rider (smaller, sitting)
  p.rrect(22, 22, 18, 14, 3, b, { shade: true });
  p.rect(29, 23, 4, 12, own.o, { shade: true, outline: false });
  p.ellipse(31, 12, 9, 9, C.skin, { shade: true });
  p.rect(27, 12, 2, 2, OUTLINE, { outline: false }); p.rect(34, 12, 2, 2, OUTLINE, { outline: false });
  p.ellipse(31, 7, 10, 6, C.metal, { shade: true });
  p.rect(21, 9, 20, 2, C.metalD, { outline: true });
  p.ellipse(42, 30, 3.5, 3.5, C.skin, { shade: true });
  p.rect(44, 4, 3, 30, C.metal, { shade: true });
  p.poly([[45.5, -1], [42, 6], [49, 6]], C.metal, { shade: true });
};

const giant: Draw = (p, b, own) => {
  p.rect(16, 46, 11, 13, b, { shade: true });
  p.rect(36, 46, 11, 13, b, { shade: true });
  p.rect(15, 56, 13, 5, C.leather, { shade: true });
  p.rect(35, 56, 13, 5, C.leather, { shade: true });
  p.rrect(12, 26, 40, 24, 6, b, { shade: true });
  p.rect(28, 27, 8, 22, own.o, { shade: true, outline: false });
  p.rect(13, 44, 38, 3, C.leather, { outline: false });
  p.ellipse(9, 36, 6, 10, b, { shade: true });
  p.ellipse(55, 36, 6, 10, b, { shade: true });
  p.ellipse(8, 48, 5, 5, C.skin, { shade: true });
  p.ellipse(32, 14, 13, 12, C.skin, { shade: true });
  p.poly([[19, 14], [19, 6], [26, 1], [38, 1], [45, 6], [45, 14], [40, 9], [32, 7], [24, 9]], C.hair, { shade: true });
  p.rect(26, 13, 3, 3, OUTLINE, { outline: false }); p.rect(35, 13, 3, 3, OUTLINE, { outline: false });
  p.rect(22, 11, 20, 2, C.hair, { outline: false });
  p.rect(28, 22, 8, 2, '#b87050', { outline: false });
  club(p, b, own);
  p.ellipse(56, 46, 5, 5, C.skin, { shade: true });
};

const wagon: Draw = (p, b) => {
  p.rect(10, 24, 44, 18, C.wood, { shade: true });
  p.rect(10, 32, 44, 2, C.leather, { outline: false });
  p.ellipse(32, 22, 24, 9, b, { shade: true });
  p.rect(8, 42, 48, 3, C.leather, { outline: true });
  for (const x of [20, 44]) {
    p.ring(x, 51, 9, 9, 3, C.wood, { shade: true });
    p.line(x - 7, 51, x + 7, 51, 2, C.wood, { outline: false });
    p.line(x, 44, x, 58, 2, C.wood, { outline: false });
    p.ellipse(x, 51, 2.5, 2.5, C.metalD, { outline: true });
  }
};

interface Def { draw: Draw; b: string }

export const UNIT_SPRITES: Record<string, Def> = {
  infantry: { draw: humanoid(helmRound, sword), b: '#c9a66b' },
  spear: { draw: humanoid(helmSpike, spear), b: '#7fa7d1' },
  archer: { draw: humanoid(hood, bow, false), b: '#6fae6f' },
  axe: { draw: humanoid(helmHorn, axe), b: '#d97f5a' },
  shield: { draw: humanoid(helmFull, shield), b: '#9a9ab4' },
  healer: { draw: humanoid(coif, staffCross, false), b: '#f2e3a0' },
  mage: { draw: humanoid(wizHat, staffOrb), b: '#8c62c8' },
  cavalry: { draw: cavalry, b: '#e0c060' },
  hooker: { draw: humanoid(bandana, chain), b: '#6f8894' },
  giant: { draw: giant, b: '#9a6b4a' },
  herald: { draw: humanoid(capFeather, banner), b: '#f0a0c0' },
  wagon: { draw: wagon, b: '#c8b48a' },
};

const cache = new Map<string, HTMLCanvasElement>();

/** 64x64 unit sprite at `scale` px per sprite pixel (scale<1 is sampled down with nearest neighbour). P2 faces left. */
export function sprite(def: string, owner: PlayerId, scale = 1, flip = owner === 'P2'): HTMLCanvasElement {
  const key = `${def}:${owner}:${scale}:${flip}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = UNIT_SPRITES[def] ?? UNIT_SPRITES.infantry;
  let px = new Pix(SZ, SZ);
  d.draw(px, d.b, OWNER[owner]);
  if (flip) px = px.flipX();
  let c: HTMLCanvasElement;
  if (scale >= 1) c = px.toCanvas(scale);
  else {
    const full = px.toCanvas(1);
    c = document.createElement('canvas');
    c.width = Math.round(SZ * scale); c.height = Math.round(SZ * scale);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(full, 0, 0, c.width, c.height);
  }
  cache.set(key, c);
  return c;
}

/** A fresh canvas copy for DOM insertion (the cached canvas must not be moved between parents). */
export function spriteEl(def: string, owner: PlayerId, scale = 1): HTMLCanvasElement {
  const src = sprite(def, owner, scale);
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0);
  return c;
}

// ---------------- map node icons (32x32, rasterized) ----------------
const NODE_DRAW: Record<string, (p: Pix, col: string) => void> = {
  home: (p, col) => {
    p.rect(4, 12, 24, 16, C.metal, { shade: true });
    for (const x of [4, 12, 20]) p.rect(x, 8, 6, 5, C.metal, { shade: true });
    p.rect(13, 19, 6, 9, C.wood, { shade: true });
    p.rect(7, 2, 2, 7, C.wood, { outline: false }); p.poly([[9, 2], [15, 4], [9, 6]], col, { outline: true });
    p.rect(23, 2, 2, 7, C.wood, { outline: false }); p.poly([[25, 2], [31, 4], [25, 6]], col, { outline: true });
  },
  supply: (p) => {
    p.poly([[16, 4], [3, 14], [29, 14]], '#c8b48a', { shade: true });
    p.rect(5, 14, 22, 14, C.wood, { shade: true });
    p.rect(13, 19, 6, 9, C.leather, { shade: true });
    p.rect(7, 17, 4, 4, C.gold, { outline: true }); p.rect(21, 17, 4, 4, C.gold, { outline: true });
  },
  barracks: (p, col) => {
    p.poly([[16, 6], [2, 24], [30, 24]], '#d8d0b0', { shade: true });
    p.poly([[16, 6], [16, 24], [8, 24]], '#9a9070', { outline: false });
    p.rect(15, 0, 2, 7, C.wood, { outline: false }); p.poly([[17, 0], [23, 2], [17, 4]], col, { outline: true });
    p.rect(6, 24, 20, 4, C.leather, { outline: true });
  },
  watchtower: (p) => {
    p.rect(11, 10, 10, 20, C.metal, { shade: true });
    p.rect(8, 4, 16, 7, C.metal, { shade: true });
    for (const x of [8, 14, 20]) p.rect(x, 2, 3, 3, C.metal, { outline: true });
    p.rect(14, 14, 4, 5, OUTLINE, { outline: false });
    p.rect(14, 23, 4, 5, OUTLINE, { outline: false });
  },
  shrine: (p) => {
    p.rect(5, 26, 22, 4, C.metal, { shade: true });
    p.rect(8, 14, 4, 13, C.metal, { shade: true }); p.rect(20, 14, 4, 13, C.metal, { shade: true });
    p.rect(5, 11, 22, 4, C.metal, { shade: true });
    p.ellipse(16, 5, 4, 4, C.gold, { shade: true, hi: '#fff' });
  },
  fort: (p) => {
    p.rect(3, 12, 26, 18, C.metalD, { shade: true });
    for (const x of [3, 10, 17, 24]) p.rect(x, 7, 5, 6, C.metalD, { shade: true });
    p.rect(12, 20, 8, 10, C.wood, { shade: true });
    p.rect(6, 16, 3, 4, OUTLINE, { outline: false }); p.rect(23, 16, 3, 4, OUTLINE, { outline: false });
  },
  plain: (p) => {
    p.rect(14, 10, 4, 18, C.wood, { shade: true });
    p.poly([[10, 6], [24, 6], [28, 10], [24, 14], [10, 14]], C.wood, { shade: true });
    p.ellipse(16, 28, 10, 3, C.green, { shade: true });
  },
};

export function nodeIcon(type: string, owner: PlayerId | null, scale = 1): HTMLCanvasElement {
  const key = `node:${type}:${owner}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Pix(32, 32);
  (NODE_DRAW[type] ?? NODE_DRAW.plain)(p, owner ? OWNER[owner].o : C.grey);
  const c = p.toCanvas(scale);
  cache.set(key, c);
  return c;
}

/** 16x16 grass tile variants (64x16 strip) for a repeating pattern. */
export function grassTiles(): HTMLCanvasElement {
  const key = 'grass';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f5a24'; g.fillRect(0, 0, 64, 16);
  const tufts = [[2, 4], [10, 12], [6, 8], [12, 2], [4, 10], [14, 14], [8, 0], [1, 13], [11, 6]];
  for (let v = 0; v < 4; v++) for (let i = 0; i < tufts.length; i++) {
    if ((i + v) % 3 === 0) continue;
    const [x, y] = tufts[i];
    g.fillStyle = (i + v) % 2 ? '#3a6b2c' : '#264a1c';
    g.fillRect(v * 16 + x, y, 2, 1); g.fillRect(v * 16 + x + 1, y - 1, 1, 1);
  }
  cache.set(key, c);
  return c;
}
