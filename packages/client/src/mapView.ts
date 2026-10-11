import { Match, RULES, squadActive, type Squad, type MapNode, type BattleInstance } from '@vt/sim';
import { sprite, nodeIcon, grassTiles, OWNER } from './sprites';

/** The map is rendered at half resolution (400x250) and upscaled with pixelated scaling. */
const S = 0.5;
const FONT = '9px Galmuri9, monospace';
const NODE_R = 14; // hit radius in map coords

export interface Hit {
  node?: MapNode;
  squad?: Squad;
  battle?: BattleInstance;
}

export class MapView {
  ctx: CanvasRenderingContext2D;
  hover: Hit = {};
  private grass: CanvasPattern | null = null;
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** map-coordinate position where a squad is drawn (offset so stacked squads don't overlap) */
  private squadDrawPos(m: Match, sq: Squad, idx: number) {
    const p = m.squadPos(sq);
    const dx = sq.owner === 'P1' ? -34 : 18;
    return { x: p.x + dx + (idx % 2) * 18, y: p.y - 30 + Math.floor(idx / 2) * 22 };
  }

  hitTest(m: Match, mx: number, my: number): Hit {
    const st = m.state;
    for (const b of st.battles) if (!b.applied && Math.hypot(b.x - mx, b.y - my) < 16) return { battle: b };
    const perLoc = new Map<string, number>();
    let best: Hit = {};
    let bestD = 20;
    for (const sq of st.squads) {
      if (sq.state === 'battle') continue;
      const key = sq.loc.node ?? `${sq.loc.edge!.from}-${sq.loc.edge!.to}-${sq.loc.edge!.dist.toFixed(1)}`;
      const idx = perLoc.get(key) ?? 0; perLoc.set(key, idx + 1);
      const p = this.squadDrawPos(m, sq, idx);
      const d = Math.hypot(p.x + 16 - mx, p.y + 16 - my);
      if (d < bestD) { bestD = d; best = { squad: sq }; }
    }
    if (best.squad) return best;
    for (const n of st.map.nodes) if (Math.hypot(n.x - mx, n.y - my) < NODE_R + 8) return { node: n };
    return {};
  }

  draw(m: Match, selected: Squad | null, now: number) {
    const g = this.ctx;
    const st = m.state;
    const W = this.canvas.width, H = this.canvas.height;
    g.imageSmoothingEnabled = false;
    if (!this.grass) this.grass = g.createPattern(grassTiles(), 'repeat');
    g.fillStyle = this.grass ?? '#2f5a24';
    g.fillRect(0, 0, W, H);
    // river-ish darker band across the middle for flavour
    g.fillStyle = '#264a1c';
    for (let x = 0; x < W; x += 16) g.fillRect(x, 118 + ((x / 16) % 2) * 2, 8, 2);

    // roads: dark edge + dirt centre, dotted
    g.lineCap = 'butt';
    for (const e of st.map.edges) {
      const a = m.node(e.a), b = m.node(e.b);
      g.strokeStyle = '#3a2a14'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(Math.round(a.x * S), Math.round(a.y * S)); g.lineTo(Math.round(b.x * S), Math.round(b.y * S)); g.stroke();
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(Math.round(a.x * S), Math.round(a.y * S)); g.lineTo(Math.round(b.x * S), Math.round(b.y * S)); g.stroke();
    }
    // selected squad path
    if (selected && selected.path.length) {
      g.strokeStyle = '#f4c64f'; g.lineWidth = 1; g.setLineDash([2, 2]); g.lineDashOffset = -Math.floor(now / 100) % 4;
      const p0 = m.squadPos(selected);
      g.beginPath(); g.moveTo(p0.x * S, p0.y * S);
      for (const nid of selected.path) { const n = m.node(nid); g.lineTo(n.x * S, n.y * S); }
      g.stroke(); g.setLineDash([]);
    }
    g.font = FONT; g.textBaseline = 'top';
    // nodes
    for (const n of st.map.nodes) {
      const owner = st.nodes[n.id].owner;
      const col = owner ? OWNER[owner].o : '#9a9a9a';
      const x = Math.round(n.x * S), y = Math.round(n.y * S);
      // ground plate
      g.fillStyle = '#1a1020'; g.fillRect(x - 10, y - 9, 20, 20);
      g.fillStyle = owner ? OWNER[owner].O : '#5a5a5a'; g.fillRect(x - 9, y - 8, 18, 18);
      g.fillStyle = col; g.fillRect(x - 9, y - 8, 18, 2);
      g.drawImage(nodeIcon(n.type, owner, 1), x - 8, y - 8);
      // name tag
      const label = n.name;
      g.textAlign = 'center';
      g.fillStyle = '#07070f'; g.fillText(label, x + 1, y + 12 + 1);
      g.fillStyle = owner ? '#f2eedc' : '#c8c8c8'; g.fillText(label, x, y + 12);
      if (this.hover.node === n) { g.strokeStyle = '#f4c64f'; g.lineWidth = 1; g.strokeRect(x - 11.5, y - 10.5, 23, 23); }
      const capt = st.squads.find((s) => s.loc.node === n.id && s.state === 'capturing');
      if (capt) {
        g.fillStyle = '#07070f'; g.fillRect(x - 10, y - 14, 20, 4);
        g.fillStyle = OWNER[capt.owner].o; g.fillRect(x - 9, y - 13, Math.round(18 * (capt.captureT / RULES.captureTime)), 2);
      }
    }
    // squads
    const perLoc = new Map<string, number>();
    const bob = Math.floor(now / 400) % 2;
    for (const sq of st.squads) {
      if (sq.state === 'battle') continue;
      const key = sq.loc.node ?? `${sq.loc.edge!.from}-${sq.loc.edge!.to}-${sq.loc.edge!.dist.toFixed(1)}`;
      const idx = perLoc.get(key) ?? 0; perLoc.set(key, idx + 1);
      const p = this.squadDrawPos(m, sq, idx);
      const x = Math.round(p.x * S), y = Math.round(p.y * S) + (sq.state === 'moving' || sq.state === 'retreating' ? bob : 0);
      const units = squadActive(sq);
      const leader = sq.slots[sq.leader] && !sq.slots[sq.leader]!.injured ? sq.slots[sq.leader]! : units[0];
      const oc = OWNER[sq.owner];
      // shadow
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 3, y + 15, 10, 2);
      if (leader) g.drawImage(sprite(leader.def, sq.owner, 1), x, y);
      // flag with unit count
      g.fillStyle = '#07070f'; g.fillRect(x + 13, y - 4, 1, 10);
      g.fillStyle = sq.state === 'scattered' || sq.state === 'retreating' ? '#777' : oc.o; g.fillRect(x + 14, y - 4, 8, 6);
      g.fillStyle = '#fff'; g.font = '7px Galmuri7, monospace'; g.textAlign = 'left';
      g.fillText(String(units.length), x + 16, y - 4);
      g.font = FONT;
      if (sq.state === 'scattered') { g.fillStyle = '#e8514c'; g.fillText('X', x + 14, y + 4); }
      if (sq.state === 'retreating') { g.fillStyle = '#ffa63d'; g.fillText('«', x + 14, y + 4); }
      if (selected === sq) { g.strokeStyle = '#f4c64f'; g.lineWidth = 1; g.strokeRect(x - 1.5, y - 1.5, 19, 19); }
      else if (this.hover.squad === sq) { g.strokeStyle = '#ece8d8'; g.lineWidth = 1; g.strokeRect(x - 1.5, y - 1.5, 19, 19); }
    }
    // battles
    for (const b of st.battles) {
      if (b.applied) continue;
      const x = Math.round(b.x * S), y = Math.round(b.y * S);
      const blink = Math.floor(now / 250) % 2 === 0;
      g.fillStyle = '#07070f'; g.fillRect(x - 8, y - 8, 16, 16);
      g.fillStyle = blink ? '#f4c64f' : '#ffa63d'; g.fillRect(x - 7, y - 7, 14, 14);
      g.fillStyle = '#07070f'; g.font = '11px Galmuri11, monospace'; g.textAlign = 'center'; g.fillText('⚔', x, y - 7);
      g.font = FONT;
      const prog = (st.t - b.startT) / (b.endT - b.startT);
      g.fillStyle = '#07070f'; g.fillRect(x - 8, y + 9, 16, 3);
      g.fillStyle = '#f4c64f'; g.fillRect(x - 7, y + 10, Math.round(14 * Math.min(1, prog)), 1);
      if (this.hover.battle === b) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x - 9.5, y - 9.5, 19, 19); }
    }
  }
}
