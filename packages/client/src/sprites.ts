import type { PlayerId } from '@vt/sim';

/**
 * 16x16 layered pixel sprites. Characters face right (P1). P2 sprites are mirrored.
 * Palette keys:
 *  K outline  s skin  S skin shadow  h hair
 *  b body  B body shadow  (per-unit)
 *  m metal  M metal shadow  w wood  y gold  r red  g secondary (per-unit)
 *  o owner color  O owner dark  . transparent
 */
export const PAL = {
  K: '#1a1020', s: '#f0c8a0', S: '#c08860', h: '#4a2e1a',
  m: '#d8dce6', M: '#7c8296', w: '#8a5a2b', y: '#f2c14e', r: '#d23c3c', n: '#2c2c3c', W: '#f8f8f8',
};
export const OWNER = { P1: { o: '#3c7ddc', O: '#204a90' }, P2: { o: '#d9403c', O: '#8a2020' } };

type Layer = string[];
const L = (...rows: string[]): Layer => rows;

// ---- body templates (16x16) ----
const BODY = L(
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KobbboK.....',
  '....KoBbbBoK....',
  '....KoKbbbKK....',
  '....KKKBbBK.....',
  '.....KBBBBK.....',
  '.....KBKKBK.....',
  '.....KBK.KBK....',
  '.....KKK.KKK....',
  '................',
);
const HEAD_BASE = L(
  '................',
  '......KKKK......',
  '.....KhhhhK.....',
  '.....KhsssK.....',
  '.....KsKsKK.....',
  '.....KssssK.....',
  '......KSSK......',
);

// ---- head gear ----
const HELM_ROUND = L('................', '......KKKK......', '.....KmmmmK.....', '....KmmMmmmK....', '....KMMMMMMK....', '.....KssssK.....', '.....KsKsKK.....', '......KSSK......');
const HELM_SPIKE = L('.......K........', '......KmK.......', '.....KmmmK......', '....KmmMmmK.....', '....KMMMMMK.....', '.....KssssK.....', '.....KsKsKK.....', '......KSSK......');
const HOOD = L('................', '......KKKK......', '.....KggggK.....', '....KggggggK....', '....KgKssKgK....', '....KgsKsKgK....', '.....KssssK.....', '......KSSK......');
const HELM_HORN = L('....K....K......', '....KK..KK......', '.....KmmmK......', '....KmmMmmK.....', '....KMMMMMK.....', '.....KssssK.....', '.....KsKsKK.....', '......KSSK......');
const HELM_FULL = L('................', '......KKKK......', '.....KmmmmK.....', '....KmmmmmmK....', '....KMKKKKMK....', '....KmmKKmmK....', '.....KMMMMK.....', '......KKKK......');
const COIF = L('................', '......KKKK......', '.....KWWWWK.....', '....KWWWWWWK....', '....KWKssKWK....', '....KWsKsKWK....', '.....KssssK.....', '......KSSK......');
const WIZ_HAT = L('.........K......', '........KgK.....', '.......KggK.....', '......KgggK.....', '.....KggggyK....', '...KKKKKKKKKK...', '.....KsKsKK.....', '......KSSK......');
const CAP_FEATHER = L('..........r.....', '.........rr.....', '......KKKKr.....', '.....KggggK.....', '....KgggggK.....', '.....KssssK.....', '.....KsKsKK.....', '......KSSK......');
const BANDANA = L('................', '......KKKK......', '.....KrrrrK.....', '....KrrrrrrKr...', '....KhKssKhK....', '....KhsKsKhK....', '.....KssssK.....', '......KSSK......');

