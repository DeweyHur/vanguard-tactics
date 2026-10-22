import { Battle, type Unit } from './engine';
import { dist, key } from './hex';
import { elemMult } from './rules';

/** plays the whole turn for b.s.side, then ends it */
export function botTurn(b: Battle) {
  const side = b.s.side; const enemyMaster = b.master((1 - side) as 0 | 1);
  const enemies = () => b.s.units.filter((u) => u.hp > 0 && u.side !== side);
  // summon: pick the affordable natial with the best element matchup against the enemy army
  const m = b.master(side);
  for (let guard = 0; guard < 6; guard++) {
    const opts = b.natials.map((d, i) => ({ i, d })).filter((o) => o.d.cost <= b.s.mp[side] && b.summonCells(side, o.d).length);
    if (!opts.length) break;
    const score = (d: typeof opts[0]['d']) => enemies().reduce((a, e) => a + elemMult(d.element, e.def.element) - elemMult(e.def.element, d.element), 0) + d.cost / 2000;
    opts.sort((a, c) => score(c.d) - score(a.d));
    const pick = opts[0]; const cells = b.summonCells(side, pick.d); cells.sort((a, c) => dist(a, enemyMaster) - dist(c, enemyMaster));
    if (b.summon(pick.i, cells[0].r, cells[0].c)) break;
  }
  // units: attack if possible from any reachable cell, else approach the enemy master
  for (const u of b.s.units.filter((x) => x.side === side && x.hp > 0 && !x.acted)) {
    if (b.s.winner >= 0) return;
    const rc = b.reachable(u); let best: { r: number; c: number; t: Unit; v: number } | null = null;
    for (const cell of rc.values()) {
      for (const t of b.targetsFrom(u, cell.r, cell.c)) {
        const v = Math.min(t.hp, b.damage({ ...u, r: cell.r, c: cell.c }, t)) + (t.def.master ? 50 : 0) + (b.damage({ ...u, r: cell.r, c: cell.c }, t) >= t.hp ? 30 : 0) - (u.def.master ? 40 : 0);
        if (!best || v > best.v) best = { r: cell.r, c: cell.c, t, v };
      }
    }
    if (best) { if (best.r !== u.r || best.c !== u.c) b.move(u.uid, best.r, best.c); b.attack(u.uid, best.t.uid); continue; }
    if (u.def.master) continue; // master holds position
    let tgt = { r: u.r, c: u.c, d: dist(u, enemyMaster) };
    for (const cell of rc.values()) { const d = dist(cell, enemyMaster); if (d < tgt.d) tgt = { r: cell.r, c: cell.c, d }; }
    if (key(tgt.r, tgt.c) !== key(u.r, u.c)) b.move(u.uid, tgt.r, tgt.c);
  }
  b.endTurn();
}
