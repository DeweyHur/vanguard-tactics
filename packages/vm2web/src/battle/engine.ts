import { type Cell, key, neighbors, dist, W, H } from './hex';
import { RULES, elemAdv, lightAt, clockText } from './rules';

/** stats: [ATK, DEF, MAG, MDEF, SPD] per level (3 levels); light: 0 none, 1 day type, 2 night type */
export interface UnitDef { id: string; name: string; stats: number[][]; move: number; element: number; range: number; moveType: number; cost: number; upkeep: number; spell: number; light: number; master?: boolean }
export interface Unit {
  uid: number; side: 0 | 1; def: UnitDef; r: number; c: number; hp: number; level: number; exp: number;
  /** minutes until this unit's next action */ oa: number; facing: number; summonedAt: number;
  /** per-action state */ moved: number; acted: boolean;
}
export interface Terrain { terrain(r: number, c: number): number; height(r: number, c: number): number }
export interface BattleState {
  clock: number; active: number; units: Unit[]; mp: [number, number]; mpMax: [number, number]; stones: Record<number, -1 | 0 | 1>;
  log: string[]; winner: -1 | 0 | 1; nextUid: number; names: [string, string]; lastHour: number;
}

export function masterDef(name: string): UnitDef {
  const m = RULES.master; return { id: 'master', name, stats: m.stats.map((v) => [v, v, v]), move: m.move, element: 0, range: 1, moveType: 0, cost: 0, upkeep: 0, spell: 0, light: 0, master: true };
}
/** frame-group facing from a -> b, in DATA02 order: 0 W(9시), 1 NW(11시), 2 NE(1시), 3 E(3시), 4 SE(5시), 5 SW(7시) */
export function dirOf(a: Cell, b: Cell): number {
  const ax = a.c + (a.r & 1) * 0.5, bx = b.c + (b.r & 1) * 0.5; const dx = bx - ax, dy = b.r - a.r;
  if (dy === 0) return dx < 0 ? 0 : 3; if (dy < 0) return dx < 0 ? 1 : 2; return dx < 0 ? 5 : 4;
}

export class Battle {
  s: BattleState;
  /** cells walked by the last successful move(), start to destination (for the walk animation) */
  lastPath: Cell[] = [];
  constructor(public map: Terrain, public natials: UnitDef[], masters: [Cell, Cell], names: [string, string], startClock = RULES.startClock) {
    const mp = RULES.master.mpStart, mx = RULES.master.mpMax;
    this.s = { clock: startClock, active: 0, units: [], mp: [mp, mp], mpMax: [mx, mx], stones: {}, log: [], winner: -1, nextUid: 1, names, lastHour: Math.floor(startClock / 60) };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (RULES.stoneElement[map.terrain(r, c)] !== undefined) this.s.stones[key(r, c)] = -1;
    masters.forEach((p, i) => { const u = this.place(i as 0 | 1, masterDef(names[i]), p.r, p.c); u.oa = i; u.facing = i ? 1 : 4; });
    this.log(`${names[0]} vs ${names[1]} — ${clockText(this.s.clock)} 개시`);
    this.next();
  }
  log(m: string) { this.s.log.push(m); if (this.s.log.length > 300) this.s.log.shift(); }
  alive() { return this.s.units.filter((u) => u.hp > 0); }
  unitAt(r: number, c: number) { return this.s.units.find((u) => u.r === r && u.c === c && u.hp > 0); }
  unit(uid: number) { return this.s.units.find((u) => u.uid === uid); }
  master(side: 0 | 1) { return this.s.units.find((u) => u.side === side && u.def.master)!; }
  activeUnit(): Unit | null { return this.unit(this.s.active) ?? null; }
  light() { return lightAt(this.s.clock); }
  /** stat with level and daylight modifiers */
  stat(u: Unit, k: number) {
    let v = u.def.stats[k]?.[u.level - 1] ?? 0; const L = this.light();
    if (u.def.light === 1) v += L === 0 ? RULES.lightBonus : L === 2 ? -RULES.lightBonus : 0;
    if (u.def.light === 2) v += L === 2 ? RULES.lightBonus : L === 0 ? -RULES.lightBonus : 0;
    return Math.max(1, v);
  }
  private place(side: 0 | 1, def: UnitDef, r: number, c: number) {
    const u: Unit = { uid: this.s.nextUid++, side, def, r, c, hp: RULES.hp, level: 1, exp: 0, oa: 0, facing: side ? 1 : 4, summonedAt: this.s.clock, moved: 0, acted: false };
    this.s.units.push(u); this.claimStone(u); return u;
  }
  passCost(def: UnitDef, r: number, c: number) { return RULES.moveCost[this.map.terrain(r, c)]?.[def.moveType] ?? Infinity; }

