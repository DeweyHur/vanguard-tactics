import { unitDef, type Tactic } from '@vt/sim';
import type { TacticSets } from './tacticsEditor';

/** A saved squad layout: units per slot (0-2 front, 3-5 back) + optional per-slot tactic overrides. */
export interface SquadPreset {
  id: string;
  name: string;
  desc?: string;
  slots: (string | null)[];
  leader: number;
  tactics: Record<number, TacticSets>;
  builtin?: boolean;
}

/** cost points allowed for the squad you start the match with */
export const START_BUDGET = 6;
const KEY = 'vt.presets.v1';

const T = (skill: string, cond1: Tactic['cond1'] = 'none', cond2: Tactic['cond2'] = 'none'): Tactic => ({ skill, cond1, cond2 });

export const BUILTIN_PRESETS: SquadPreset[] = [
  {
    id: 'b_balanced', name: '균형', builtin: true, desc: '보병 벽 + 궁수 화력. 시작 부대 기본값.',
    slots: ['infantry', 'spear', 'infantry', 'archer', null, 'archer'], leader: 1, tactics: {},
  },
  {
    id: 'b_wall', name: '방패벽', builtin: true, desc: '방패병이 가드로 사기를 깎고, 후열이 치유와 사격을 맡는다.',
    slots: ['shield', 'infantry', 'shield', 'archer', 'healer', 'archer'], leader: 1,
    tactics: { 0: { front: [T('guard', 'first_action'), T('slash', 'tgt_hp_lt_25'), T('guard')], back: [] }, 2: { front: [T('guard', 'first_action'), T('slash', 'tgt_hp_lt_25'), T('guard')], back: [] } },
  },
  {
    id: 'b_firepower', name: '화력', builtin: true, desc: '마법사·궁수 후열에 몰빵. 전열이 무너지면 위험.',
    slots: ['infantry', 'spear', 'infantry', 'mage', 'archer', 'mage'], leader: 1,
    tactics: { 3: { front: [], back: [T('fireball', 'enemies_ge_2'), T('firebolt', 'prio_lowest_hp')] }, 5: { front: [], back: [T('fireball', 'enemies_ge_2'), T('firebolt', 'prio_armored')] } },
  },
  {
    id: 'b_breaker', name: '진열 파괴', builtin: true, desc: '쇠사슬병이 후열 마법사를 끌어내고 경기병이 돌파한다. 고비용.',
    slots: ['hooker', 'shield', 'cavalry', 'archer', 'healer', 'mage'], leader: 0,
    tactics: { 0: { front: [T('hook', 'prio_caster', 'first_action'), T('hook', 'prio_leader'), T('slash', 'prio_lowest_hp')], back: [] }, 2: { front: [T('breach', 'prio_caster'), T('breach', 'prio_back_row')], back: [] } },
  },
  {
    id: 'b_siege', name: '거인 공성', builtin: true, desc: '거인이 리더를 후열로 밀어넣고 전열을 쓸어버린다. 전령으로 사기 유지.',
    slots: ['giant', 'shield', 'spear', 'healer', 'herald', 'archer'], leader: 0,
    tactics: { 0: { front: [T('shove', 'prio_leader', 'first_action'), T('shove', 'first_action'), T('slam')], back: [] } },
  },
];

export function presetCost(p: SquadPreset): number {
  return p.slots.reduce((a, s) => a + (s ? unitDef(s).cost : 0), 0);
}
export function presetGold(p: SquadPreset): number { return presetCost(p) * 10; }

export function loadUserPresets(): SquadPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p) => p && Array.isArray(p.slots) && p.slots.length === 6) : [];
  } catch { return []; }
}
export function saveUserPresets(list: SquadPreset[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable: presets stay in memory */ }
}
export function allPresets(user = loadUserPresets()): SquadPreset[] { return [...BUILTIN_PRESETS, ...user]; }

export function clonePreset(p: SquadPreset, name?: string): SquadPreset {
  return { ...JSON.parse(JSON.stringify(p)), id: `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`, name: name ?? `${p.name} 복사본`, builtin: false };
}
export function emptyPreset(): SquadPreset {
  return { id: `u_${Date.now().toString(36)}`, name: '새 프리셋', slots: [null, null, null, null, null, null], leader: -1, tactics: {} };
}
