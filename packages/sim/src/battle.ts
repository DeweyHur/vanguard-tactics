import { Rng } from './rng';
import { skill as getSkill } from './data/skills';
import { unitDef } from './data/units';
import {
  type BattleEvent, type BattleResult, type BattleSideInput, type Combatant, type CondId, type Row, type Side,
  type SkillDef, type Tactic, SQUAD_COLS, slotCol, slotRow, otherRow,
} from './types';

export const BASE_MORALE = 100;
const MAX_ACTIONS = 240;

// ---------------- setup ----------------
function makeCombatants(side: Side, input: BattleSideInput): Combatant[] {
  const out: Combatant[] = [];
  input.units.forEach((u, slot) => {
    if (!u || u.injured) return;
    const d = unitDef(u.def);
    const row = slotRow(slot);
    const set = d[row];
    out.push({
      side, slot, uid: u.uid, def: d.id, name: d.nameKo,
      hp: Math.max(1, Math.min(Math.round(u.hp), d.hp)), hpMax: d.hp, atk: d.atk, def_: d.def, spd: d.spd, tags: d.tags,
      row, col: slotCol(slot),
      actionsLeft: set.actions, actionsTotal: set.actions, actionsUsed: 0,
      guarding: false, displaced: false, isLeader: slot === input.leader, alive: true,
      tactics: u.tactics[row].length ? u.tactics[row] : set.tactics,
      skills: set.skills,
      // keep a reference to per-unit tactics for row switching
      ...({ _tacticsAll: u.tactics } as any),
    });
  });
  return out;
}

interface Ctx {
  rng: Rng;
  A: Combatant[];
  B: Combatant[];
  morale: Record<Side, number>;
  moraleMax: Record<Side, number>;
  events: BattleEvent[];
  actionsDone: number;
}

const alive = (cs: Combatant[]) => cs.filter((c) => c.alive);
const inRow = (cs: Combatant[], row: Row) => cs.filter((c) => c.alive && c.row === row);

function enemiesOf(ctx: Ctx, c: Combatant) { return c.side === 'A' ? ctx.B : ctx.A; }
function alliesOf(ctx: Ctx, c: Combatant) { return c.side === 'A' ? ctx.A : ctx.B; }
function enemySide(s: Side): Side { return s === 'A' ? 'B' : 'A'; }

// ---------------- targeting ----------------
function baseCandidates(ctx: Ctx, actor: Combatant, sk: SkillDef): Combatant[] {
  const enemies = enemiesOf(ctx, actor);
  const allies = alliesOf(ctx, actor);
  switch (sk.kind) {
    case 'attack': {
      if (sk.reach === 'ranged') return alive(enemies);
      const front = inRow(enemies, 'front');
      return front.length ? front : inRow(enemies, 'back');
    }
    case 'breach': {
      const back = inRow(enemies, 'back');
      return back.length ? back : inRow(enemies, 'front');
    }
    case 'pull': return inRow(enemies, 'back');
    case 'push': return inRow(enemies, 'front');
    case 'heal': return alive(allies).filter((a) => a.hp < a.hpMax);
    case 'rally': return alive(allies);
    case 'guard': return [actor];
  }
}

function prio(cands: Combatant[], pred: (c: Combatant) => boolean): Combatant[] {
  // stable partition: matching first
  return [...cands.filter(pred), ...cands.filter((c) => !pred(c))];
}

