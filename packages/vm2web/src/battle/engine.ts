import { type Cell, key, neighbors, dist, W, H } from './hex';
import { RULES, elemMult } from './rules';

export interface UnitDef { id: string; name: string; hp: number; stats: number[][]; move: number; element: number; range: number; moveType: number; cost: number; master?: boolean }
export interface Unit { uid: number; side: 0 | 1; def: UnitDef; r: number; c: number; hp: number; level: number; kills: number; moved: boolean; acted: boolean }
export interface Terrain { terrain(r: number, c: number): number; height(r: number, c: number): number }
export interface BattleState {
  turn: number; side: 0 | 1; units: Unit[]; mp: [number, number]; stones: Record<number, -1 | 0 | 1>;
  log: string[]; winner: -1 | 0 | 1; nextUid: number; names: [string, string];
}

export function masterDef(name: string): UnitDef {
  return { id: 'master', name, hp: RULES.masterHp, stats: [[RULES.masterAtk, RULES.masterAtk, RULES.masterAtk], [RULES.masterDef, RULES.masterDef, RULES.masterDef]], move: RULES.masterMove, element: 0, range: 1, moveType: 0, cost: 0, master: true };
}

export class Battle {
  s: BattleState;
  constructor(public map: Terrain, public natials: UnitDef[], masters: [Cell, Cell], names: [string, string]) {
    this.s = { turn: 1, side: 0, units: [], mp: [RULES.mpStart, RULES.mpStart], stones: {}, log: [], winner: -1, nextUid: 1, names };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (RULES.stoneElement[map.terrain(r, c)] !== undefined) this.s.stones[key(r, c)] = -1;
    masters.forEach((p, i) => this.place(i as 0 | 1, masterDef(names[i]), p.r, p.c, false));
    this.log(`${names[0]} vs ${names[1]} — 턴 1, ${names[0]} 차례`);
  }
  log(m: string) { this.s.log.push(m); if (this.s.log.length > 200) this.s.log.shift(); }
  unitAt(r: number, c: number) { return this.s.units.find((u) => u.r === r && u.c === c && u.hp > 0); }
  unit(uid: number) { return this.s.units.find((u) => u.uid === uid); }
  master(side: 0 | 1) { return this.s.units.find((u) => u.side === side && u.def.master)!; }
  stat(u: Unit, k: number) { return u.def.stats[k]?.[u.level - 1] ?? 0; }
  private place(side: 0 | 1, def: UnitDef, r: number, c: number, spent: boolean) {
    const u: Unit = { uid: this.s.nextUid++, side, def, r, c, hp: def.hp, level: 1, kills: 0, moved: spent, acted: spent };
    this.s.units.push(u); return u;
  }
  passCost(def: UnitDef, r: number, c: number) { return RULES.moveCost[this.map.terrain(r, c)]?.[def.moveType] ?? Infinity; }

  /** reachable cells with remaining move points (Dijkstra); ZOC stops movement next to enemies (flyers ignore) */
  reachable(u: Unit) {
    return reachableFrom(this.map, u.def, u.r, u.c, (r, c) => { const o = this.unitAt(r, c); return o ? (o.side === u.side ? 'friend' : 'enemy') : null; });
  }
  targetsFrom(u: Unit, r: number, c: number): Unit[] {
    return this.s.units.filter((o) => o.hp > 0 && o.side !== u.side && dist({ r, c }, o) <= u.def.range);
  }
  summonCells(side: 0 | 1, def: UnitDef): Cell[] {
    const m = this.master(side);
    return neighbors(m.r, m.c).filter((n) => !this.unitAt(n.r, n.c) && this.passCost(def, n.r, n.c) !== Infinity);
  }
  damage(a: Unit, d: Unit): number {
    let atk = this.stat(a, 0); const def = this.stat(d, 1);
    const st = RULES.stoneElement[this.map.terrain(a.r, a.c)]; if (st !== undefined && st === a.def.element) atk *= RULES.stoneBoost;
    let mult = elemMult(a.def.element, d.def.element);
    const dh = this.map.height(a.r, a.c) - this.map.height(d.r, d.c); if (dh > 0) mult += RULES.heightBonus; else if (dh < 0) mult -= RULES.heightBonus;
    const tdef = (RULES.terrainDef[this.map.terrain(d.r, d.c)] ?? 0) / 100;
    return Math.max(1, Math.round((atk - def * 0.5) * mult * (1 - tdef)));
  }

