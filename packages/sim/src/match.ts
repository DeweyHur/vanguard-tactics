import { Rng, hashSeed } from './rng';
import { runBattle } from './battle';
import { unitDef } from './data/units';
import { makeUnit, squadActive, squadUnits } from './factory';
import {
  type BattleResult, type MapDef, type MapNode, type PlayerId, type Row, type Squad, type Tactic, type UnitInstance,
  SQUAD_SLOTS, slotRow,
} from './types';

export type GameMode = 'domination' | 'shrine' | 'annihilation';

export const RULES = {
  tick: 0.1,
  matchLength: 20 * 60,
  captureTime: 8,
  startGold: 60,
  incomeBase: 2,
  incomeSupply: 1.5,
  incomeNode: 0.5,
  goldPerCost: 10,
  maxSquads: 5,
  dominationHold: 120,
  shrineHold: 120,
  fortMoraleBonus: 15,
  retreatSpeedMult: 1.3,
  drawCooldown: 5,
  regenAtOwnedNode: 2, // hp per second
  routedDamage: 0.25, // fraction of max hp when caught while scattered/retreating
  battleSecondsPerAction: 1.1,
  battleMinSeconds: 6,
};

export interface NodeState { id: string; owner: PlayerId | null; }
export interface PlayerState { id: PlayerId; gold: number; squadsMade: number; unitsMade: number; }
export interface BattleInstance {
  id: string;
  squads: Record<'A' | 'B', string>;
  owners: Record<'A' | 'B', PlayerId>;
  result: BattleResult;
  startT: number;
  endT: number;
  x: number;
  y: number;
  where: string;
  applied: boolean;
}
export interface LogEntry { t: number; msg: string; kind: 'info' | 'battle' | 'capture' | 'end' }

export interface MatchState {
  map: MapDef;
  mode: GameMode;
  seed: number;
  t: number;
  players: Record<PlayerId, PlayerState>;
  nodes: Record<string, NodeState>;
  squads: Squad[];
  battles: BattleInstance[];
  log: LogEntry[];
  winner: PlayerId | 'draw' | null;
  winReason: string;
  hold: Record<PlayerId, number>;
}

export type Command =
  | { type: 'createSquad'; node: string }
  | { type: 'recruit'; squad: string; unit: string; slot: number }
  | { type: 'dismiss'; squad: string; slot: number }
  | { type: 'swap'; squad: string; from: number; to: number }
  | { type: 'setLeader'; squad: string; slot: number }
  | { type: 'setTactics'; squad: string; slot: number; row: Row; tactics: Tactic[] }
  | { type: 'move'; squad: string; target: string }
  | { type: 'stop'; squad: string }
  | { type: 'reform'; squad: string }
  | { type: 'disband'; squad: string };

export interface CommandResult { ok: boolean; error?: string }

export const PLAYERS: PlayerId[] = ['P1', 'P2'];
export const enemyOf = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');

export class Match {
  state: MatchState;
  private rng: Rng;
  private adj: Map<string, { to: string; len: number }[]> = new Map();
  private nodeById: Map<string, MapNode> = new Map();
  private battleSeq = 0;
  private prevEdgePos = new Map<string, number>();

  constructor(map: MapDef, mode: GameMode, seed: number) {
    this.rng = new Rng(seed);
    for (const n of map.nodes) this.nodeById.set(n.id, n);
    for (const n of map.nodes) this.adj.set(n.id, []);
    for (const e of map.edges) {
      this.adj.get(e.a)!.push({ to: e.b, len: e.len });
      this.adj.get(e.b)!.push({ to: e.a, len: e.len });
    }
    this.state = {
      map, mode, seed, t: 0,
      players: {
        P1: { id: 'P1', gold: RULES.startGold, squadsMade: 0, unitsMade: 0 },
        P2: { id: 'P2', gold: RULES.startGold, squadsMade: 0, unitsMade: 0 },
      },
      nodes: Object.fromEntries(map.nodes.map((n) => [n.id, { id: n.id, owner: n.owner ?? null }])),
      squads: [], battles: [], log: [], winner: null, winReason: '', hold: { P1: 0, P2: 0 },
    };
    // starting squad for each player at home
    for (const p of PLAYERS) {
      const home = this.homeOf(p);
      const sq = this.newSquad(p, home.id);
      const start = ['infantry', 'spear', 'infantry', 'archer', null, 'archer'];
      start.forEach((d, i) => { if (d) sq.slots[i] = this.newUnit(p, d); });
      sq.leader = 0;
    }
    this.log('매치 시작', 'info');
  }