/** returns filtered/sorted candidates, or null when the condition gates the tactic off. */
function applyCond(ctx: Ctx, actor: Combatant, cond: CondId, cands: Combatant[]): Combatant[] | null {
  const own = ctx.morale[actor.side], ownMax = ctx.moraleMax[actor.side];
  const en = ctx.morale[enemySide(actor.side)], enMax = ctx.moraleMax[enemySide(actor.side)];
  const enemies = alive(enemiesOf(ctx, actor));
  const allies = alive(alliesOf(ctx, actor));
  switch (cond) {
    case 'none': return cands;
    case 'prio_lowest_hp': return [...cands].sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax);
    case 'prio_back_row': return prio(cands, (c) => c.row === 'back');
    case 'prio_front_row': return prio(cands, (c) => c.row === 'front');
    case 'prio_flying': return prio(cands, (c) => c.tags.includes('flying'));
    case 'prio_armored': return prio(cands, (c) => c.tags.includes('armored'));
    case 'prio_caster': return prio(cands, (c) => c.tags.includes('caster'));
    case 'prio_cavalry': return prio(cands, (c) => c.tags.includes('cavalry'));
    case 'prio_leader': return prio(cands, (c) => c.isLeader);
    case 'prio_guarding': return prio(cands, (c) => c.guarding);
    case 'tgt_hp_lt_25': return cands.filter((c) => c.hp / c.hpMax < 0.25);
    case 'tgt_hp_lt_50': return cands.filter((c) => c.hp / c.hpMax < 0.5);
    case 'req_back_row': return cands.filter((c) => c.row === 'back');
    case 'req_front_row': return cands.filter((c) => c.row === 'front');
    case 'req_caster': return cands.filter((c) => c.tags.includes('caster'));
    case 'req_flying': return cands.filter((c) => c.tags.includes('flying'));
    case 'req_armored': return cands.filter((c) => c.tags.includes('armored'));
    case 'req_leader': return cands.filter((c) => c.isLeader);
    case 'req_not_guarding': return cands.filter((c) => !c.guarding);
    case 'self_hp_lt_50': return actor.hp / actor.hpMax < 0.5 ? cands : null;
    case 'self_in_front': return actor.row === 'front' ? cands : null;
    case 'self_in_back': return actor.row === 'back' ? cands : null;
    case 'self_displaced': return actor.displaced ? cands : null;
    case 'first_action': return actor.actionsUsed === 0 ? cands : null;
    case 'last_action': return actor.actionsLeft === 1 ? cands : null;
    case 'ally_hp_lt_50': return allies.some((a) => a.hp / a.hpMax < 0.5) ? cands : null;
    case 'ally_morale_lt_50': return own / ownMax < 0.5 ? cands : null;
    case 'enemy_morale_lt_50': return en / enMax < 0.5 ? cands : null;
    case 'enemies_ge_2': return enemies.length >= 2 ? cands : null;
    case 'enemies_ge_4': return enemies.length >= 4 ? cands : null;
    case 'enemy_front_empty': return inRow(enemies, 'front').length === 0 ? cands : null;
    case 'ally_front_empty': return inRow(allies, 'front').length < SQUAD_COLS ? cands : null;
    case 'battle_start': return ctx.actionsDone === 0 ? cands : null;
    case 'outnumbered': return allies.length < enemies.length ? cands : null;
  }
}

export interface Choice { skill: SkillDef; target: Combatant | null; tacticIdx: number }

export function chooseAction(ctx: Ctx, actor: Combatant): Choice | null {
  for (let i = 0; i < actor.tactics.length; i++) {
    const t = actor.tactics[i];
    if (!actor.skills.includes(t.skill)) continue;
    const sk = getSkill(t.skill);
    let cands: Combatant[] | null = baseCandidates(ctx, actor, sk);
    if (cands.length === 0) continue;
    // cond2 first, then cond1 so cond1 is the primary sort key
    cands = applyCond(ctx, actor, t.cond2, cands);
    if (!cands) continue;
    cands = applyCond(ctx, actor, t.cond1, cands);
    if (!cands || cands.length === 0) continue;
    return { skill: sk, target: cands[0], tacticIdx: i };
  }
  // fallback: first usable skill
  for (const sid of actor.skills) {
    const sk = getSkill(sid);
    const cands = baseCandidates(ctx, actor, sk);
    if (cands.length) return { skill: sk, target: cands[0], tacticIdx: -1 };
  }
  return null;
}