  // ---------- timeline ----------
  /** advance the clock to the next unit's action; processes hourly MP; sets s.active */
  next() {
    if (this.s.winner >= 0) return;
    const alive = this.alive(); if (!alive.length) return;
    alive.sort((a, b) => a.oa - b.oa || this.stat(b, 4) - this.stat(a, 4) || a.uid - b.uid);
    const u = alive[0]; const dt = Math.max(0, u.oa);
    if (dt > 0) { for (const o of alive) o.oa -= dt; this.advanceClock(dt); if (this.s.winner >= 0) return; }
    if (u.hp <= 0) { this.next(); return; }
    this.s.active = u.uid; u.moved = 0; u.acted = false;
  }
  private advanceClock(dt: number) {
    this.s.clock += dt; const hour = Math.floor(this.s.clock / 60);
    while (this.s.lastHour < hour) { this.s.lastHour++; this.onTheHour(); }
  }
  /** 회복MP = (마정석개수 + 2) x 마스터마력 - 유지MP; natials are dismissed oldest-first when MP would go negative */
  private onTheHour() {
    for (const side of [0, 1] as const) {
      const m = this.master(side); if (m.hp <= 0) continue;
      const stones = Object.values(this.s.stones).filter((o) => o === side).length;
      const upkeep = this.alive().filter((u) => u.side === side && !u.def.master).reduce((a, u) => a + u.def.upkeep, 0);
      const gain = (stones + 2) * this.stat(m, 2) - upkeep;
      this.s.mp[side] = Math.min(this.s.mpMax[side], this.s.mp[side] + gain);
      this.log(`${clockText(this.s.lastHour * 60)} ${this.s.names[side]} MP ${gain >= 0 ? '+' : ''}${gain} (마법석 ${stones}, 유지 ${upkeep}) → ${Math.max(0, this.s.mp[side])}`);
      while (this.s.mp[side] < 0) {
        const nats = this.alive().filter((u) => u.side === side && !u.def.master).sort((a, b) => a.summonedAt - b.summonedAt);
        if (!nats.length) { this.s.mp[side] = 0; break; }
        const v = nats[0]; v.hp = 0; this.s.mp[side] += v.def.upkeep; this.log(`  MP 부족: ${v.def.name} 소멸`);
      }
      if (this.s.mp[side] < 0) this.s.mp[side] = 0;
    }
    if (this.s.lastHour % 24 === 0 || true) { /* light changes are read live from the clock */ }
  }
  private finishAction(u: Unit, extraOa: number) {
    u.oa = Math.max(RULES.oaMin, RULES.oaBase - this.stat(u, 4) * RULES.oaSpeedWeight) + u.moved * RULES.oaPerHex + extraOa;
    u.acted = true; this.next();
  }

  // ---------- queries ----------
  reachable(u: Unit) {
    if (u.moved) return new Map<number, { r: number; c: number; left: number; from: number }>();
    return reachableFrom(this.map, u.def, u.r, u.c, (r, c) => { const o = this.unitAt(r, c); return o ? (o.side === u.side ? 'friend' : 'enemy') : null; });
  }
  targetsFrom(u: Unit, r: number, c: number): Unit[] { return this.alive().filter((o) => o.side !== u.side && dist({ r, c }, o) <= u.def.range); }
  magicTargets(u: Unit): Unit[] { return u.def.spell ? this.alive().filter((o) => o.side !== u.side && dist(u, o) <= RULES.magicRange) : []; }
  summonCells(side: 0 | 1, def: UnitDef): Cell[] {
    const m = this.master(side); return neighbors(m.r, m.c).filter((n) => !this.unitAt(n.r, n.c) && this.passCost(def, n.r, n.c) !== Infinity);
  }
  summonCost(def: UnitDef) { return Math.ceil(def.cost / RULES.summonCostDiv); }
  /** deterministic damage preview */
  damage(a: Unit, d: Unit, magic = false): number {
    const atk = this.stat(a, magic ? 2 : 0), def = this.stat(d, magic ? 3 : 1);
    let dmg = atk - def + 1;
    dmg += elemAdv(a.def.element, d.def.element) * RULES.elemBonus;
    const rel = ((dirOf(d, a) - d.facing) % 6 + 6) % 6; // 0 = attacker right in front of the defender
    if (rel === 3) dmg += RULES.rearBonus; else if (rel === 2 || rel === 4) dmg += RULES.sideBonus;
    const dh = this.map.height(a.r, a.c) - this.map.height(d.r, d.c); if (dh > 0) dmg += RULES.heightBonus; else if (dh < 0) dmg -= RULES.heightBonus;
    dmg = Math.round(dmg * (1 - (RULES.terrainDef[this.map.terrain(d.r, d.c)] ?? 0) / 100));
    return Math.max(1, dmg);
  }

