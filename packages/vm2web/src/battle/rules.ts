/**
 * Tunable rule set. The original formulas are not reverse-engineered yet; these are approximations
 * chosen to feel like Vantage Master. Every number the engine uses lives here.
 */
export const RULES = {
  masterHp: 40, masterAtk: 12, masterDef: 8, masterMove: 4,
  mpStart: 600, mpRegen: 150, mpPerStone: 120, mpMax: 3000,
  /** terrain id -> cost per move type (Infinity = impassable). order: 걷기, 걷기2, 헤엄, 헤엄2, 날기 */
  moveCost: {
    0: [1, 1, 2, 2, 1], 1: [2, 1, 3, 2, 1], 2: [2, 1, 3, 2, 1], 3: [2, 2, 1, 1, 1], 4: [2, 1, 3, 2, 1], 5: [3, 2, 2, 1, 1],
    6: [1, 1, 1, 1, 1], 7: [2, 2, 1, 1, 1], 8: [Infinity, 3, 1, 1, 1], 9: [Infinity, Infinity, 1, 1, 1],
    10: [Infinity, Infinity, Infinity, Infinity, 1], 11: [Infinity, Infinity, Infinity, Infinity, 1],
    12: [1, 1, 2, 2, 1], 13: [2, 2, 1, 1, 1], 14: [1, 1, 2, 2, 1], 15: [1, 1, 2, 2, 1], 16: [Infinity, Infinity, Infinity, Infinity, Infinity],
  } as Record<number, number[]>,
  /** climbing more than this many height steps in one hop is blocked for non-flyers */
  maxClimb: 3,
  /** element cycle: 땅(1) > 물(2) > 불(3) > 하늘(4) > 땅 */
  elemAdv: 1.5, elemDis: 0.67,
  /** magic stone terrain -> element it empowers (12 땅, 13 물, 14 불, 15 하늘) */
  stoneElement: { 12: 1, 13: 2, 14: 3, 15: 4 } as Record<number, number>,
  stoneBoost: 1.2, heightBonus: 0.1, counterMult: 0.75,
  /** kills needed to reach level 2 / 3 */
  levelKills: [0, 1, 3],
  zocIgnoreMoveType: 4,
  dayLength: 6,
};
export const elemMult = (atk: number, def: number) => {
  if (!atk || !def || atk === def) return 1;
  const beats = (a: number, d: number) => (a % 4) + 1 === d; // 1>2, 2>3, 3>4, 4>1
  return beats(atk, def) ? RULES.elemAdv : beats(def, atk) ? RULES.elemDis : 1;
};