// ---------------- effects ----------------
function morale(ctx: Ctx, side: Side, delta: number, why: string) {
  if (delta === 0) return;
  const max = ctx.moraleMax[side];
  ctx.morale[side] = Math.max(0, Math.min(max, ctx.morale[side] + delta));
  ctx.events.push({ t: 'morale', side, delta, morale: ctx.morale[side], why });
}

function dealDamage(ctx: Ctx, actor: Combatant, target: Combatant, sk: SkillDef) {
  const rng = ctx.rng;
  // hit roll
  let hit = 0.92;
  if (sk.reach === 'melee' && target.tags.includes('flying')) hit = 0.7;
  if (!rng.chance(hit)) {
    ctx.events.push({ t: 'miss', side: target.side, uid: target.uid, slot: target.slot });
    morale(ctx, actor.side, -2, 'miss');
    return;
  }
  let base = actor.atk * (sk.potency / 100);
  if (sk.bonusVs && target.tags.includes(sk.bonusVs.tag)) base *= sk.bonusVs.mult;
  base *= 0.9 + rng.next() * 0.2;
  const crit = rng.chance(0.1);
  if (crit) base *= 1.5;
  let dmg = Math.max(1, Math.round(base - target.def_ * 0.5));
  let guarded = false;
  if (target.guarding && !sk.ignoreGuard) {
    dmg = Math.max(1, Math.round(dmg * 0.5));
    guarded = true;
    target.guarding = false;
  }
  target.hp = Math.max(0, target.hp - dmg);
  ctx.events.push({ t: 'hit', side: target.side, uid: target.uid, slot: target.slot, dmg, crit, hp: target.hp, guarded });
  if (guarded) morale(ctx, actor.side, -3, 'guard');
  morale(ctx, target.side, -Math.round((dmg / target.hpMax) * 12) - (sk.moraleBonus ?? 0), 'damage');
  if (target.hp === 0) {
    target.alive = false;
    target.actionsLeft = 0;
    ctx.events.push({ t: 'ko', side: target.side, uid: target.uid, slot: target.slot });
    morale(ctx, target.side, target.isLeader ? -30 : -15, target.isLeader ? 'leader_ko' : 'ko');
  }
}

/** Move target to the other row (swap with occupant of same column if any). */
function displace(ctx: Ctx, target: Combatant) {
  const allies = alliesOf(ctx, target);
  const newRow = otherRow(target.row);
  const newSlot = (newRow === 'front' ? 0 : SQUAD_COLS) + target.col;
  const occupant = allies.find((c) => c.alive && c.slot === newSlot);
  const oldSlot = target.slot;
  const moveOne = (c: Combatant, toSlot: number, row: Row) => {
    const from = c.slot;
    c.slot = toSlot;
    c.row = row;
    c.displaced = true;
    c.guarding = false;
    const set = unitDef(c.def)[row];
    const ratio = c.actionsTotal > 0 ? c.actionsLeft / c.actionsTotal : 0;
    c.actionsTotal = set.actions;
    c.actionsLeft = Math.floor(ratio * set.actions);
    c.skills = set.skills;
    const all = (c as any)._tacticsAll as { front: Tactic[]; back: Tactic[] } | undefined;
    c.tactics = all && all[row].length ? all[row] : set.tactics;
    ctx.events.push({ t: 'move', side: c.side, uid: c.uid, slot: from, toSlot, row });
  };
  if (occupant) moveOne(occupant, oldSlot, otherRow(newRow));
  moveOne(target, newSlot, newRow);
  morale(ctx, target.side, -8, 'displaced');
}