// ---- weapons / props ----
const SWORD = L(
  '................', '................', '............K...', '...........KmK..', '...........KmK..', '...........KmK..',
  '...........KmK..', '...........KmK..', '..........KKyKK.', '...........KwK..', '............K...',
);
const SPEAR = L(
  '............K...', '...........KmK..', '...........KmK..', '............K...', '............w...', '............w...',
  '............w...', '............w...', '............w...', '............w...', '............w...', '............w...',
  '............w...', '............w...', '............w...', '................',
);
const BOW = L(
  '................', '................', '................', '...........K....', '..........KwK...', '..........Kw.K..',
  '..........Kw..K.', '..........Kw..K.', '..........Kw..K.', '..........Kw.K..', '..........KwK...', '...........K....',
);
const AXE = L(
  '................', '..........KKK...', '.........KmmmK..', '.........KmMmK..', '..........KmK...', '...........w....',
  '...........w....', '...........w....', '...........w....', '...........w....', '................',
);
const SHIELD = L(
  '................', '................', '................', '................', '................', '................',
  '.KKKK...........', 'KmmmmK..........', 'KmMMmK..........', 'KmMoMK..........', 'KmMMmK..........', 'KmmmmK..........',
  '.KKKK...........',
);
const STAFF_CROSS = L(
  '................', '...........K....', '..........KyK...', '.........KyyyK..', '..........KyK...', '...........w....',
  '...........w....', '...........w....', '...........w....', '...........w....', '...........w....', '...........w....',
);
const STAFF_ORB = L(
  '..........KK....', '.........KggK...', '.........KggK...', '..........KK....', '...........w....', '...........w....',
  '...........w....', '...........w....', '...........w....', '...........w....', '...........w....', '...........w....',
);
const CHAIN = L(
  '................', '................', '................', '................', '................', '...........K....',
  '..........KmK...', '...........KmK..', '............KmK.', '.............KK.', '............KmK.', '...........KmK..',
  '..........KmmK..', '..........KKK...',
);
const BANNER = L(
  '...........K....', '..........KoooK.', '..........KooooK', '..........KoooK.', '..........KooK..', '...........w....',
  '...........w....', '...........w....', '...........w....', '...........w....', '...........w....', '...........w....',
);
const THROW = L('................', '................', '................', '................', '................', '................', '................', '...........KK...', '..........KmmK..', '...........KK...');

// ---- full custom sprites ----
const CAVALRY = L(
  '................',
  '......KKKK......',
  '.....KmmmmK.....',
  '....KMMMMMK..K..',
  '.....KssssK.KmK.',
  '.....KsKsKK.KmK.',
  '....KKobboKK.w..',
  '...KoBbbbBoK.w..',
  '..KKKKKKKKKKKw..',
  '.KhhhhhhhhhhKK..',
  'KhhhhhhhhhhhhhK.',
  'KhKhhhhhhhhKhhK.',
  '.KKhhKKKKhhKKK..',
  '..KhK....KhK....',
  '..KhK....KhK....',
  '..KKK....KKK....',
);
const GIANT = L(
  '.....KKKKKK.....',
  '....KhhhhhhK....',
  '....KhssssKK....',
  '....KsKssKsK....',
  '....KssKKssK....',
  '.....KSSSSK.....',
  '...KKKobboKKK...',
  '..KbbbbbbbbbbK..',
  '.KbbKoBbbBoKbbK.',
  '.KbbKoKbbBoKbbK.',
  '.KBBKKKKKKKKBBK.',
  '.KKKK.KBBBBK.KKK',
  '......KBBBBK..KmK',
  '.....KBBKKBBK.KmK',
  '.....KBBK.KBBKKK',
  '.....KKKK.KKKK..',
);
const WAGON = L(
  '................',
  '................',
  '....KKKKKKKK....',
  '...KggggggggK...',
  '..KggggggggggK..',
  '..KggggggggggK..',
  '.KKKKKKKKKKKKKK.',
  '.KwwwwwwwwwwwwK.',
  '.KwwwwwwwwwwwwK.',
  '.KKKKKKKKKKKKKK.',
  '...KKK....KKK...',
  '..KwMwK..KwMwK..',
  '..KMwMK..KMwMK..',
  '..KwMwK..KwMwK..',
  '...KKK....KKK...',
  '................',
);

interface Def { layers: Layer[]; b: string; B: string; g?: string; }

