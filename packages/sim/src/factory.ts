import { unitDef } from './data/units';
import type { UnitInstance, Squad, PlayerId } from './types';
import { SQUAD_SLOTS } from './types';

let _uid = 0;
export function resetUidCounter(n = 0) { _uid = n; }

export function makeUnit(def: string, uid?: string): UnitInstance {
  const d = unitDef(def);
  return { uid: uid ?? `u${++_uid}`, def: d.id, hp: d.hp, injured: false, tactics: { front: [], back: [] } };
}

/** Build a squad slot array from a compact layout: [front0, front1, front2, back0, back1, back2] of def ids or null. */
export function layout(defs: (string | null)[]): (UnitInstance | null)[] {
  const out: (UnitInstance | null)[] = [];
  for (let i = 0; i < SQUAD_SLOTS; i++) out.push(defs[i] ? makeUnit(defs[i]!) : null);
  return out;
}

export function makeSquad(id: string, owner: PlayerId, node: string, defs: (string | null)[] = [], name?: string): Squad {
  const slots = layout(defs);
  const leader = slots.findIndex((s) => s);
  return { id, owner, name: name ?? id, slots, leader, state: 'idle', loc: { node }, path: [], captureT: 0, cooldown: 0 };
}

export function squadUnits(sq: Squad): UnitInstance[] {
  return sq.slots.filter((s): s is UnitInstance => !!s);
}
export function squadActive(sq: Squad): UnitInstance[] {
  return squadUnits(sq).filter((u) => !u.injured);
}
