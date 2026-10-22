import { Battle, type Unit } from './engine';
import { dist, key } from './hex';
import { elemAdv } from './rules';

/** plays the currently active unit (must belong to `side`) and returns when the action is done */
export function botAct(b: Battle) {
  const u = b.activeUnit(); if (!u || b.s.winner >= 0) return;
  const side = u.side; const enemyMaster = b.master((1 - side) as 0 | 1);
  const enemies = () => b.alive().filter((o) => o.side !== side);
  if (u.def.master) {
    // summon when affordable (keep a little MP for the hourly upkeep), else attack an adjacent enemy, else wait
    const mp = b.s.mp[side]; const stones = Object.values(b.s.stones).filter((o) => o === side).length;
    const regen = (stones + 2) * b.stat(u, 2); const upkeep = b.alive().filter((o) => o.side === side && !o.def.master).reduce((a, o) => a + o.def.upkeep, 0);
    const opts = b.natials.map((d, i) => ({ i, d, cost: b.summonCost(d) })).filter((o) => o.cost <= mp - 6 && upkeep + o.d.upkeep <= regen && b.summonCells(side, o.d).length);
    if (opts.length) {
      const score = (d: typeof opts[0]['d']) => enemies().reduce((a, e) => a + elemAdv(d.element, e.def.element), 0) + d.cost / 2000;
      opts.sort((a, c) => score(c.d) - score(a.d)); const pick = opts[0];
      const cells = b.summonCells(side, pick.d).sort((a, c) => dist(a, enemyMaster) - dist(c, enemyMaster));
      if (!b.summon(pick.i, cells[0].r, cells[0].c)) return;
    }
    const adj = b.targetsFrom(u, u.r, u.c); if (adj.length) { adj.sort((a, c) => a.hp - c.hp); if (!b.attack(u.uid, adj[0].uid)) return; }
    b.wait(u.uid); return;
  }
  // natial: best (cell, target) by damage, preferring kills and the master; magic if it hits harder
  const rc = b.reachable(u); rc.set(key(u.r, u.c), { r: u.r, c: u.c, left: 0, from: -1 });
  let best: { r: number; c: number; t: Unit; v: number; magic: boolean } | null = null;
  for (const cell of rc.values()) {
    const probe = { ...u, r: cell.r, c: cell.c };
    for (const t of b.targetsFrom(u, cell.r, cell.c)) { const d = b.damage(probe, t); const v = Math.min(t.hp, d) + (d >= t.hp ? 30 : 0) + (t.def.master ? 20 : 0) - (cell.r !== u.r || cell.c !== u.c ? 1 : 0); if (!best || v > best.v) best = { r: cell.r, c: cell.c, t, v, magic: false }; }
    if (u.def.spell && b.s.mp[side] >= 4) for (const t of enemies()) if (dist(cell, t) <= 3) { const d = b.damage(probe, t, true); const v = Math.min(t.hp, d) + (d >= t.hp ? 30 : 0) + (t.def.master ? 20 : 0) - 2; if (!best || v > best.v) best = { r: cell.r, c: cell.c, t, v, magic: true }; }
  }
  if (best) {
    if (best.r !== u.r || best.c !== u.c) b.move(u.uid, best.r, best.c);
    if (!(best.magic ? b.magic(u.uid, best.t.uid) : b.attack(u.uid, best.t.uid))) return;
  }
  let tgt = { r: u.r, c: u.c, d: dist(u, enemyMaster) };
  for (const cell of rc.values()) { const d = dist(cell, enemyMaster); if (d < tgt.d) tgt = { r: cell.r, c: cell.c, d }; }
  if (key(tgt.r, tgt.c) !== key(u.r, u.c)) b.move(u.uid, tgt.r, tgt.c);
  b.wait(u.uid);
}
