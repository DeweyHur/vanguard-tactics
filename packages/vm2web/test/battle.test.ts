import { describe, it, expect } from 'vitest';
import { neighbors, dist } from '../src/battle/hex';
import { Battle, type UnitDef, type Terrain } from '../src/battle/engine';
import { botAct } from '../src/battle/bot';
import { RULES, elemAdv, lightAt } from '../src/battle/rules';

const flat: Terrain = { terrain: () => 0, height: () => 0 };
const nat = (id: string, element: number, o: Partial<UnitDef> = {}): UnitDef => ({ id, name: id, stats: [[6, 7, 8], [4, 5, 6], [5, 6, 7], [4, 4, 4], [10, 10, 10]], move: 4, element, range: 1, moveType: 0, cost: 400, upkeep: 2, spell: 0, light: 0, ...o });
const nats = [nat('earth', 1), nat('water', 2), nat('fire', 3), nat('sky', 4, { moveType: 4, range: 2, cost: 900, spell: 0x1f, light: 1 })];
const mk = (t: Terrain = flat) => new Battle(t, nats, [{ r: 10, c: 10 }, { r: 20, c: 20 }], ['A', 'B']);

describe('hex', () => {
  it('odd-r neighbours and distance', () => {
    expect(neighbors(2, 2).map((n) => `${n.r},${n.c}`).sort()).toEqual(['1,1', '1,2', '2,1', '2,3', '3,1', '3,2']);
    expect(neighbors(3, 2).map((n) => `${n.r},${n.c}`).sort()).toEqual(['2,2', '2,3', '3,1', '3,3', '4,2', '4,3']);
    for (const n of neighbors(5, 5)) expect(dist({ r: 5, c: 5 }, n)).toBe(1);
  });
});

describe('battle (OA timeline)', () => {
  it('starts with master A active, 10 HP everywhere, 7:00', () => {
    const b = mk(); expect(b.activeUnit()?.side).toBe(0); expect(b.master(0).hp).toBe(10); expect(b.s.clock).toBe(7 * 60); expect(lightAt(b.s.clock)).toBe(1);
  });
  it('summon costs cost/50 MP, only next to the active master; the natial acts before the master does again', () => {
    const b = mk(); const m = b.master(0);
    expect(b.summon(0, 10, 11)).toBeNull(); expect(b.s.mp[0]).toBe(60 - 8);
    expect(b.activeUnit()?.uid).toBe(b.master(1).uid); // master B had oa 1
    b.wait(m.uid === b.s.active ? m.uid : b.s.active); // B waits
    expect(b.activeUnit()?.def.id).toBe('earth'); // summoned natial (oa 50) comes before master A (oa 70-14+30)
  });
  it('OA grows with movement and ranged attacks; waiting is cheapest', () => {
    const base = RULES.oaBase - RULES.master.stats[4] * RULES.oaSpeedWeight;
    const b = mk(); const a = b.master(0); b.wait(a.uid); // A waited; B (oa 1) becomes active, clocks shift by 1
    expect(a.oa).toBe(base - 1);
    const b2 = mk(); const m = b2.master(0); b2.move(m.uid, 10, 13); b2.wait(m.uid);
    expect(m.oa).toBe(base - 1 + 3 * RULES.oaPerHex);
  });
  it('damage is deterministic: ATK - DEF + 1, element and facing bonuses', () => {
    const b = mk(); b.summon(0, 10, 11); b.wait(b.s.active); // B waits -> earth natial active
    const e = b.activeUnit()!; expect(e.def.id).toBe('earth');
    const w = b.s.units.find((u) => u.def.id === 'water') ?? (() => { const u = b.master(1); u.r = 10; u.c = 12; return u; })();
    w.facing = 0; // faces west, i.e. towards the attacker at (10,11): frontal
    expect(b.damage(e, w)).toBe(6 - 6 + 1 + 0); // master DEF 6, no element (master element 0)
    w.facing = 3; expect(b.damage(e, w)).toBe(1 + RULES.rearBonus);
    expect(elemAdv(1, 2)).toBe(1); expect(elemAdv(2, 1)).toBe(-1); expect(elemAdv(4, 1)).toBe(1);
  });
  it('hourly MP: (stones+2) x MAG - upkeep, natials dismissed oldest-first when MP runs out', () => {
    const stone: Terrain = { terrain: (r, c) => (r === 10 && c === 11 ? 12 : 0), height: () => 0 };
    const b = mk(stone); b.summon(0, 10, 11); // earth on the stone
    const mp0 = b.s.mp[0]; let guard = 0;
    while (b.s.clock < 8 * 60 && guard++ < 50) botAct(b);
    expect(b.s.clock).toBeGreaterThanOrEqual(8 * 60);
    expect(b.s.log.some((l) => l.includes('8:00 A MP +'))).toBe(true);
    expect(b.s.mp[0]).toBeGreaterThan(mp0 - 20); // regen (1+2)*7 - 2 = 19 capped at max
    const b2 = mk(); b2.summon(0, 10, 11); b2.s.mp[0] = -20; (b2 as unknown as { onTheHour: () => void }).onTheHour(); // +12 regen still leaves -8
    expect(b2.alive().filter((u) => u.def.id === 'earth').length).toBe(0);
  });
  it('master death ends the game; bots finish a game', () => {
    const b = mk(); const m = b.master(1); m.hp = 1; m.r = 10; m.c = 11;
    expect(b.attack(b.master(0).uid, m.uid)).toBeNull(); expect(b.s.winner).toBe(0);
    const g = new Battle(flat, nats, [{ r: 5, c: 5 }, { r: 25, c: 25 }], ['A', 'B']);
    for (let i = 0; i < 600 && g.s.winner < 0; i++) botAct(g);
    expect(g.s.winner).toBeGreaterThanOrEqual(0);
  });
});
