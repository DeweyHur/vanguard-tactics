import { Match, RULES, squadActive, type Squad, type MapNode, type BattleInstance } from '@vt/sim';
import { sprite, nodeIcon, grassTiles, OWNER } from './sprites';

const FONT = '11px Galmuri11, monospace';
const NODE_R = 18; // hit radius in world coords
const ZOOMS = [1, 2, 3];

export interface Hit {
  node?: MapNode;
  squad?: Squad;
  battle?: BattleInstance;
}

/** Camera: world (800x500 logical map) -> screen, integer zoom for crisp pixels. */
export class Camera {
  x = 0; y = 0; z = 2;
  constructor(public worldW: number, public worldH: number) {}
  viewW = 800; viewH = 500;
  toWorld(sx: number, sy: number) { return { x: sx / this.z + this.x, y: sy / this.z + this.y }; }
  clamp() {
    const margin = 24;
    const maxX = this.worldW + margin - this.viewW / this.z, maxY = this.worldH + margin - this.viewH / this.z;
    this.x = Math.round(Math.min(Math.max(this.x, -margin), Math.max(-margin, maxX)));
    this.y = Math.round(Math.min(Math.max(this.y, -margin), Math.max(-margin, maxY)));
  }
  centerOn(wx: number, wy: number) { this.x = wx - this.viewW / this.z / 2; this.y = wy - this.viewH / this.z / 2; this.clamp(); }
  pan(dx: number, dy: number) { this.x += dx / this.z; this.y += dy / this.z; this.clamp(); }
  /** zoom in (+1) / out (-1) keeping the world point under (sx, sy) fixed */
  zoomStep(dir: number, sx: number, sy: number) {
    const i = ZOOMS.indexOf(this.z);
    const nz = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
    if (nz === this.z) return;
    const before = this.toWorld(sx, sy);
    this.z = nz;
    this.x = before.x - sx / this.z; this.y = before.y - sy / this.z;
    this.clamp();
  }
}

export class MapView {
  ctx: CanvasRenderingContext2D;
  mini: CanvasRenderingContext2D;
  hover: Hit = {};
  cam: Camera;
  private grass: CanvasPattern | null = null;
  constructor(public canvas: HTMLCanvasElement, public minimap: HTMLCanvasElement, worldW: number, worldH: number) {
    this.ctx = canvas.getContext('2d')!;
    this.mini = minimap.getContext('2d')!;
    this.cam = new Camera(worldW, worldH);
  }

