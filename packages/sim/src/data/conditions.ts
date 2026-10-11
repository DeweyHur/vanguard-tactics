import type { CondId } from '../types';

export interface CondInfo {
  id: CondId;
  name: string;
  /** target: filters/sorts candidate targets. situation: gates the tactic. */
  group: 'target' | 'situation' | 'self';
}

export const CONDITIONS: CondInfo[] = [
  { id: 'none', name: '(없음)', group: 'situation' },
  // target priority (sort, never empties)
  { id: 'prio_lowest_hp', name: '우선: HP 최저', group: 'target' },
  { id: 'prio_back_row', name: '우선: 후열', group: 'target' },
  { id: 'prio_front_row', name: '우선: 전열', group: 'target' },
  { id: 'prio_flying', name: '우선: 비행', group: 'target' },
  { id: 'prio_armored', name: '우선: 중장갑', group: 'target' },
  { id: 'prio_caster', name: '우선: 마법사', group: 'target' },
  { id: 'prio_cavalry', name: '우선: 기병', group: 'target' },
  { id: 'prio_leader', name: '우선: 리더', group: 'target' },
  { id: 'prio_guarding', name: '우선: 가드 중', group: 'target' },
  // target requirement (filter, may gate)
  { id: 'tgt_hp_lt_25', name: '대상 HP < 25%', group: 'target' },
  { id: 'tgt_hp_lt_50', name: '대상 HP < 50%', group: 'target' },
  { id: 'req_back_row', name: '대상: 후열만', group: 'target' },
  { id: 'req_front_row', name: '대상: 전열만', group: 'target' },
  { id: 'req_caster', name: '대상: 마법사만', group: 'target' },
  { id: 'req_flying', name: '대상: 비행만', group: 'target' },
  { id: 'req_armored', name: '대상: 중장갑만', group: 'target' },
  { id: 'req_leader', name: '대상: 리더만', group: 'target' },
  { id: 'req_not_guarding', name: '대상: 가드 안 함', group: 'target' },
  // self
  { id: 'self_hp_lt_50', name: '내 HP < 50%', group: 'self' },
  { id: 'self_in_front', name: '내가 전열', group: 'self' },
  { id: 'self_in_back', name: '내가 후열', group: 'self' },
  { id: 'self_displaced', name: '내가 밀려남', group: 'self' },
  { id: 'first_action', name: '내 첫 행동', group: 'self' },
  { id: 'last_action', name: '내 마지막 행동', group: 'self' },
  // situation
  { id: 'ally_hp_lt_50', name: '아군 HP<50% 있음', group: 'situation' },
  { id: 'ally_morale_lt_50', name: '아군 사기 < 50%', group: 'situation' },
  { id: 'enemy_morale_lt_50', name: '적 사기 < 50%', group: 'situation' },
  { id: 'enemies_ge_2', name: '적 2명 이상', group: 'situation' },
  { id: 'enemies_ge_4', name: '적 4명 이상', group: 'situation' },
  { id: 'enemy_front_empty', name: '적 전열 비었음', group: 'situation' },
  { id: 'ally_front_empty', name: '아군 전열 빈 칸', group: 'situation' },
  { id: 'battle_start', name: '전투 시작 직후', group: 'situation' },
  { id: 'outnumbered', name: '수적 열세', group: 'situation' },
];

export const COND_BY_ID: Record<string, CondInfo> = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));
