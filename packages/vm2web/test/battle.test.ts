import { describe, it, expect } from 'vitest';
import { neighbors, dist } from '../src/battle/hex';
import { Battle, type UnitDef, type Terrain } from '../src/battle/engine';
import { botTurn } from '../src/battle/bot';
import { RULES, elemMult } from '../src/battle/rules';

const flat: Terrain = { terrain: () => 0, height: () => 0 };
const nat = (id: string, element: number, moveType = 0, range = 1, cost = 400): UnitDef => ({ id, name: id, hp: 50, stats: [[20, 22, 24], [10, 11, 12], [0, 0, 0], [0, 0, 0], [0, 0, 0]], move: 4, element, range, moveType, cost });
const nats = [nat('earth', 1), nat('water', 2), nat('fire', 3), nat('sky', 4, 4, 2, 900)];

describe('hex', () => {
  it('odd-r neighbors and distance', () => {
    expect(neighbors(2, 2).map((n) => `${n.r},${n.c}`).sort()).toEqual(['1,1', '1,2', '2,1', '2,3', '3,1', '3,2']);
    expect(neighbors(3, 2).map((n) => `${n.r},${n.c}`).sort()).toEqual(['2,2', '2,3', '3,1', '3,3', '4,2', '4,3']);
    expect(dist({ r: 0, c: 0 }, { r: 0, c: 3 })).toBe(3);
    expect(dist({ r: 0, c: 0 }, { r: 3, c: 1 })).toBe(3);
    for (const n of neighbors(5, 5)) expect(dist({ r: 5, c: 5 }, n)).toBe(1);
  });
});

describe('battle', () => {
  it('summon costs MP and only next to the master', () => {
    const b = new Battle(flat, nats, [{ r: 10, c: 10 }, { r: 20, c: 20 }], ['A', 'B']); b.s.mp[0] = 1000;
    expect(b.summon(0, 10, 11)).toBeNull(); expect(b.s.mp[0]).toBe(600);
    expect(b.summon(0, 10, 11)).toMatch(/소환할 수 없는/);
    expect(b.summon(0, 15, 15)).toMatch(/소환할 수 없는/);
    expect(b.s.units.length).toBe(3);
  });
  it('movement respects move points, terrain and ZOC', () => {
    const b = new Battle(flat, nats, [{ r: 10, c: 10 }, { r: 10, c: 16 }], ['A', 'B']);
    b.summon(0, 10, 11); b.endTurn(); b.endTurn(); // natial can act next own turn
    const u = b.s.units[2]; const rc = b.reachable(u);
    expect(rc.size).toBeGreaterThan(20);
    for (const c of rc.values()) expect(dist(u, c)).toBeLessThanOrEqual(4);
    expect(rc.has(10 * 32 + 15)).toBe(true); // adjacent to enemy master: reachable but ZOC stops there
    expect(b.move(u.uid, 10, 15)).toBeNull(); expect(b.move(u.uid, 10, 14)).toMatch(/이미/);
    const deep: Terrain = { terrain: (r, c) => (c === 13 ? 9 : 0), height: () => 0 };
    const b2 = new Battle(deep, nats, [{ r: 10, c: 10 }, { r: 10, c: 20 }], ['A', 'B']);
    b2.summon(0, 10, 11); b2.endTurn(); b2.endTurn();
    expect(b2.reachable(b2.s.units[2]).has(10 * 32 + 14)).toBe(false); // walker blocked by deep water column
  });
  it('element advantage and counterattack', () => {
    expect(elemMult(1, 2)).toBe(RULES.elemAdv); expect(elemMult(2, 1)).toBe(RULES.elemDis); expect(elemMult(4, 1)).toBe(RULES.elemAdv);
    const b = new Battle(flat, nats, [{ r: 0, c: 0 }, { r: 20, c: 20 }], ['A', 'B']);
    b.summon(0, 0, 1); b.endTurn(); b.summon(1, 20, 21); b.endTurn();
    const e = b.s.units[2], w = b.s.units[3]; w.r = 0; w.c = 2; // put water natial next to earth natial
    expect(b.damage(e, w)).toBe(Math.round((20 - 5) * RULES.elemAdv));
    expect(b.attack(e.uid, w.uid)).toBeNull();
    expect(w.hp).toBe(50 - 23); expect(e.hp).toBeLessThan(50); expect(e.acted).toBe(true);
  });
  it('killing the master ends the game; stones regen MP', () => {
    const stone: Terrain = { terrain: (r, c) => (r === 0 && c === 1 ? 12 : 0), height: () => 0 };
    const b = new Battle(stone, nats, [{ r: 0, c: 0 }, { r: 0, c: 2 }], ['A', 'B']);
    expect(b.s.stones[1]).toBe(-1); b.summon(0, 0, 1); expect(b.s.stones[1]).toBe(0);
    b.endTurn(); b.endTurn(); expect(b.s.mp[0]).toBe(RULES.mpStart - 400 + RULES.mpRegen + RULES.mpPerStone);
    const m = b.master(1); m.hp = 1; expect(b.attack(b.s.units[2].uid, m.uid)).toBeNull();
    expect(b.s.winner).toBe(0); expect(b.endTurn()).toBeUndefined(); expect(b.s.side).toBe(0);
  });
  it('bot plays a full game to a result', () => {
    const b = new Battle(flat, nats, [{ r: 5, c: 5 }, { r: 25, c: 25 }], ['A', 'B']);
    for (let i = 0; i < 200 && b.s.winner < 0; i++) botTurn(b);
    expect(b.s.winner).toBeGreaterThanOrEqual(0);
    expect(b.s.turn).toBeLessThan(100);
  });
});