export const UNIT_SPRITES: Record<string, Def> = {
  infantry: { layers: [BODY, HELM_ROUND, SWORD], b: '#c9a66b', B: '#8f7245' },
  spear: { layers: [BODY, HELM_SPIKE, SPEAR], b: '#7fa7d1', B: '#4a6f99' },
  archer: { layers: [BODY, HOOD, BOW], b: '#6fae6f', B: '#3f7a3f', g: '#2f5f2f' },
  axe: { layers: [BODY, HELM_HORN, AXE], b: '#d97f5a', B: '#9a5336' },
  shield: { layers: [BODY, HELM_FULL, SHIELD], b: '#9a9ab4', B: '#5f5f7e' },
  healer: { layers: [BODY, COIF, STAFF_CROSS], b: '#f2e3a0', B: '#b8a560' },
  mage: { layers: [BODY, WIZ_HAT, STAFF_ORB], b: '#8c62c8', B: '#5a3a8a', g: '#5a3a8a' },
  cavalry: { layers: [CAVALRY], b: '#e0c060', B: '#a08a30' },
  hooker: { layers: [BODY, BANDANA, CHAIN], b: '#6f8894', B: '#44575f' },
  giant: { layers: [GIANT], b: '#9a6b4a', B: '#5e3f28' },
  herald: { layers: [BODY, CAP_FEATHER, BANNER], b: '#f0a0c0', B: '#b06a88', g: '#c04060' },
  wagon: { layers: [WAGON], b: '#bbbbbb', B: '#888888', g: '#c8b48a' },
};

const cache = new Map<string, HTMLCanvasElement>();

function colorOf(ch: string, d: Def, owner: PlayerId): string | null {
  switch (ch) {
    case '.': return null;
    case 'b': return d.b;
    case 'B': return d.B;
    case 'g': return d.g ?? d.B;
    case 'o': return OWNER[owner].o;
    case 'O': return OWNER[owner].O;
    default: return (PAL as Record<string, string>)[ch] ?? '#ff00ff';
  }
}

