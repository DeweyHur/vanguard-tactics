// ---------- Shared primitive types ----------
export type Row = 'front' | 'back';
export type Side = 'A' | 'B';
export type PlayerId = 'P1' | 'P2';
export type Tag = 'infantry' | 'armored' | 'flying' | 'caster' | 'cavalry' | 'support' | 'transport' | 'ranged';

export const SQUAD_COLS = 3;
export const SQUAD_SLOTS = 6; // 0..2 front, 3..5 back
export function slotRow(slot: number): Row {
  return slot < SQUAD_COLS ? 'front' : 'back';
}
export function slotCol(slot: number): number {
  return slot % SQUAD_COLS;
}
export function otherRow(r: Row): Row {
  return r === 'front' ? 'back' : 'front';
}

// ---------- Skills ----------
export type SkillKind =
  | 'attack' // damage
  | 'guard' // self-guard until hit
  | 'heal' // heal ally
  | 'rally' // restore own side morale
  | 'pull' // enemy back -> front
  | 'push' // enemy front -> back
  | 'breach'; // attack that ignores front row (targets back row directly)

export type TargetShape = 'single' | 'row' | 'all' | 'self' | 'ally' | 'allies';

export interface SkillDef {
  id: string;
  name: string;
  kind: SkillKind;
  shape: TargetShape;
  /** % of attacker ATK (attack/breach) or flat (heal/rally) */
  potency: number;
  hits: number;
  /** can hit back row even if front row alive (ranged / pierce) */
  reach: 'melee' | 'ranged';
  ignoreGuard?: boolean;
  /** extra morale damage to the target side on hit */
  moraleBonus?: number;
  /** bonus multiplier vs tag */
  bonusVs?: { tag: Tag; mult: number };
  desc: string;
}

// ---------- Tactics ----------
export type CondId =
  | 'none'
  | 'tgt_hp_lt_25'
  | 'tgt_hp_lt_50'
  | 'prio_lowest_hp'
  | 'prio_back_row'
  | 'prio_front_row'
  | 'prio_flying'
  | 'prio_armored'
  | 'prio_caster'
  | 'prio_cavalry'
  | 'prio_leader'
  | 'prio_guarding'
  | 'req_back_row'
  | 'req_front_row'
  | 'req_caster'
  | 'req_flying'
  | 'req_armored'
  | 'req_leader'
  | 'req_not_guarding'
  | 'self_hp_lt_50'
  | 'self_in_front'
  | 'self_in_back'
  | 'self_displaced'
  | 'ally_hp_lt_50'
  | 'ally_morale_lt_50'
  | 'enemy_morale_lt_50'
  | 'enemies_ge_2'
  | 'enemies_ge_4'
  | 'enemy_front_empty'
  | 'ally_front_empty'
  | 'first_action'
  | 'last_action'
  | 'battle_start'
  | 'outnumbered';

export interface Tactic {
  skill: string;
  cond1: CondId;
  cond2: CondId;
}

// ---------- Units ----------
export interface RowSet {
  /** number of actions this unit gets per battle while in this row (0 = useless there) */
  actions: number;
  skills: string[];
  tactics: Tactic[];
}

export interface UnitDef {
  id: string;
  name: string;
  nameKo: string;
  cost: number; // gold = cost * 10
  hp: number;
  atk: number;
  def: number;
  spd: number;
  tags: Tag[];
  front: RowSet;
  back: RowSet;
  /** squad move speed contribution (avg of squad) */
  move: number;
  color: string; // placeholder sprite color
}

/** A concrete unit instance owned by a player. */
export interface UnitInstance {
  uid: string;
  def: string;
  hp: number;
  injured: boolean;
  /** player-editable tactics per row (override of def defaults) */
  tactics: { front: Tactic[]; back: Tactic[] };
}

// ---------- Squads ----------
export type SquadState = 'idle' | 'moving' | 'capturing' | 'battle' | 'retreating' | 'scattered';

export interface SquadLocation {
  /** at a node */
  node?: string;
  /** on an edge: from -> to, progress 0..1 (distance units = edge length) */
  edge?: { from: string; to: string; dist: number };
}

export interface Squad {
  id: string;
  owner: PlayerId;
  name: string;
  slots: (UnitInstance | null)[]; // length 6
  leader: number; // slot index, -1 none
  state: SquadState;
  loc: SquadLocation;
  path: string[]; // remaining nodes to visit
  captureT: number; // seconds spent capturing current node
  battleId?: string;
  cooldown: number; // seconds before it can engage again (after draw)
}

// ---------- Map ----------
export type NodeType = 'home' | 'supply' | 'barracks' | 'watchtower' | 'shrine' | 'fort' | 'plain';

export interface MapNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  /** initial owner (homes) */
  owner?: PlayerId;
  name: string;
}
export interface MapEdge {
  a: string;
  b: string;
  len: number; // distance units
}
export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

// ---------- Battle ----------
export interface Combatant {
  side: Side;
  slot: number;
  uid: string;
  def: string;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def_: number;
  spd: number;
  tags: Tag[];
  row: Row;
  col: number;
  actionsLeft: number;
  actionsTotal: number;
  actionsUsed: number;
  guarding: boolean;
  displaced: boolean;
  isLeader: boolean;
  alive: boolean;
  tactics: Tactic[];
  skills: string[];
}

export type BattleEvent =
  | { t: 'start'; moraleA: number; moraleB: number }
  | { t: 'act'; side: Side; uid: string; slot: number; skill: string; tacticIdx: number }
  | { t: 'hit'; side: Side; uid: string; slot: number; dmg: number; crit: boolean; hp: number; guarded: boolean }
  | { t: 'miss'; side: Side; uid: string; slot: number }
  | { t: 'ko'; side: Side; uid: string; slot: number }
  | { t: 'heal'; side: Side; uid: string; slot: number; amount: number; hp: number }
  | { t: 'guard'; side: Side; uid: string; slot: number }
  | { t: 'rally'; side: Side; amount: number }
  | { t: 'move'; side: Side; uid: string; slot: number; toSlot: number; row: Row } // forced row change
  | { t: 'morale'; side: Side; delta: number; morale: number; why: string }
  | { t: 'end'; winner: Side | 'draw'; moraleA: number; moraleB: number };

export interface BattleResult {
  seed: number;
  winner: Side | 'draw';
  moraleA: number;
  moraleB: number;
  events: BattleEvent[];
  /** final combatant state */
  A: Combatant[];
  B: Combatant[];
  /** initial combatant state (for replay) */
  A0: Combatant[];
  B0: Combatant[];
}

export interface BattleSideInput {
  units: (UnitInstance | null)[];
  leader: number;
  moraleBonus: number;
}
