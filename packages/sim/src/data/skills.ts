import type { SkillDef } from '../types';

const S = (s: SkillDef) => s;

export const SKILLS: Record<string, SkillDef> = {
  // --- basic melee ---
  slash: S({ id: 'slash', name: '베기', kind: 'attack', shape: 'single', potency: 100, hits: 1, reach: 'melee', desc: '단일 근접 공격.' }),
  thrust: S({ id: 'thrust', name: '찌르기', kind: 'attack', shape: 'single', potency: 95, hits: 1, reach: 'melee', bonusVs: { tag: 'cavalry', mult: 1.8 }, desc: '단일 근접. 기병에 강함.' }),
  dagger: S({ id: 'dagger', name: '단검', kind: 'attack', shape: 'single', potency: 60, hits: 1, reach: 'melee', desc: '약한 근접 공격.' }),
  smash: S({ id: 'smash', name: '강타', kind: 'attack', shape: 'single', potency: 150, hits: 1, reach: 'melee', ignoreGuard: true, bonusVs: { tag: 'armored', mult: 1.5 }, desc: '가드 무시. 중장갑에 강함.' }),
  slam: S({ id: 'slam', name: '내려치기', kind: 'attack', shape: 'row', potency: 90, hits: 1, reach: 'melee', moraleBonus: 3, desc: '적 전열 전체 타격.' }),
  // --- ranged / pierce ---
  javelin: S({ id: 'javelin', name: '투창', kind: 'attack', shape: 'single', potency: 80, hits: 1, reach: 'ranged', desc: '원거리 단일.' }),
  pike: S({ id: 'pike', name: '장창 관통', kind: 'attack', shape: 'single', potency: 110, hits: 1, reach: 'ranged', bonusVs: { tag: 'cavalry', mult: 1.8 }, desc: '전열 너머 타격 가능.' }),
  shoot: S({ id: 'shoot', name: '사격', kind: 'attack', shape: 'single', potency: 85, hits: 1, reach: 'ranged', bonusVs: { tag: 'flying', mult: 1.6 }, desc: '원거리 단일. 비행에 강함.' }),
  volley: S({ id: 'volley', name: '일제사격', kind: 'attack', shape: 'row', potency: 55, hits: 1, reach: 'ranged', desc: '적 한 열 전체 사격.' }),
  throw_: S({ id: 'throw_', name: '투척', kind: 'attack', shape: 'single', potency: 70, hits: 1, reach: 'ranged', desc: '원거리 단일.' }),
  mounted_shot: S({ id: 'mounted_shot', name: '기동 사격', kind: 'attack', shape: 'single', potency: 75, hits: 1, reach: 'ranged', desc: '원거리 단일.' }),
  // --- magic ---
  firebolt: S({ id: 'firebolt', name: '화염', kind: 'attack', shape: 'single', potency: 120, hits: 1, reach: 'ranged', ignoreGuard: true, desc: '마법 단일. 가드 무시.' }),
  fireball: S({ id: 'fireball', name: '화염구', kind: 'attack', shape: 'row', potency: 80, hits: 1, reach: 'ranged', ignoreGuard: true, moraleBonus: 2, desc: '적 한 열 전체 마법.' }),
  // --- formation break ---
  breach: S({ id: 'breach', name: '돌파', kind: 'breach', shape: 'single', potency: 130, hits: 1, reach: 'ranged', moraleBonus: 4, desc: '전열을 무시하고 후열 직격.' }),
  hook: S({ id: 'hook', name: '끌어내기', kind: 'pull', shape: 'single', potency: 50, hits: 1, reach: 'ranged', desc: '적 후열 유닛을 전열로 끌어낸다.' }),
  shove: S({ id: 'shove', name: '밀어넣기', kind: 'push', shape: 'single', potency: 60, hits: 1, reach: 'melee', desc: '적 전열 유닛을 후열로 밀어넣는다.' }),
  // --- support ---
  guard: S({ id: 'guard', name: '가드', kind: 'guard', shape: 'self', potency: 0, hits: 1, reach: 'melee', desc: '다음 피격을 절반으로. 성공 시 적 사기 감소.' }),
  firstaid: S({ id: 'firstaid', name: '응급', kind: 'heal', shape: 'ally', potency: 18, hits: 1, reach: 'ranged', desc: '아군 1명 소량 회복.' }),
  heal: S({ id: 'heal', name: '치유', kind: 'heal', shape: 'ally', potency: 35, hits: 1, reach: 'ranged', desc: '아군 1명 회복.' }),
  rally: S({ id: 'rally', name: '사기 고무', kind: 'rally', shape: 'allies', potency: 10, hits: 1, reach: 'ranged', desc: '아군 사기 +10.' }),
  rally_big: S({ id: 'rally_big', name: '전령의 나팔', kind: 'rally', shape: 'allies', potency: 14, hits: 1, reach: 'ranged', desc: '아군 사기 +14 (리더 생존 시 +20).' }),
};

export function skill(id: string): SkillDef {
  const s = SKILLS[id];
  if (!s) throw new Error(`unknown skill ${id}`);
  return s;
}