  // ---------- helpers ----------
  node(id: string): MapNode { const n = this.nodeById.get(id); if (!n) throw new Error(`no node ${id}`); return n; }
  homeOf(p: PlayerId): MapNode { return this.state.map.nodes.find((n) => n.type === 'home' && n.owner === p)!; }
  squad(id: string): Squad | undefined { return this.state.squads.find((s) => s.id === id); }
  ownerOf(nodeId: string): PlayerId | null { return this.state.nodes[nodeId].owner; }
  edgeLen(a: string, b: string): number { return this.adj.get(a)!.find((e) => e.to === b)?.len ?? Infinity; }
  private log(msg: string, kind: LogEntry['kind']) { this.state.log.push({ t: this.state.t, msg, kind }); if (this.state.log.length > 200) this.state.log.shift(); }

  private newSquad(p: PlayerId, node: string): Squad {
    const ps = this.state.players[p];
    ps.squadsMade++;
    const sq: Squad = {
      id: `${p}-s${ps.squadsMade}`, owner: p, name: `${p === 'P1' ? '서' : '동'}${ps.squadsMade}부대`,
      slots: Array(SQUAD_SLOTS).fill(null), leader: -1, state: 'idle', loc: { node }, path: [], captureT: 0, cooldown: 0,
    };
    this.state.squads.push(sq);
    return sq;
  }
  private newUnit(p: PlayerId, def: string): UnitInstance {
    const ps = this.state.players[p];
    ps.unitsMade++;
    return makeUnit(def, `${p}-u${ps.unitsMade}`);
  }