  /** size the canvas to its container (device pixels) */
  fit(wrap: HTMLElement) {
    const w = Math.max(200, wrap.clientWidth - 8), h = Math.max(150, wrap.clientHeight - 8);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
      this.cam.viewW = w; this.cam.viewH = h;
      this.cam.clamp();
    }
  }

  /** world position where a squad is drawn (32x32 box; offset so stacked squads don't overlap) */
  private squadDrawPos(m: Match, sq: Squad, idx: number) {
    const p = m.squadPos(sq);
    const dx = sq.owner === 'P1' ? -52 : 20;
    return { x: p.x + dx + (idx % 2) * 26, y: p.y - 44 + Math.floor(idx / 2) * 30 };
  }

  /** hit test in world coordinates */
  hitTest(m: Match, mx: number, my: number): Hit {
    const st = m.state;
    for (const b of st.battles) if (!b.applied && Math.hypot(b.x - mx, b.y - my) < 18) return { battle: b };
    const perLoc = new Map<string, number>();
    let best: Hit = {};
    let bestD = 24;
    for (const sq of st.squads) {
      if (sq.state === 'battle') continue;
      const key = sq.loc.node ?? `${sq.loc.edge!.from}-${sq.loc.edge!.to}-${sq.loc.edge!.dist.toFixed(1)}`;
      const idx = perLoc.get(key) ?? 0; perLoc.set(key, idx + 1);
      const p = this.squadDrawPos(m, sq, idx);
      const d = Math.hypot(p.x + 16 - mx, p.y + 18 - my);
      if (d < bestD) { bestD = d; best = { squad: sq }; }
    }
    if (best.squad) return best;
    for (const n of st.map.nodes) if (Math.hypot(n.x - mx, n.y - my) < NODE_R + 10) return { node: n };
    return {};
  }

  draw(m: Match, selected: Squad | null, now: number) {
    const g = this.ctx;
    const st = m.state;
    const cam = this.cam;
    const W = st.map.width, H = st.map.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#05060e';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(cam.z, 0, 0, cam.z, -Math.round(cam.x * cam.z), -Math.round(cam.y * cam.z));
    if (!this.grass) this.grass = g.createPattern(grassTiles(), 'repeat');
    g.fillStyle = this.grass ?? '#2f5a24';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#264a1c';
    for (let x = 0; x < W; x += 32) g.fillRect(x, 236 + ((x / 32) % 2) * 3, 16, 3);
    // world border
    g.strokeStyle = '#07070f'; g.lineWidth = 4; g.strokeRect(0, 0, W, H);

    // roads
    for (const e of st.map.edges) {
      const a = m.node(e.a), b = m.node(e.b);
      g.strokeStyle = '#3a2a14'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    if (selected && selected.path.length) {
      g.strokeStyle = '#f4c64f'; g.lineWidth = 2; g.setLineDash([4, 4]); g.lineDashOffset = -Math.floor(now / 100) % 8;
      const p0 = m.squadPos(selected);
      g.beginPath(); g.moveTo(p0.x, p0.y);
      for (const nid of selected.path) { const n = m.node(nid); g.lineTo(n.x, n.y); }
      g.stroke(); g.setLineDash([]);
    }
    g.font = FONT; g.textBaseline = 'top';
    // nodes
    for (const n of st.map.nodes) {
      const owner = st.nodes[n.id].owner;
      const col = owner ? OWNER[owner].o : '#9a9a9a';
      const x = n.x, y = n.y;
      g.fillStyle = '#1a1020'; g.fillRect(x - 20, y - 18, 40, 40);
      g.fillStyle = owner ? OWNER[owner].O : '#5a5a5a'; g.fillRect(x - 18, y - 16, 36, 36);
      g.fillStyle = col; g.fillRect(x - 18, y - 16, 36, 3);
      g.drawImage(nodeIcon(n.type, owner, 1), x - 16, y - 16);
      g.textAlign = 'center';
      g.fillStyle = '#07070f'; g.fillText(n.name, x + 1, y + 23);
      g.fillStyle = owner ? '#f2eedc' : '#c8c8c8'; g.fillText(n.name, x, y + 22);
      if (this.hover.node === n) { g.strokeStyle = '#f4c64f'; g.lineWidth = 2; g.strokeRect(x - 22, y - 20, 44, 44); }
      const capt = st.squads.find((s) => s.loc.node === n.id && s.state === 'capturing');
      if (capt) {
        g.fillStyle = '#07070f'; g.fillRect(x - 20, y - 26, 40, 7);
        g.fillStyle = OWNER[capt.owner].o; g.fillRect(x - 18, y - 24, Math.round(36 * (capt.captureT / RULES.captureTime)), 3);
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
      const x = Math.round(p.x), y = Math.round(p.y) + (sq.state === 'moving' || sq.state === 'retreating' ? bob : 0);
      const units = squadActive(sq);
      const leader = sq.slots[sq.leader] && !sq.slots[sq.leader]!.injured ? sq.slots[sq.leader]! : units[0];
      const oc = OWNER[sq.owner];
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 6, y + 30, 20, 3);
      // draw the 64px sprite into a 32-world-unit box: at zoom 2 this is pixel-exact
      if (leader) g.drawImage(sprite(leader.def, sq.owner, 1), x, y, 32, 32);
      g.fillStyle = '#07070f'; g.fillRect(x + 28, y - 8, 2, 20);
      g.fillStyle = sq.state === 'scattered' || sq.state === 'retreating' ? '#777' : oc.o; g.fillRect(x + 30, y - 8, 16, 12);
      g.fillStyle = '#fff'; g.textAlign = 'left';
      g.fillText(String(units.length), x + 34, y - 8);
      if (sq.state === 'scattered') { g.fillStyle = '#e8514c'; g.fillText('X', x + 32, y + 8); }
      if (sq.state === 'retreating') { g.fillStyle = '#ffa63d'; g.fillText('«', x + 32, y + 8); }
      if (selected === sq) { g.strokeStyle = '#f4c64f'; g.lineWidth = 2; g.strokeRect(x - 2, y - 2, 36, 36); }
      else if (this.hover.squad === sq) { g.strokeStyle = '#ece8d8'; g.lineWidth = 2; g.strokeRect(x - 2, y - 2, 36, 36); }
    }
    // battles
    for (const b of st.battles) {
      if (b.applied) continue;
      const x = Math.round(b.x), y = Math.round(b.y);
      const blink = Math.floor(now / 250) % 2 === 0;
      g.fillStyle = '#07070f'; g.fillRect(x - 14, y - 14, 28, 28);
      g.fillStyle = blink ? '#f4c64f' : '#ffa63d'; g.fillRect(x - 12, y - 12, 24, 24);
      g.fillStyle = '#07070f'; g.font = '22px Galmuri11, monospace'; g.textAlign = 'center'; g.fillText('⚔', x, y - 12);
      g.font = FONT;
      const prog = (st.t - b.startT) / (b.endT - b.startT);
      g.fillStyle = '#07070f'; g.fillRect(x - 14, y + 15, 28, 6);
      g.fillStyle = '#f4c64f'; g.fillRect(x - 12, y + 17, Math.round(24 * Math.min(1, prog)), 2);
      if (this.hover.battle === b) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x - 16, y - 16, 32, 32); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMinimap(m);
  }

  /** minimap scale: world -> minimap pixels */
  miniScale() { return Math.min(this.minimap.width / this.cam.worldW, this.minimap.height / this.cam.worldH); }

  private drawMinimap(m: Match) {
    const g = this.mini;
    const st = m.state;
    const k = this.miniScale();
    const mw = this.minimap.width, mh = this.minimap.height;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1e3a18'; g.fillRect(0, 0, mw, mh);
    g.strokeStyle = '#5a4428'; g.lineWidth = 2;
    for (const e of st.map.edges) {
      const a = m.node(e.a), b = m.node(e.b);
      g.beginPath(); g.moveTo(a.x * k, a.y * k); g.lineTo(b.x * k, b.y * k); g.stroke();
    }
    for (const n of st.map.nodes) {
      const owner = st.nodes[n.id].owner;
      g.fillStyle = '#07070f'; g.fillRect(Math.round(n.x * k) - 4, Math.round(n.y * k) - 4, 8, 8);
      g.fillStyle = owner ? OWNER[owner].o : '#9a9a9a'; g.fillRect(Math.round(n.x * k) - 3, Math.round(n.y * k) - 3, 6, 6);
    }
    for (const sq of st.squads) {
      if (sq.state === 'battle') continue;
      const p = m.squadPos(sq);
      g.fillStyle = '#07070f'; g.fillRect(Math.round(p.x * k) - 2 + (sq.owner === 'P1' ? -5 : 5), Math.round(p.y * k) - 7, 5, 5);
      g.fillStyle = OWNER[sq.owner].o; g.fillRect(Math.round(p.x * k) - 1 + (sq.owner === 'P1' ? -5 : 5), Math.round(p.y * k) - 6, 3, 3);
    }
    for (const b of st.battles) {
      if (b.applied) continue;
      g.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#f4c64f' : '#ffa63d';
      g.fillRect(Math.round(b.x * k) - 3, Math.round(b.y * k) - 3, 6, 6);
    }
    // viewport rectangle
    const cam = this.cam;
    g.strokeStyle = '#f2eedc'; g.lineWidth = 1;
    g.strokeRect(Math.round(cam.x * k) + 0.5, Math.round(cam.y * k) + 0.5, Math.round((cam.viewW / cam.z) * k), Math.round((cam.viewH / cam.z) * k));
  }
}
