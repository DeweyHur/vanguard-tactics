/**
 * Rule set reconstructed from play references (나무위키 VM 택틱스 항목, gameplay captures) and the EXE tables.
 * Known for sure: every unit has 10 HP; turns are an OA (Open-to-Attack) timeline driven by speed and the size of the
 * action; MP recovers on the hour: (magic stones + 2) x master MAG - upkeep of summoned natials; day/night cycle
 * affects light-typed natials; attacks from the side/rear hurt more; nothing is random. Exact constants below are
 * calibrated guesses and live here so they can be tuned.
 */
export const RULES = {
  hp: 10,
  /** master template: ATK DEF MAG MDEF SPD, move, MP max (grows with master level in the original) */
  master: { stats: [8, 6, 7, 5, 7], move: 4, mpMax: 60, mpStart: 60 },
  /** EXE natial table: `cost` is the summon cost in MP x50, field 0 is the hourly upkeep x8 */
  summonCostDiv: 50, upkeepDiv: 8,
  /** OA (minutes until the unit acts again) = base - speed*speedWeight (+ per-hex moved, + action cost) */
  oaBase: 70, oaSpeedWeight: 2, oaMin: 15, oaPerHex: 2, oaAttack: 10, oaRangedPerHex: 4, oaMagic: 20, oaSummon: 30, oaWait: 0,
  /** clock (minutes) at battle start, and the daylight bands */
  startClock: 7 * 60, day: [8 * 60, 16 * 60], dusk: [16 * 60, 20 * 60], night: [20 * 60, 4 * 60], dawn: [4 * 60, 8 * 60],
  /** light-typed natials (flag 1 = day type, 2 = night type) get +lightBonus to every stat in their period, -lightBonus in the opposite one */
  lightBonus: 2,
  /** physical damage = ATK - DEF + 1; magic = MAG - MDEF + 1; then element, facing, terrain and height; min 1 */
  elemBonus: 2, sideBonus: 1, rearBonus: 2, heightBonus: 1,
  /** terrain id -> cost per move type (Infinity = impassable). order: 걷기, 걷기2, 헤엄, 헤엄2, 날기 */
  moveCost: {
    0: [1, 1, 2, 2, 1], 1: [2, 1, 3, 2, 1], 2: [2, 1, 3, 2, 1], 3: [2, 2, 1, 1, 1], 4: [2, 1, 3, 2, 1], 5: [3, 2, 2, 1, 1],
    6: [1, 1, 1, 1, 1], 7: [2, 2, 1, 1, 1], 8: [Infinity, 3, 1, 1, 1], 9: [Infinity, Infinity, 1, 1, 1],
    10: [Infinity, Infinity, Infinity, Infinity, 1], 11: [Infinity, Infinity, Infinity, Infinity, 1],
    12: [1, 1, 2, 2, 1], 13: [2, 2, 1, 1, 1], 14: [1, 1, 2, 2, 1], 15: [1, 1, 2, 2, 1], 16: [Infinity, Infinity, Infinity, Infinity, Infinity],
  } as Record<number, number[]>,
  maxClimb: 3,
  /** element cycle: 땅(1) > 물(2) > 불(3) > 하늘(4) > 땅 */
  /** magic stone terrain -> element (12 땅, 13 물, 14 불, 15 하늘); standing on one captures it */
  stoneElement: { 12: 1, 13: 2, 14: 3, 15: 4 } as Record<number, number>,
  /** terrain defence % shown by the game (마법석 방어 30%) */
  terrainDef: { 2: 15, 3: 10, 12: 30, 13: 30, 14: 30, 15: 30 } as Record<number, number>,
  /** exp = damage dealt; level thresholds for L2 / L3 */
  levelExp: [0, 10, 25],
  zocIgnoreMoveType: 4,
  /** magic: spell cost in MP and range */
  magicCost: 4, magicRange: 3,
};
export const elemAdv = (atk: number, def: number) => (!atk || !def || atk === def ? 0 : (atk % 4) + 1 === def ? 1 : (def % 4) + 1 === atk ? -1 : 0);
/** 0 day, 1 dusk/dawn, 2 night */
export function lightAt(clock: number): 0 | 1 | 2 {
  const m = ((clock % 1440) + 1440) % 1440;
  if (m >= RULES.day[0] && m < RULES.day[1]) return 0;
  if (m >= RULES.night[0] || m < RULES.night[1]) return 2;
  return 1;
}
export const clockText = (clock: number) => `${Math.floor(((clock % 1440) + 1440) % 1440 / 60)}:${String(clock % 60).padStart(2, '0')}`;