function execute(ctx: Ctx, actor: Combatant, ch: Choice) {
  const sk = ch.skill;
  const target = ch.target;
  ctx.events.push({ t: 'act', side: actor.side, uid: actor.uid, slot: actor.slot, skill: sk.id, tacticIdx: ch.tacticIdx });
  switch (sk.kind) {
    case 'attack':
    case 'breach': {
      if (!target) return;
      const targets = sk.shape === 'row' ? inRow(enemiesOf(ctx, actor), target.row) : sk.shape === 'all' ? alive(enemiesOf(ctx, actor)) : [target];
      for (const tg of targets) for (let h = 0; h < sk.hits; h++) if (tg.alive) dealDamage(ctx, actor, tg, sk);
      return;
    }
    case 'pull':
    case 'push': {
      if (!target) return;
      if (sk.potency > 0) dealDamage(ctx, actor, target, sk);
      if (target.alive) displace(ctx, target);
      return;
    }
    case 'guard':
      actor.guarding = true;
      ctx.events.push({ t: 'guard', side: actor.side, uid: actor.uid, slot: actor.slot });
      return;
    case 'heal': {
      if (!target) return;
      const amt = Math.min(sk.potency + Math.round(actor.atk * 0.5), target.hpMax - target.hp);
      target.hp += amt;
      ctx.events.push({ t: 'heal', side: target.side, uid: target.uid, slot: target.slot, amount: amt, hp: target.hp });
      morale(ctx, actor.side, Math.round(amt / target.hpMax * 4), 'heal');
      return;
    }
    case 'rally': {
      let amt = sk.potency;
      if (sk.id === 'rally_big' && alliesOf(ctx, actor).some((c) => c.alive && c.isLeader)) amt += 6;
      ctx.events.push({ t: 'rally', side: actor.side, amount: amt });
      morale(ctx, actor.side, amt, 'rally');
      return;
    }
  }
}

// ---------------- main loop ----------------
export function runBattle(inA: BattleSideInput, inB: BattleSideInput, seed: number): BattleResult {
  const rng = new Rng(seed);
  const A = makeCombatants('A', inA);
  const B = makeCombatants('B', inB);
  const A0 = A.map((c) => ({ ...c }));
  const B0 = B.map((c) => ({ ...c }));
  const startA = BASE_MORALE + inA.moraleBonus - 4 * Math.max(0, B.length - A.length);
  const startB = BASE_MORALE + inB.moraleBonus - 4 * Math.max(0, A.length - B.length);
  const ctx: Ctx = {
    rng, A, B,
    morale: { A: startA, B: startB },
    moraleMax: { A: BASE_MORALE + inA.moraleBonus, B: BASE_MORALE + inB.moraleBonus },
    events: [], actionsDone: 0,
  };
  ctx.events.push({ t: 'start', moraleA: startA, moraleB: startB });

  const done = () =>
    ctx.morale.A <= 0 || ctx.morale.B <= 0 || alive(A).length === 0 || alive(B).length === 0;

  while (!done() && ctx.actionsDone < MAX_ACTIONS) {
    const ready = [...A, ...B].filter((c) => c.alive && c.actionsLeft > 0);
    if (ready.length === 0) break;
    let maxSpd = -Infinity;
    for (const c of ready) if (c.spd > maxSpd) maxSpd = c.spd;
    const tied = ready.filter((c) => c.spd === maxSpd);
    const best = tied.length === 1 ? tied[0] : tied[rng.int(0, tied.length - 1)];
    const ch = chooseAction(ctx, best);
    best.actionsLeft--;
    best.actionsUsed++;
    if (ch) execute(ctx, best, ch);
    ctx.actionsDone++;
  }

  let winner: Side | 'draw';
  if (ctx.morale.A === ctx.morale.B) winner = 'draw';
  else winner = ctx.morale.A > ctx.morale.B ? 'A' : 'B';
  ctx.events.push({ t: 'end', winner, moraleA: ctx.morale.A, moraleB: ctx.morale.B });
  const strip = (c: Combatant) => { const { _tacticsAll, ...rest } = c as any; return rest as Combatant; };
  return { seed, winner, moraleA: ctx.morale.A, moraleB: ctx.morale.B, events: ctx.events, A: A.map(strip), B: B.map(strip), A0: A0.map(strip), B0: B0.map(strip) };
}
