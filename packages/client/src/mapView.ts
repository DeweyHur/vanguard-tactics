import { Match, RULES, squadActive, type Squad, type MapNode, type BattleInstance } from '@vt/sim';
import { sprite } from './sprites';

const NODE_ICON: Record<string, string> = { home: '⌂', supply: '$', barracks: '⚔', watchtower: '▲', shrine: '✦', fort: '▣', plain: '·' };
const NODE_R = 14;

export interface Hit {
  node?: MapNode;
  squad?: Squad;
  battle?: BattleInstance;
}

export class MapView {
  ctx: CanvasRenderingContext2D;
  hover: Hit = {};
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** squads offset so multiple at a node don't overlap */
  private squadDrawPos(m: Match, sq: Squad, idx: number) {
    const p = m.squadPos(sq);
    const dx = sq.owner === 'P1' ? -18 : 18;
    return { x: p.x + dx + (idx % 2) * 10, y: p.y - 10 + Math.floor(idx / 2) * 14 };
  }

  hitTest(m: Match, mx: number, my: number): Hit {
    const st = m.state;
    for (const b of st.battles) if (!b.applied && Math.hypot(b.x - mx, b.y - my) < 14) return { battle: b };
    const perLoc = new Map<string, number>();
    let best: Hit = {};
    let bestD = 16;
    for (const sq of st.squads) {
      const key = sq.loc.node ?? `${sq.loc.edge!.from}-${sq.loc.edge!.to}-${sq.loc.edge!.dist.toFixed(1)}`;
      const idx = perLoc.get(key) ?? 0; perLoc.set(key, idx + 1);
      const p = this.squadDrawPos(m, sq, idx);
      const d = Math.hypot(p.x + 8 - mx, p.y + 8 - my);
      if (d < bestD) { bestD = d; best = { squad: sq }; }
    }
    if (best.squad) return best;
    for (const n of st.map.nodes) if (Math.hypot(n.x - mx, n.y - my) < NODE_R + 6) return { node: n };
    return {};
  }

  draw(m: Match, selected: Squad | null, now: number) {
    const g = this.ctx;
    const st = m.state;
    const W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#1a2617';
    g.fillRect(0, 0, W, H);
    // subtle grid
    g.fillStyle = '#1f2d1b';
    for (let x = 0; x < W; x += 20) for (let y = 0; y < H; y += 20) if ((x + y) % 40 === 0) g.fillRect(x, y, 10, 10);

    // edges
    g.lineWidth = 6; g.strokeStyle = '#5a4b36';
    for (const e of st.map.edges) {
      const a = m.node(e.a), b = m.node(e.b);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // selected squad path
    if (selected && selected.path.length) {
      g.lineWidth = 2; g.strokeStyle = '#ffd166'; g.setLineDash([4, 4]);
      const p0 = m.squadPos(selected);
      g.beginPath(); g.moveTo(p0.x, p0.y);
      for (const nid of selected.path) { const n = m.node(nid); g.lineTo(n.x, n.y); }
      g.stroke(); g.setLineDash([]);
    }
    // nodes
    for (const n of st.map.nodes) {
      const owner = st.nodes[n.id].owner;
      const col = owner === 'P1' ? '#4aa3ff' : owner === 'P2' ? '#ff5a5a' : '#8d8d8d';
      const r = n.type === 'home' ? NODE_R + 6 : NODE_R;
      g.fillStyle = '#0d0b12'; g.fillRect(n.x - r - 2, n.y - r - 2, r * 2 + 4, r * 2 + 4);
      g.fillStyle = col; g.fillRect(n.x - r, n.y - r, r * 2, r * 2);
      g.fillStyle = '#0d0b12'; g.fillRect(n.x - r + 3, n.y - r + 3, r * 2 - 6, r * 2 - 6);
      g.fillStyle = col; g.font = `${n.type === 'home' ? 18 : 14}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(NODE_ICON[n.type], n.x, n.y + 1);
      g.fillStyle = '#e8e0f0'; g.font = '10px monospace';
      g.fillText(n.name, n.x, n.y + r + 10);
      if (this.hover.node === n) { g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.strokeRect(n.x - r - 3, n.y - r - 3, r * 2 + 6, r * 2 + 6); }
      // capture progress
      const capt = st.squads.find((s) => s.loc.node === n.id && s.state === 'capturing');
      if (capt) {
        g.fillStyle = '#000'; g.fillRect(n.x - 16, n.y - r - 20, 32, 5);
        g.fillStyle = capt.owner === 'P1' ? '#4aa3ff' : '#ff5a5a'; g.fillRect(n.x - 16, n.y - r - 20, 32 * (capt.captureT / RULES.captureTime), 5);
      }
    }
    // squads
    const perLoc = new Map<string, number>();
    for (const sq of st.squads) {
      const key = sq.loc.node ?? `${sq.loc.edge!.from}-${sq.loc.edge!.to}-${sq.loc.edge!.dist.toFixed(1)}`;
      const idx = perLoc.get(key) ?? 0; perLoc.set(key, idx + 1);
      const p = this.squadDrawPos(m, sq, idx);
      const units = squadActive(sq);
      const leader = sq.slots[sq.leader] && !sq.slots[sq.leader]!.injured ? sq.slots[sq.leader]! : units[0];
      const col = sq.owner === 'P1' ? '#4aa3ff' : '#ff5a5a';
      if (sq.state === 'battle') continue; // drawn inside the battle marker
      g.fillStyle = sq.state === 'scattered' || sq.state === 'retreating' ? '#3a2a2a' : '#0d0b12';
      g.fillRect(p.x - 2, p.y - 2, 20, 20);
      g.strokeStyle = col; g.lineWidth = selected === sq ? 3 : 1; g.strokeRect(p.x - 2, p.y - 2, 20, 20);
      if (leader) g.drawImage(sprite(leader.def, sq.owner, 1), p.x + 2, p.y + 2);
      else { g.fillStyle = col; g.fillText('∅', p.x + 8, p.y + 9); }
      g.fillStyle = col; g.font = 'bold 10px monospace'; g.textAlign = 'left';
      g.fillText(String(units.length), p.x + 20, p.y + 6);
      if (sq.state === 'scattered') { g.fillStyle = '#ff5a5a'; g.fillText('✖', p.x + 20, p.y + 17); }
      if (sq.state === 'retreating') { g.fillStyle = '#ffb347'; g.fillText('↩', p.x + 20, p.y + 17); }
      if (this.hover.squad === sq) { g.strokeStyle = '#ffd166'; g.lineWidth = 1; g.strokeRect(p.x - 4, p.y - 4, 24, 24); }
    }
    // battles
    for (const b of st.battles) {
      if (b.applied) continue;
      const blink = Math.floor(now / 250) % 2 === 0;
      g.fillStyle = blink ? '#ffd166' : '#ff8c42';
      g.beginPath(); g.arc(b.x, b.y, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000'; g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.fillText('⚔', b.x, b.y + 1);
      const prog = (st.t - b.startT) / (b.endT - b.startT);
      g.fillStyle = '#000'; g.fillRect(b.x - 14, b.y + 16, 28, 4);
      g.fillStyle = '#ffd166'; g.fillRect(b.x - 14, b.y + 16, 28 * Math.min(1, prog), 4);
      if (this.hover.battle === b) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, 16, 0, Math.PI * 2); g.stroke(); }
    }
  }
}