  // ---------- actions of the active unit (return error string or null) ----------
  private check(uid: number): Unit | string { const u = this.unit(uid); if (!u || u.hp <= 0) return '없는 유닛'; if (this.s.winner >= 0) return '게임 종료'; if (uid !== this.s.active) return `${this.activeUnit()?.def.name ?? '?'}의 차례입니다`; return u; }
  move(uid: number, r: number, c: number): string | null {
    const u = this.check(uid); if (typeof u === 'string') return u;
    if (u.moved) return '이미 이동했습니다';
    const rc = this.reachable(u); const cell = rc.get(key(r, c)); if (!cell) return '갈 수 없는 칸';
    const full = reachableFrom(this.map, u.def, u.r, u.c, (rr, cc) => { const o = this.unitAt(rr, cc); return o ? (o.side === u.side ? 'friend' : 'enemy') : null; }, true);
    const path: Cell[] = []; for (let k: number = key(r, c); k >= 0;) { const n = full.get(k); if (!n) break; path.unshift({ r: n.r, c: n.c }); k = n.from; }
    this.lastPath = path;
    u.facing = dirOf(u, { r, c }); u.moved = Math.max(1, u.def.move - cell.left); u.r = r; u.c = c; this.claimStone(u); return null;
  }
  attack(uid: number, targetUid: number): string | null {
    const u = this.check(uid); if (typeof u === 'string') return u; const t = this.unit(targetUid);
    if (!t || t.side === u.side || t.hp <= 0) return '대상이 아닙니다'; const d = dist(u, t); if (d > u.def.range) return '사정거리 밖';
    u.facing = dirOf(u, t); const dmg = this.damage(u, t); this.hit(u, t, dmg, false);
    this.finishAction(u, RULES.oaAttack + (d > 1 ? d * RULES.oaRangedPerHex : 0)); return null;
  }
  magic(uid: number, targetUid: number): string | null {
    const u = this.check(uid); if (typeof u === 'string') return u; const t = this.unit(targetUid);
    if (!u.def.spell) return '마법이 없습니다'; if (this.s.mp[u.side] < RULES.magicCost) return 'MP 부족';
    if (!t || t.side === u.side || t.hp <= 0) return '대상이 아닙니다'; if (dist(u, t) > RULES.magicRange) return '사정거리 밖';
    this.s.mp[u.side] -= RULES.magicCost; u.facing = dirOf(u, t); const dmg = this.damage(u, t, true); this.hit(u, t, dmg, true);
    this.finishAction(u, RULES.oaMagic); return null;
  }
  summon(natialIdx: number, r: number, c: number): string | null {
    const m = this.activeUnit(); if (!m || !m.def.master || this.s.winner >= 0) return '마스터의 차례가 아닙니다';
    const def = this.natials[natialIdx]; if (!def) return '없는 네이티얼'; const cost = this.summonCost(def);
    if (this.s.mp[m.side] < cost) return `MP 부족 (${cost} 필요)`;
    if (!this.summonCells(m.side, def).some((p) => p.r === r && p.c === c)) return '소환할 수 없는 칸';
    this.s.mp[m.side] -= cost; const u = this.place(m.side, def, r, c); u.oa = RULES.oaBase - this.stat(u, 4) * RULES.oaSpeedWeight; u.facing = m.facing;
    this.log(`${this.s.names[m.side]}: ${def.name} 소환 (MP -${cost})`); this.finishAction(m, RULES.oaSummon); return null;
  }
  wait(uid: number): string | null { const u = this.check(uid); if (typeof u === 'string') return u; this.finishAction(u, RULES.oaWait); return null; }

  private hit(a: Unit, t: Unit, dmg: number, magic: boolean) {
    t.hp = Math.max(0, t.hp - dmg); this.log(`${a.def.name} → ${t.def.name} ${dmg} 피해${magic ? ' (마법)' : ''}${t.hp === 0 ? ' (격파)' : ''}`);
    if (!a.def.master) { a.exp += dmg; const nl = RULES.levelExp.filter((x) => a.exp >= x).length; if (nl > a.level) { a.level = Math.min(3, nl); this.log(`  ${a.def.name} 레벨 ${a.level}!`); } }
    if (t.hp === 0 && t.def.master) { this.s.winner = a.side; this.log(`${this.s.names[a.side]} 승리!`); }
  }
  private claimStone(u: Unit) { const k = key(u.r, u.c); if (k in this.s.stones) this.s.stones[k] = u.side; }
  /** units in the order they will act (for the timeline display) */
  order(n = 8): { u: Unit; at: number }[] { return this.alive().sort((a, b) => a.oa - b.oa || this.stat(b, 4) - this.stat(a, 4) || a.uid - b.uid).slice(0, n).map((u) => ({ u, at: this.s.clock + Math.max(0, u.oa) })); }
}

/** movement search independent of battle state; `occupant` tells who stands on a cell */
export function reachableFrom(map: Terrain, def: UnitDef, r0: number, c0: number, occupant: (r: number, c: number) => 'friend' | 'enemy' | null, keepOccupied = false) {
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
  if (!keepOccupied) for (const [k, v] of best) if (k !== start && occupant(v.r, v.c)) best.delete(k);
  return best;
}