  // ---- actions (return error string or null) ----
  move(uid: number, r: number, c: number): string | null {
    const u = this.unit(uid); if (!u || u.side !== this.s.side || this.s.winner >= 0) return '차례가 아닙니다';
    if (u.moved) return '이미 이동했습니다';
    const rc = this.reachable(u); if (!rc.has(key(r, c))) return '갈 수 없는 칸';
    u.r = r; u.c = c; u.moved = true; this.claimStone(u); return null;
  }
  attack(uid: number, targetUid: number): string | null {
    const u = this.unit(uid), t = this.unit(targetUid);
    if (!u || !t || u.side !== this.s.side || this.s.winner >= 0) return '차례가 아닙니다';
    if (u.acted) return '이미 행동했습니다'; if (t.side === u.side || t.hp <= 0) return '대상이 아닙니다';
    if (dist(u, t) > u.def.range) return '사정거리 밖';
    const dmg = this.damage(u, t); t.hp = Math.max(0, t.hp - dmg); this.log(`${u.def.name} → ${t.def.name} ${dmg} 피해${t.hp === 0 ? ' (격파)' : ''}`);
    if (t.hp === 0) this.onKill(u, t);
    else if (dist(t, u) <= t.def.range) { const back = Math.max(1, Math.round(this.damage(t, u) * RULES.counterMult)); u.hp = Math.max(0, u.hp - back); this.log(`  반격 ${back} 피해${u.hp === 0 ? ' (격파)' : ''}`); if (u.hp === 0) this.onKill(t, u); }
    u.moved = u.acted = true; return null;
  }
  summon(natialIdx: number, r: number, c: number): string | null {
    const side = this.s.side; const def = this.natials[natialIdx]; if (!def || this.s.winner >= 0) return '없는 네이티얼';
    if (this.s.mp[side] < def.cost) return 'MP 부족';
    if (!this.summonCells(side, def).some((p) => p.r === r && p.c === c)) return '소환할 수 없는 칸';
    this.s.mp[side] -= def.cost; const u = this.place(side, def, r, c, true); this.claimStone(u); this.log(`${this.s.names[side]}: ${def.name} 소환 (MP -${def.cost})`); return null;
  }
  endTurn() {
    if (this.s.winner >= 0) return;
    this.s.side = (1 - this.s.side) as 0 | 1; if (this.s.side === 0) this.s.turn++;
    const side = this.s.side; const stones = Object.values(this.s.stones).filter((o) => o === side).length;
    this.s.mp[side] = Math.min(RULES.mpMax, this.s.mp[side] + RULES.mpRegen + RULES.mpPerStone * stones);
    for (const u of this.s.units) if (u.side === side) u.moved = u.acted = false;
    this.log(`턴 ${this.s.turn}, ${this.s.names[side]} 차례 (MP ${this.s.mp[side]}, 마법석 ${stones})`);
  }
  private claimStone(u: Unit) { const k = key(u.r, u.c); if (k in this.s.stones) this.s.stones[k] = u.side; }
  private onKill(killer: Unit, dead: Unit) {
    if (dead.def.master) { this.s.winner = killer.side; this.log(`${this.s.names[killer.side]} 승리!`); return; }
    killer.kills++; const nl = RULES.levelKills.filter((k) => killer.kills >= k).length;
    if (nl > killer.level && !killer.def.master) { killer.level = Math.min(3, nl); killer.hp = Math.min(killer.def.hp, killer.hp + 10); this.log(`  ${killer.def.name} 레벨 ${killer.level}!`); }
  }
}

/** movement search independent of battle state; `occupant` tells who stands on a cell */
export function reachableFrom(map: Terrain, def: UnitDef, r0: number, c0: number, occupant: (r: number, c: number) => 'friend' | 'enemy' | null) {
  const best = new Map<number, { r: number; c: number; left: number; from: number }>();
  const start = key(r0, c0); best.set(start, { r: r0, c: c0, left: def.move, from: -1 });
  const open = [start]; const zoc = def.moveType !== RULES.zocIgnoreMoveType;
  const enemyAdjacent = (r: number, c: number) => neighbors(r, c).some((n) => occupant(n.r, n.c) === 'enemy');
  const cost = (r: number, c: number) => RULES.moveCost[map.terrain(r, c)]?.[def.moveType] ?? Infinity;
  while (open.length) {
    open.sort((a, b) => best.get(b)!.left - best.get(a)!.left); const k = open.shift()!; const cur = best.get(k)!;
    if (cur.left <= 0) continue;
    if (zoc && k !== start && enemyAdjacent(cur.r, cur.c)) continue;
    for (const n of neighbors(cur.r, cur.c)) {
      if (occupant(n.r, n.c) === 'enemy') continue;
      let cst = cost(n.r, n.c); if (cst === Infinity) continue;
      const dh = map.height(n.r, n.c) - map.height(cur.r, cur.c);
      if (def.moveType !== 4) { if (dh > RULES.maxClimb) continue; if (dh > 0) cst += dh - 1; }
      const left = cur.left - cst; if (left < 0) continue;
      const nk = key(n.r, n.c); const prev = best.get(nk);
      if (!prev || prev.left < left) { best.set(nk, { r: n.r, c: n.c, left, from: k }); open.push(nk); }
    }
  }
  for (const [k, v] of best) if (k !== start && occupant(v.r, v.c)) best.delete(k); // can't stop on a friend
  return best;
}
