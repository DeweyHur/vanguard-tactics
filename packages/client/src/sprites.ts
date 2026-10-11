import { unitDef, type PlayerId } from '@vt/sim';

/** 12x12 procedural pixel sprites, one per unit def + owner tint. Cached. */
const cache = new Map<string, HTMLCanvasElement>();

const PATTERNS: Record<string, string[]> = {
  // 12 cols x 12 rows. '.' transparent, 'b' body, 's' skin, 'w' weapon(metal), 'o' owner color, 'd' dark
  infantry: [
    '....ss......', '....ss......', '...bbbb.w...', '..obbbbow...', '..obbbbow...', '...bbbb.w...',
    '...b..b.w...', '...d..d.w...', '...d..d.....', '............', '............', '............'],
  spear: [
    '........w...', '....ss..w...', '....ss..w...', '...bbbb.w...', '..obbbbow...', '..obbbbow...',
    '...bbbb.w...', '...b..b.w...', '...d..d.....', '............', '............', '............'],
  archer: [
    '....ss......', '....ss..w...', '...bbbb.w...', '..obbbb.w...', '..obbbbww...', '...bbbb.w...',
    '...b..b.w...', '...d..d.....', '............', '............', '............', '............'],
  axe: [
    '....ss.ww...', '....ss.ww...', '...bbbb.w...', '..obbbbow...', '..obbbbow...', '...bbbb.w...',
    '...b..b.....', '...d..d.....', '............', '............', '............', '............'],
  shield: [
    '....ss......', '....ss......', '.ww.bbbb....', '.wwobbbbo...', '.wwobbbbo...', '.ww.bbbb....',
    '....b..b....', '....d..d....', '............', '............', '............', '............'],
  healer: [
    '....ss......', '....ss......', '...bbbb.w...', '..obbbbwww..', '..obbbbow...', '...bbbb.....',
    '...bbbb.....', '...b..b.....', '............', '............', '............', '............'],
  mage: [
    '....bb......', '...bbbb.w...', '....ss..w...', '...bbbb.w...', '..obbbbow...', '..obbbbow...',
    '...bbbb.w...', '...bbbb.....', '............', '............', '............', '............'],
  cavalry: [
    '....ss......', '....ss..w...', '...bbbb.w...', '..obbbbow...', '.ddddddddd..', '.ddddddddd..',
    '.d.dd...dd..', '.d.d....d...', '............', '............', '............', '............'],
  hooker: [
    '....ss......', '....ss......', '...bbbb.w.w.', '..obbbbo.w..', '..obbbbo.w..', '...bbbb.w.w.',
    '...b..b.....', '...d..d.....', '............', '............', '............', '............'],
  giant: [
    '...ssss.....', '...ssss.....', '.bbbbbbbb...', 'obbbbbbbbo..', 'obbbbbbbbo..', '.bbbbbbbb.ww',
    '.bbbbbbbb.ww', '.bb....bb...', '.dd....dd...', '.dd....dd...', '............', '............'],
  herald: [
    '....ss......', '....ss.www..', '...bbbb.w...', '..obbbbow...', '..obbbbow...', '...bbbb.....',
    '...b..b.....', '...d..d.....', '............', '............', '............', '............'],
  wagon: [
    '............', '............', '.bbbbbbbbb..', '.bbbbbbbbb..', '.bbbbbbbbb..', '.bbbbbbbbb..',
    '..dd...dd...', '.dddd.dddd..', '..dd...dd...', '............', '............', '............'],
};

export function sprite(def: string, owner: PlayerId, scale = 4): HTMLCanvasElement {
  const key = `${def}:${owner}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = unitDef(def);
  const pat = PATTERNS[def] ?? PATTERNS.infantry;
  const c = document.createElement('canvas');
  c.width = 12 * scale; c.height = 12 * scale;
  const g = c.getContext('2d')!;
  const colors: Record<string, string> = { b: d.color, s: '#f1c9a5', w: '#d8d8e8', o: owner === 'P1' ? '#4aa3ff' : '#ff5a5a', d: '#2b2230' };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const ch = pat[y]?.[x] ?? '.';
    if (ch === '.') continue;
    g.fillStyle = colors[ch];
    g.fillRect(x * scale, y * scale, scale, scale);
  }
  cache.set(key, c);
  return c;
}
