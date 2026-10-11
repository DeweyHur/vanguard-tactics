import type { Tactic, UnitDef, CondId } from '../types';

const T = (skill: string, cond1: CondId = 'none', cond2: CondId = 'none'): Tactic => ({ skill, cond1, cond2 });

const U = (u: UnitDef) => u;

export const UNITS: Record<string, UnitDef> = {
  infantry: U({
    id: 'infantry', name: 'Infantry', nameKo: '보병', cost: 1, hp: 60, atk: 14, def: 8, spd: 10, move: 10, color: '#c9a66b',
    tags: ['infantry'],
    front: { actions: 2, skills: ['slash', 'guard'], tactics: [T('slash', 'tgt_hp_lt_25'), T('guard', 'self_hp_lt_50', 'last_action'), T('slash')] },
    back: { actions: 1, skills: ['javelin'], tactics: [T('javelin', 'prio_lowest_hp')] },
  }),
  spear: U({
    id: 'spear', name: 'Spearman', nameKo: '창병', cost: 1, hp: 55, atk: 15, def: 7, spd: 11, move: 10, color: '#8fb7d9',
    tags: ['infantry'],
    front: { actions: 2, skills: ['thrust'], tactics: [T('thrust', 'prio_cavalry'), T('thrust')] },
    back: { actions: 1, skills: ['pike'], tactics: [T('pike', 'prio_cavalry', 'prio_back_row'), T('pike')] },
  }),
  archer: U({
    id: 'archer', name: 'Archer', nameKo: '궁수', cost: 1, hp: 42, atk: 15, def: 4, spd: 13, move: 10, color: '#7fbf7f',
    tags: ['ranged'],
    front: { actions: 1, skills: ['dagger'], tactics: [T('dagger')] },
    back: { actions: 2, skills: ['shoot', 'volley'], tactics: [T('shoot', 'prio_flying'), T('volley', 'enemies_ge_4'), T('shoot', 'prio_caster', 'prio_back_row')] },
  }),
  axe: U({
    id: 'axe', name: 'Axeman', nameKo: '도끼병', cost: 2, hp: 70, atk: 20, def: 9, spd: 8, move: 9, color: '#d97f5a',
    tags: ['infantry', 'armored'],
    front: { actions: 1, skills: ['smash'], tactics: [T('smash', 'prio_armored'), T('smash', 'prio_guarding')] },
    back: { actions: 0, skills: [], tactics: [] },
  }),
  shield: U({
    id: 'shield', name: 'Shieldbearer', nameKo: '방패병', cost: 2, hp: 85, atk: 10, def: 14, spd: 7, move: 8, color: '#a0a0b8',
    tags: ['infantry', 'armored'],
    front: { actions: 3, skills: ['guard', 'slash'], tactics: [T('guard'), T('slash')] },
    back: { actions: 1, skills: ['rally'], tactics: [T('rally', 'ally_morale_lt_50'), T('rally')] },
  }),
  healer: U({
    id: 'healer', name: 'Healer', nameKo: '치유사', cost: 2, hp: 40, atk: 8, def: 5, spd: 9, move: 10, color: '#f2e3a0',
    tags: ['support', 'caster'],
    front: { actions: 1, skills: ['firstaid', 'dagger'], tactics: [T('firstaid', 'ally_hp_lt_50'), T('dagger')] },
    back: { actions: 3, skills: ['heal', 'rally'], tactics: [T('heal', 'ally_hp_lt_50'), T('rally', 'ally_morale_lt_50'), T('heal')] },
  }),
  mage: U({
    id: 'mage', name: 'Mage', nameKo: '마법사', cost: 2, hp: 38, atk: 22, def: 3, spd: 9, move: 9, color: '#b48ae0',
    tags: ['caster', 'ranged'],
    front: { actions: 1, skills: ['firebolt'], tactics: [T('firebolt', 'prio_lowest_hp')] },
    back: { actions: 1, skills: ['fireball', 'firebolt'], tactics: [T('fireball', 'enemies_ge_2'), T('firebolt', 'prio_armored')] },
  }),
  cavalry: U({
    id: 'cavalry', name: 'Light Cavalry', nameKo: '경기병', cost: 3, hp: 62, atk: 19, def: 7, spd: 15, move: 15, color: '#e0c060',
    tags: ['cavalry'],
    front: { actions: 1, skills: ['breach', 'slash'], tactics: [T('breach', 'prio_caster', 'prio_back_row'), T('breach')] },
    back: { actions: 1, skills: ['mounted_shot'], tactics: [T('mounted_shot', 'prio_lowest_hp')] },
  }),
  hooker: U({
    id: 'hooker', name: 'Chainman', nameKo: '쇠사슬병', cost: 3, hp: 64, atk: 16, def: 9, spd: 9, move: 9, color: '#7a8f9a',
    tags: ['infantry'],
    front: { actions: 2, skills: ['hook', 'slash'], tactics: [T('hook', 'prio_caster', 'first_action'), T('hook', 'first_action'), T('slash', 'prio_lowest_hp')] },
    back: { actions: 1, skills: ['throw_'], tactics: [T('throw_', 'prio_lowest_hp')] },
  }),
  giant: U({
    id: 'giant', name: 'Giant', nameKo: '거인', cost: 4, hp: 120, atk: 24, def: 11, spd: 5, move: 7, color: '#9a6b4a',
    tags: ['armored'],
    front: { actions: 2, skills: ['shove', 'slam'], tactics: [T('shove', 'prio_leader', 'first_action'), T('shove', 'first_action'), T('slam')] },
    back: { actions: 0, skills: [], tactics: [] },
  }),
  herald: U({
    id: 'herald', name: 'Herald', nameKo: '전령', cost: 2, hp: 45, atk: 9, def: 6, spd: 12, move: 11, color: '#f0a0c0',
    tags: ['support'],
    front: { actions: 0, skills: [], tactics: [] },
    back: { actions: 2, skills: ['rally_big'], tactics: [T('rally_big', 'ally_morale_lt_50'), T('rally_big')] },
  }),
  wagon: U({
    id: 'wagon', name: 'Wagon', nameKo: '수송차', cost: 1, hp: 90, atk: 0, def: 6, spd: 1, move: 8, color: '#bbbbbb',
    tags: ['transport'],
    front: { actions: 0, skills: [], tactics: [] },
    back: { actions: 0, skills: [], tactics: [] },
  }),
};

export const UNIT_IDS = Object.keys(UNITS);

export function unitDef(id: string): UnitDef {
  const u = UNITS[id];
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
}