  /** squad speed in distance units per second */
  squadSpeed(sq: Squad): number {
    const us = squadActive(sq);
    if (!us.length) return 0;
    const avg = us.reduce((a, u) => a + unitDef(u.def).move, 0) / us.length;
    return avg / 10;
  }
  squadPos(sq: Squad): { x: number; y: number } {
    if (sq.loc.node) { const n = this.node(sq.loc.node); return { x: n.x, y: n.y }; }
    const e = sq.loc.edge!;
    const a = this.node(e.from), b = this.node(e.to);
    const f = e.dist / this.edgeLen(e.from, e.to);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  canRecruitAt(p: PlayerId, nodeId: string): boolean {
    const n = this.node(nodeId);
    return this.ownerOf(nodeId) === p && (n.type === 'home' || n.type === 'barracks');
  }
  isCombatReady(sq: Squad): boolean {
    return (sq.state === 'idle' || sq.state === 'moving' || sq.state === 'capturing') && squadActive(sq).length > 0 && sq.cooldown <= 0;
  }

  /** Dijkstra: shortest path node list from `from` (exclusive) to `to` (inclusive). */
  findPath(from: string, to: string): string[] | null {
    if (from === to) return [];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    while (open.size) {
      let cur = '';
      let best = Infinity;
      for (const n of open) { const d = dist.get(n)!; if (d < best) { best = d; cur = n; } }
      open.delete(cur);
      if (cur === to) break;
      for (const e of this.adj.get(cur)!) {
        const nd = best + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); open.add(e.to); }
      }
    }
    if (!dist.has(to)) return null;
    const path: string[] = [];
    for (let c = to; c !== from; c = prev.get(c)!) path.unshift(c);
    return path;
  }
  pathLength(from: string, path: string[]): number {
    let d = 0, cur = from;
    for (const n of path) { d += this.edgeLen(cur, n); cur = n; }
    return d;
  }
  nearestOwnedNode(p: PlayerId, from: string, exclude?: string): string {
    let best = this.homeOf(p).id, bestD = Infinity;
    for (const n of this.state.map.nodes) {
      if (this.ownerOf(n.id) !== p || n.id === exclude) continue;
      const path = this.findPath(from, n.id);
      if (!path) continue;
      const d = this.pathLength(from, path);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  // ---------- commands ----------
  command(p: PlayerId, c: Command): CommandResult {
    if (this.state.winner) return { ok: false, error: '매치 종료' };
    const fail = (error: string): CommandResult => ({ ok: false, error });
    const ps = this.state.players[p];
    const getSq = (id: string) => { const s = this.squad(id); return s && s.owner === p ? s : undefined; };
    switch (c.type) {
      case 'createSquad': {
        if (!this.canRecruitAt(p, c.node)) return fail('소환 가능 거점이 아님');
        if (this.state.squads.filter((s) => s.owner === p).length >= RULES.maxSquads) return fail('부대 수 상한');
        this.newSquad(p, c.node);
        return { ok: true };
      }
      case 'recruit': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (!sq.loc.node || !this.canRecruitAt(p, sq.loc.node)) return fail('소환 가능 거점에 있지 않음');
        if (sq.state === 'battle' || sq.state === 'moving' || sq.state === 'retreating') return fail('지금은 편성 불가');
        if (c.slot < 0 || c.slot >= SQUAD_SLOTS || sq.slots[c.slot]) return fail('빈 칸이 아님');
        const d = unitDef(c.unit);
        const cost = d.cost * RULES.goldPerCost;
        if (ps.gold < cost) return fail('군자금 부족');
        ps.gold -= cost;
        sq.slots[c.slot] = this.newUnit(p, d.id);
        if (sq.leader < 0) sq.leader = c.slot;
        return { ok: true };
      }
      case 'dismiss': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (!sq.loc.node || this.ownerOf(sq.loc.node) !== p || sq.state === 'battle') return fail('아군 거점에서만 가능');
        const u = sq.slots[c.slot]; if (!u) return fail('빈 칸');
        ps.gold += Math.floor(unitDef(u.def).cost * RULES.goldPerCost * 0.5);
        sq.slots[c.slot] = null;
        if (sq.leader === c.slot) sq.leader = sq.slots.findIndex((s) => s);
        return { ok: true };
      }
      case 'swap': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (!sq.loc.node || sq.state === 'battle' || sq.state === 'moving' || sq.state === 'retreating') return fail('거점에서만 편성 가능');
        if (c.from < 0 || c.to < 0 || c.from >= SQUAD_SLOTS || c.to >= SQUAD_SLOTS) return fail('잘못된 칸');
        const a = sq.slots[c.from]; sq.slots[c.from] = sq.slots[c.to]; sq.slots[c.to] = a;
        if (sq.leader === c.from) sq.leader = c.to; else if (sq.leader === c.to) sq.leader = c.from;
        return { ok: true };
      }
      case 'setLeader': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (!sq.slots[c.slot]) return fail('빈 칸');
        sq.leader = c.slot;
        return { ok: true };
      }
      case 'setTactics': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        const u = sq.slots[c.slot]; if (!u) return fail('빈 칸');
        const set = unitDef(u.def)[c.row];
        u.tactics[c.row] = c.tactics.filter((t) => set.skills.includes(t.skill)).slice(0, 6);
        return { ok: true };
      }
      case 'move': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (sq.state === 'battle' || sq.state === 'retreating') return fail('이동 불가 상태');
        if (sq.state === 'scattered') return fail('와해 상태: 재편성 필요');
        if (squadActive(sq).length === 0) return fail('가용 유닛 없음');
        if (!this.nodeById.has(c.target)) return fail('없는 거점');
        if (sq.loc.node) {
          const path = this.findPath(sq.loc.node, c.target);
          if (!path) return fail('경로 없음');
          sq.path = path;
          sq.captureT = 0;
          sq.state = path.length ? 'moving' : 'idle';
        } else {
          const e = sq.loc.edge!;
          const len = this.edgeLen(e.from, e.to);
          const viaTo = this.findPath(e.to, c.target);
          const viaFrom = this.findPath(e.from, c.target);
          const dTo = viaTo ? len - e.dist + this.pathLength(e.to, viaTo) : Infinity;
          const dFrom = viaFrom ? e.dist + this.pathLength(e.from, viaFrom) : Infinity;
          if (dTo === Infinity && dFrom === Infinity) return fail('경로 없음');
          if (dFrom < dTo) { sq.loc.edge = { from: e.to, to: e.from, dist: len - e.dist }; sq.path = [e.from, ...viaFrom!]; }
          else sq.path = [e.to, ...viaTo!];
          sq.state = 'moving';
        }
        return { ok: true };
      }
      case 'stop': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (sq.state !== 'moving') return fail('이동 중이 아님');
        if (sq.loc.node) { sq.path = []; sq.state = 'idle'; }
        else { const e = sq.loc.edge!; sq.path = [e.to]; }
        return { ok: true };
      }
      case 'reform': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (!sq.loc.node || this.ownerOf(sq.loc.node) !== p) return fail('아군 거점에서만 재편성 가능');
        if (sq.state !== 'scattered' && sq.state !== 'idle') return fail('재편성 불가 상태');
        for (const u of squadUnits(sq)) if (u.injured) { u.injured = false; u.hp = Math.max(1, Math.floor(unitDef(u.def).hp * 0.5)); }
        sq.state = 'idle';
        sq.path = [];
        return { ok: true };
      }
      case 'disband': {
        const sq = getSq(c.squad); if (!sq) return fail('부대 없음');
        if (sq.state === 'battle') return fail('전투 중');
        this.state.squads = this.state.squads.filter((s) => s !== sq);
        return { ok: true };
      }
    }
  }

  // ---------- tick ----------
  tick(dt = RULES.tick) {
    const st = this.state;
    if (st.winner) return;
    st.t += dt;
    this.income(dt);
    this.moveSquads(dt);
    this.resolveBattles();
    this.detectEncounters();
    this.capture(dt);
    this.regen(dt);
    this.objectives(dt);
  }

  private income(dt: number) {
    for (const p of PLAYERS) {
      let inc = RULES.incomeBase;
      for (const n of this.state.map.nodes) {
        if (this.ownerOf(n.id) !== p || n.type === 'home') continue;
        inc += n.type === 'supply' ? RULES.incomeSupply : RULES.incomeNode;
      }
      this.state.players[p].gold += inc * dt;
    }
  }
  incomeRate(p: PlayerId): number {
    let inc = RULES.incomeBase;
    for (const n of this.state.map.nodes) {
      if (this.ownerOf(n.id) !== p || n.type === 'home') continue;
      inc += n.type === 'supply' ? RULES.incomeSupply : RULES.incomeNode;
    }
    return inc;
  }

  private moveSquads(dt: number) {
    for (const sq of this.state.squads) {
      if (sq.cooldown > 0) sq.cooldown = Math.max(0, sq.cooldown - dt);
      if (sq.state !== 'moving' && sq.state !== 'retreating') continue;
      if (sq.path.length === 0 && sq.loc.node) { this.arrive(sq); continue; }
      let speed = this.squadSpeed(sq) * (sq.state === 'retreating' ? RULES.retreatSpeedMult : 1);
      if (speed <= 0) speed = 0.5;
      let budget = speed * dt;
      while (budget > 0) {
        if (sq.loc.node) {
          const next = sq.path[0];
          if (!next) { this.arrive(sq); break; }
          sq.loc = { edge: { from: sq.loc.node, to: next, dist: 0 } };
          this.prevEdgePos.set(sq.id, 0);
        }
        const e = sq.loc.edge!;
        const len = this.edgeLen(e.from, e.to);
        this.prevEdgePos.set(sq.id, e.dist);
        const step = Math.min(budget, len - e.dist);
        e.dist += step;
        budget -= step;
        if (e.dist >= len - 1e-9) {
          sq.loc = { node: e.to };
          if (sq.path[0] === e.to) sq.path.shift();
          this.prevEdgePos.delete(sq.id);
          if (sq.path.length === 0) { this.arrive(sq); break; }
          // stop at intermediate node if an enemy is there (encounter resolves next step)
          if (this.enemyReadyAt(sq.owner, e.to)) break;
        }
      }
    }
  }
  private arrive(sq: Squad) {
    sq.path = [];
    if (sq.state === 'retreating') { sq.state = 'scattered'; this.log(`${sq.name} 퇴각 완료 — 와해 상태, 재편성 필요`, 'info'); }
    else { sq.state = 'idle'; sq.captureT = 0; }
  }
  private enemyReadyAt(p: PlayerId, nodeId: string): boolean {
    return this.state.squads.some((s) => s.owner !== p && s.loc.node === nodeId && this.isCombatReady(s));
  }

  private detectEncounters() {
    const st = this.state;
    // node encounters
    for (const n of st.map.nodes) {
      const here = st.squads.filter((s) => s.loc.node === n.id);
      const a = here.find((s) => s.owner === 'P1' && this.isCombatReady(s));
      const b = here.find((s) => s.owner === 'P2' && this.isCombatReady(s));
      if (a && b) { this.startBattle(a, b, n.id, n.x, n.y); continue; }
      // routed squads caught by a ready enemy
      for (const s of here) {
        if ((s.state === 'scattered' || s.state === 'retreating') && this.enemyReadyAt(s.owner, n.id) && (s as any)._routedAt !== n.id) {
          (s as any)._routedAt = n.id;
          for (const u of squadActive(s)) { u.hp = Math.max(0, u.hp - Math.round(unitDef(u.def).hp * RULES.routedDamage)); if (u.hp === 0) u.injured = true; }
          this.log(`${s.name} 와해 중 추격당함!`, 'battle');
          if (s.state === 'scattered') { // flee further
            const to = this.nearestOwnedNode(s.owner, n.id, n.id);
            const path = this.findPath(n.id, to);
            if (path && path.length) { s.path = path; s.state = 'retreating'; }
          }
        }
      }
    }
    // edge encounters: opposing squads on the same edge that cross each other
    const onEdge = st.squads.filter((s) => s.loc.edge && this.isCombatReady(s));
    for (let i = 0; i < onEdge.length; i++) for (let j = i + 1; j < onEdge.length; j++) {
      const s1 = onEdge[i], s2 = onEdge[j];
      if (s1.owner === s2.owner || s1.state === 'battle' || s2.state === 'battle') continue;
      const e1 = s1.loc.edge!, e2 = s2.loc.edge!;
      const same = (e1.from === e2.from && e1.to === e2.to), opp = (e1.from === e2.to && e1.to === e2.from);
      if (!same && !opp) continue;
      const len = this.edgeLen(e1.from, e1.to);
      const p1 = e1.dist, p2 = opp ? len - e2.dist : e2.dist;
      const q1 = this.prevEdgePos.get(s1.id) ?? p1, q2raw = this.prevEdgePos.get(s2.id) ?? e2.dist;
      const q2 = opp ? len - q2raw : q2raw;
      const crossed = Math.sign(p1 - p2) !== Math.sign(q1 - q2) || Math.abs(p1 - p2) < 0.4;
      if (crossed) {
        const pos = this.squadPos(s1);
        const where = `${this.node(e1.from).name}~${this.node(e1.to).name}`;
        this.startBattle(s1.owner === 'P1' ? s1 : s2, s1.owner === 'P1' ? s2 : s1, where, pos.x, pos.y);
      }
    }
  }

  private startBattle(a: Squad, b: Squad, where: string, x: number, y: number) {
    const bonus = (sq: Squad) => {
      const nid = sq.loc.node;
      if (!nid) return 0;
      return this.node(nid).type === 'fort' && this.ownerOf(nid) === sq.owner ? RULES.fortMoraleBonus : 0;
    };
    const seed = hashSeed(this.state.seed, this.battleSeq++, a.id, b.id, Math.round(this.state.t * 10));
    const result = runBattle(
      { units: a.slots, leader: a.leader, moraleBonus: bonus(a) },
      { units: b.slots, leader: b.leader, moraleBonus: bonus(b) },
      seed,
    );
    const acts = result.events.filter((e) => e.t === 'act').length;
    const dur = Math.max(RULES.battleMinSeconds, acts * RULES.battleSecondsPerAction + 2);
    const id = `b${this.battleSeq}`;
    const nodeName = this.nodeById.get(where)?.name ?? where;
    this.state.battles.push({ id, squads: { A: a.id, B: b.id }, owners: { A: a.owner, B: b.owner }, result, startT: this.state.t, endT: this.state.t + dur, x, y, where: nodeName, applied: false });
    for (const s of [a, b]) { s.state = 'battle'; s.battleId = id; s.captureT = 0; }
    this.log(`${nodeName}에서 전투 발생: ${a.name} vs ${b.name}`, 'battle');
  }

  private resolveBattles() {
    for (const b of this.state.battles) {
      if (b.applied || this.state.t < b.endT) continue;
      b.applied = true;
      const a = this.squad(b.squads.A), bb = this.squad(b.squads.B);
      const apply = (sq: Squad | undefined, cs: typeof b.result.A, won: boolean, draw: boolean) => {
        if (!sq) return;
        for (const c of cs) {
          const u = squadUnits(sq).find((u) => u.uid === c.uid);
          if (!u) continue;
          u.hp = c.hp;
          if (!c.alive) { u.injured = true; u.hp = 0; }
        }
        sq.battleId = undefined;
        if (draw) { sq.state = sq.path.length ? 'moving' : 'idle'; sq.cooldown = RULES.drawCooldown; return; }
        if (won) { sq.state = sq.path.length ? 'moving' : 'idle'; return; }
        // loser: retreat to nearest owned node
        const fromNode = sq.loc.node ?? sq.loc.edge!.from;
        if (sq.loc.edge) { const e = sq.loc.edge; const len = this.edgeLen(e.from, e.to); sq.loc.edge = { from: e.to, to: e.from, dist: len - e.dist }; }
        const dest = this.nearestOwnedNode(sq.owner, fromNode, sq.loc.node && this.ownerOf(sq.loc.node) !== sq.owner ? sq.loc.node : undefined);
        const path = this.findPath(fromNode, dest) ?? [];
        sq.path = sq.loc.edge ? [fromNode, ...path] : path;
        sq.state = 'retreating';
        if (sq.path.length === 0) sq.state = 'scattered';
      };
      const w = b.result.winner;
      apply(a, b.result.A, w === 'A', w === 'draw');
      apply(bb, b.result.B, w === 'B', w === 'draw');
      const wname = w === 'draw' ? '무승부' : `${(w === 'A' ? a : bb)?.name} 승리`;
      this.log(`${b.where} 전투 종료 — ${wname} (사기 ${b.result.moraleA} : ${b.result.moraleB})`, 'battle');
    }
    // drop old battles from the list after a while
    this.state.battles = this.state.battles.filter((b) => !b.applied || this.state.t - b.endT < 60);
  }

  private capture(dt: number) {
    for (const sq of this.state.squads) {
      if (!sq.loc.node || (sq.state !== 'idle' && sq.state !== 'capturing')) continue;
      const n = this.node(sq.loc.node);
      const owner = this.ownerOf(n.id);
      if (owner === sq.owner) { if (sq.state === 'capturing') sq.state = 'idle'; continue; }
      if (n.type === 'home' && this.state.mode !== 'annihilation') continue;
      if (squadActive(sq).length === 0) continue;
      if (this.enemyReadyAt(sq.owner, n.id)) continue;
      sq.state = 'capturing';
      sq.captureT += dt;
      if (sq.captureT >= RULES.captureTime) {
        this.state.nodes[n.id].owner = sq.owner;
        sq.captureT = 0;
        sq.state = 'idle';
        this.log(`${sq.name}이(가) ${n.name} 점령`, 'capture');
        if (n.type === 'home') { this.state.winner = sq.owner; this.state.winReason = '적 본진 점령'; this.log(`${sq.owner} 승리: 본진 점령`, 'end'); }
      }
    }
  }

  private regen(dt: number) {
    for (const sq of this.state.squads) {
      if (!sq.loc.node || this.ownerOf(sq.loc.node) !== sq.owner) continue;
      if (sq.state !== 'idle' && sq.state !== 'scattered') continue;
      for (const u of squadUnits(sq)) if (!u.injured) u.hp = Math.min(unitDef(u.def).hp, u.hp + RULES.regenAtOwnedNode * dt);
    }
  }

  nodeCount(p: PlayerId): number { return Object.values(this.state.nodes).filter((n) => n.owner === p).length; }

  private objectives(dt: number) {
    const st = this.state;
    if (st.winner) return;
    const total = st.map.nodes.length;
    if (st.mode === 'domination') {
      for (const p of PLAYERS) {
        if (this.nodeCount(p) > total / 2) st.hold[p] += dt; else st.hold[p] = 0;
        if (st.hold[p] >= RULES.dominationHold) { st.winner = p; st.winReason = '거점 과반 유지'; this.log(`${p} 승리: 거점 과반 ${RULES.dominationHold}초 유지`, 'end'); return; }
      }
    } else if (st.mode === 'shrine') {
      const shrine = st.map.nodes.find((n) => n.type === 'shrine');
      if (shrine) {
        const o = this.ownerOf(shrine.id);
        if (o) st.hold[o] += dt;
        for (const p of PLAYERS) if (st.hold[p] >= RULES.shrineHold) { st.winner = p; st.winReason = '성소 보유 시간 달성'; this.log(`${p} 승리: 성소 점유 누적`, 'end'); return; }
      }
    }
    if (st.t >= RULES.matchLength) {
      const score = (p: PlayerId) => [this.nodeCount(p), st.squads.filter((s) => s.owner === p).reduce((a, s) => a + squadActive(s).length, 0), st.players[p].gold];
      const s1 = score('P1'), s2 = score('P2');
      let w: PlayerId | 'draw' = 'draw';
      for (let i = 0; i < 3; i++) { if (s1[i] !== s2[i]) { w = s1[i] > s2[i] ? 'P1' : 'P2'; break; } }
      st.winner = w; st.winReason = '시간 종료 타이브레이크';
      this.log(`시간 종료 — ${w === 'draw' ? '무승부' : w + ' 승리'}`, 'end');
    }
  }
}