/** Render a unit sprite to a cached canvas. `scale` pixels per sprite pixel. P2 faces left. */
export function sprite(def: string, owner: PlayerId, scale = 3, flip = owner === 'P2'): HTMLCanvasElement {
  const key = `${def}:${owner}:${scale}:${flip}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = UNIT_SPRITES[def] ?? UNIT_SPRITES.infantry;
  const c = document.createElement('canvas');
  c.width = 16 * scale; c.height = 16 * scale;
  const g = c.getContext('2d')!;
  for (const layer of d.layers) {
    for (let y = 0; y < layer.length; y++) for (let x = 0; x < 16; x++) {
      const ch = layer[y][x] ?? '.';
      const col = colorOf(ch, d, owner);
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect((flip ? 15 - x : x) * scale, y * scale, scale, scale);
    }
  }
  cache.set(key, c);
  return c;
}

// ---------------- map tiles / node icons (16x16) ----------------
const NODE_PAL: Record<string, string> = { K: '#1a1020', m: '#c8ccd8', M: '#6c7286', w: '#8a5a2b', W: '#c08a50', y: '#f2c14e', r: '#c83c3c', g: '#4f8a3a', G: '#2f5a24', t: '#d8d0b0', T: '#9a9070', f: '#f8f8f8', b: '#3c7ddc' };
const NODE_ICONS: Record<string, Layer> = {
  home: L(
    '..K.....K.....K.', '..KoK..KoK...KoK', '..K....K.....K..', '.KKKKKKKKKKKKKK.', '.KmmMmmMmmMmmMK.', '.KmmmmmmmmmmmmK.', '.KmKKmmmKKmmKKK.',
    '.KmKKmmmKKmmKKK.', '.KmmmmmKKmmmmmK.', '.KmmmmKKKKmmmmK.', '.KmmmmKwwKmmmmK.', '.KmmmmKwwKmmmmK.', '.KMMMMKwwKMMMMK.', '.KKKKKKKKKKKKKK.', '................', '................'),
  supply: L(
    '................', '......KKKK......', '.....KttttK.....', '....KttttttK....', '...KttttttttK...', '..KKKKKKKKKKKK..', '..KwwwwwwwwwwK..',
    '..KwKKwwwwKKwK..', '..KwKyKwwKyKwK..', '..KwKKwwwwKKwK..', '..KwwwwKKwwwwK..', '..KwwwwKKwwwwK..', '..KWWWWKKWWWWK..', '..KKKKKKKKKKKK..', '................', '................'),
  barracks: L(
    '.......K........', '......KoK.......', '.......K........', '......KKK.......', '.....KtttK......', '....KtttttK.....', '...KttttTttK....',
    '..KtttttTtttK...', '.KttttttTttttK..', 'KtttttttTtttttK.', 'KTTTTTTKKTTTTTK.', 'KKKKKKKKKKKKKKK.', '..KKK......KKK..', '.KmmmK....KmmmK.', '.KKKKK....KKKKK.', '................'),
  watchtower: L(
    '....KKKKKKKK....', '....KmKmmKmK....', '....KmmmmmmK....', '....KmmKKmmK....', '....KmmKKmmK....', '.....KmmmmK.....', '.....KmMMmK.....',
    '.....KmmmmK.....', '.....KmKKmK.....', '.....KmKKmK.....', '.....KmmmmK.....', '.....KMMMMK.....', '....KmmmmmmK....', '....KMMMMMMK....', '....KKKKKKKK....', '................'),
  shrine: L(
    '.......KK.......', '......KyyK......', '.....KyyyyK.....', '......KyyK......', '.......KK.......', '....KKKKKKKK....', '...KmmmmmmmmK...',
    '...KmKKKKKKmK...', '...KmK....KmK...', '...KmK....KmK...', '...KmK....KmK...', '..KKKKK..KKKKK..', '.KmmmmmKKmmmmmK.', '.KMMMMMMMMMMMMK.', '.KKKKKKKKKKKKKK.', '................'),
  fort: L(
    '.KKK.KKK.KKK.KKK', '.KmK.KmK.KmK.KmK', '.KmKKKmKKKmKKKmK', '.KmmmmmmmmmmmmmK', '.KmmMmmmMmmmMmmK', '.KmmmmmmmmmmmmmK', '.KmKKmmmKKmmmKKK',
    '.KmKKmmmKKmmmKKK', '.KmmmmmmmmmmmmmK', '.KmmmmmKKKmmmmmK', '.KmmmmKwwwKmmmmK', '.KmmmmKwwwKmmmmK', '.KMMMMKwwwKMMMMK', '.KKKKKKKKKKKKKKK', '................', '................'),
  plain: L(
    '................', '................', '........K.......', '.......KwK......', '......KwwwK.....', '.....KwwwwwK....', '....KwwwwwwwK...',
    '...KwwwwwwwwwK..', '..KKKKKwwwKKKKK.', '.....KKwwwKK....', '......KwwwK.....', '......KwwwK.....', '......KwwwK.....', '....KKKwwwKKK...', '....KGGGGGGGK...', '....KKKKKKKKK...'),
};

export function nodeIcon(type: string, owner: PlayerId | null, scale = 1): HTMLCanvasElement {
  const key = `node:${type}:${owner}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 16 * scale; c.height = 16 * scale;
  const g = c.getContext('2d')!;
  const layer = NODE_ICONS[type] ?? NODE_ICONS.plain;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ch = layer[y]?.[x] ?? '.';
    if (ch === '.') continue;
    const col = ch === 'o' ? (owner ? OWNER[owner].o : '#9a9a9a') : NODE_PAL[ch] ?? '#ff00ff';
    g.fillStyle = col;
    g.fillRect(x * scale, y * scale, scale, scale);
  }
  cache.set(key, c);
  return c;
}

/** 8x8 grass tile variants, returned as a pattern-ready canvas (32x8 = 4 variants). */
export function grassTiles(): HTMLCanvasElement {
  const key = 'grass';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f5a24'; g.fillRect(0, 0, 32, 8);
  const tufts = [[1, 2], [5, 6], [3, 4], [6, 1], [2, 5], [7, 7], [4, 0]];
  for (let v = 0; v < 4; v++) {
    for (let i = 0; i < tufts.length; i++) {
      if ((i + v) % 3 === 0) continue;
      const [x, y] = tufts[i];
      g.fillStyle = (i + v) % 2 ? '#3a6b2c' : '#264a1c';
      g.fillRect(v * 8 + x, y, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}
