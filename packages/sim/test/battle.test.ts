import { describe, it, expect, beforeEach } from 'vitest';
import { runBattle } from '../src/battle';
import { layout, resetUidCounter } from '../src/factory';
import type { BattleSideInput, Combatant } from '../src/types';

const side = (defs: (string | null)[], bonus = 0, leader = 0): BattleSideInput => ({ units: layout(defs), leader, moraleBonus: bonus });

beforeEach(() => resetUidCounter());

describe('runBattle', () => {
  it('is deterministic for the same seed', () => {
    const a = () => side(['infantry', 'spear', 'infantry', 'archer', 'healer', 'archer']);
    const b = () => side(['shield', 'axe', 'infantry', 'mage', 'archer', null]);
    resetUidCounter();
    const r1 = runBattle(a(), b(), 1234);
    resetUidCounter();
    const r2 = runBattle(a(), b(), 1234);
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    const r3 = runBattle(a(), b(), 99);
    expect(JSON.stringify(r3.events)).not.toEqual(JSON.stringify(r1.events));
  });

  it('ends with a winner decided by morale, not damage', () => {
    const r = runBattle(side(['infantry', 'infantry', 'infantry', null, null, null]), side(['infantry', null, null, null, null, null]), 7);
    expect(r.events[0].t).toBe('start');
    expect(r.events.at(-1)!.t).toBe('end');
    expect(['A', 'B', 'draw']).toContain(r.winner);
    if (r.winner !== 'draw') expect(r.winner === 'A' ? r.moraleA > r.moraleB : r.moraleB > r.moraleA).toBe(true);
  });

  it('uses the back-row action set for back-row units (archer shoots twice from back)', () => {
    const r = runBattle(side([null, null, null, 'archer', null, null]), side(['shield', null, null, null, null, null]), 3);
    const acts = r.events.filter((e) => e.t === 'act' && e.side === 'A');
    expect(acts.length).toBe(2);
    expect(acts.every((e) => e.t === 'act' && (e.skill === 'shoot' || e.skill === 'volley'))).toBe(true);
  });

  it('melee attacks cannot reach back row while front row is alive', () => {
    const r = runBattle(side(['infantry', null, null, null, null, null]), side(['shield', null, null, 'mage', null, null]), 5);
    const hitsOnMage = r.events.filter((e) => e.t === 'hit' && e.side === 'B' && e.slot === 3);
    expect(hitsOnMage.length).toBe(0);
  });

  it('hook pulls a back-row unit to the front and switches its action set', () => {
    // A: chainman alone, fast. B: archer in back only -> hook must pull archer to front
    const r = runBattle(side(['hooker', null, null, null, null, null]), side([null, null, null, 'archer', null, null]), 11);
    const move = r.events.find((e) => e.t === 'move' && e.side === 'B');
    expect(move).toBeDefined();
    if (move && move.t === 'move') {
      expect(move.row).toBe('front');
      expect(move.toSlot).toBe(0);
    }
    const archer = r.B.find((c) => c.def === 'archer')!;
    expect(archer.row).toBe('front');
    expect(archer.skills).toEqual(['dagger']);
    expect(r.events.some((e) => e.t === 'morale' && e.side === 'B' && e.why === 'displaced')).toBe(true);
  });

  it('giant in back row has zero actions', () => {
    const r = runBattle(side([null, null, null, 'giant', null, null]), side(['infantry', null, null, null, null, null]), 2);
    expect(r.events.filter((e) => e.t === 'act' && e.side === 'A').length).toBe(0);
  });

  it('player tactics override defaults', () => {
    const a = side(['infantry', null, null, null, null, null]);
    a.units[0]!.tactics.front = [{ skill: 'guard', cond1: 'none', cond2: 'none' }];
    const r = runBattle(a, side(['infantry', null, null, null, null, null]), 2);
    const acts = r.events.filter((e) => e.t === 'act' && e.side === 'A');
    expect(acts.every((e) => e.t === 'act' && e.skill === 'guard')).toBe(true);
  });

  it('fortress morale bonus raises starting morale', () => {
    const r = runBattle(side(['infantry', null, null, null, null, null], 15), side(['infantry', null, null, null, null, null]), 2);
    const s = r.events[0];
    expect(s.t === 'start' && s.moraleA).toBe(115);
  });
});
