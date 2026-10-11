import {
  Match, RULES, enemyOf, squadActive, squadUnits, unitDef, type PlayerId, type Squad, SQUAD_SLOTS,
} from '@vt/sim';

export type Difficulty = 'easy' | 'normal' | 'hard';

const NODE_VALUE: Record<string, number> = { supply: 3, barracks: 3, fort: 2.5, shrine: 3, watchtower: 1, plain: 1, home: 0 };

const TEMPLATES: string[][] = [
  ['infantry', 'spear', 'infantry', 'archer', 'healer', 'archer'],
  ['shield', 'infantry', 'spear', 'mage', 'healer', 'archer'],
  ['shield', 'axe', 'infantry', 'archer', 'herald', 'mage'],
  ['hooker', 'shield', 'cavalry', 'mage', 'healer', 'archer'],
  ['giant', 'shield', 'spear', 'healer', 'herald', 'mage'],
];

/**
 * Simple AI that uses only the public command interface.
 * Layers: strategy (where to go), recruitment (what to buy), reform.
 */
export class Bot {
  private nextT = 0;
  private interval: number;
  private useCounters: boolean;
  private assigned = new Map<string, string>(); // squad -> target node

  constructor(public player: PlayerId, private match: Match, public difficulty: Difficulty = 'normal') {
    this.interval = difficulty === 'easy' ? 4 : difficulty === 'normal' ? 2 : 1;
    this.useCounters = difficulty !== 'easy';
  }

  step() {
    const st = this.match.state;
    if (st.winner || st.t < this.nextT) return;
    this.nextT = st.t + this.interval;
    this.reform();
    this.recruit();
    this.strategy();
  }

  private mine(): Squad[] { return this.match.state.squads.filter((s) => s.owner === this.player); }
  private theirs(): Squad[] { return this.match.state.squads.filter((s) => s.owner !== this.player); }

  private reform() {
    for (const sq of this.mine()) {
      if (sq.state === 'scattered') this.match.command(this.player, { type: 'reform', squad: sq.id });
      // idle at owned node with injured units -> reform heals them
      if (sq.state === 'idle' && sq.loc.node && this.match.ownerOf(sq.loc.node) === this.player && squadUnits(sq).some((u) => u.injured)) {
        this.match.command(this.player, { type: 'reform', squad: sq.id });
      }
    }
  }

  private enemyProfile() {
    let armored = 0, back = 0, cavalry = 0, total = 0;
    for (const sq of this.theirs()) sq.slots.forEach((u, i) => {
      if (!u) return; total++;
      const d = unitDef(u.def);
      if (d.tags.includes('armored')) armored++;
      if (d.tags.includes('cavalry')) cavalry++;
      if (i >= 3) back++;
    });
    return { armored, back, cavalry, total };
  }

  private pickUnit(sq: Squad, slot: number, gold: number): string | null {
    const st = this.match.state;
    const phase = Math.min(TEMPLATES.length - 1, Math.floor(st.t / 240));
    const tpl = TEMPLATES[phase];
    let want = tpl[slot];
    if (this.useCounters) {
      const ep = this.enemyProfile();
      if (ep.total > 0) {
        if (slot < 3 && ep.armored / ep.total > 0.3 && gold >= 20) want = slot === 0 ? 'axe' : want;
        if (slot >= 3 && ep.armored / ep.total > 0.3 && gold >= 20) want = slot === 3 ? 'mage' : want;
        if (ep.back / ep.total > 0.4 && gold >= 30 && st.t > 300) want = slot === 2 ? 'cavalry' : slot === 1 ? 'hooker' : want;
        if (ep.cavalry > 0 && slot === 1) want = 'spear';
      }
    }
    const cost = unitDef(want).cost * RULES.goldPerCost;
    if (gold >= cost) return want;
    // fall back to cheapest sensible filler
    const filler = slot < 3 ? 'infantry' : 'archer';
    return gold >= 10 ? filler : null;
  }

  private recruit() {
    const st = this.match.state;
    const ps = st.players[this.player];
    const home = this.match.homeOf(this.player).id;
    const mine = this.mine();
    // new squad when rich and under a time-ramped cap (so the bot doesn't out-expand a human in the first minutes)
    const ramp = this.difficulty === 'easy' ? 240 : this.difficulty === 'normal' ? 150 : 90;
    const cap = Math.min(RULES.maxSquads, 1 + Math.floor(st.t / ramp));
    if (mine.length < cap && ps.gold >= 60 && !mine.some((s) => s.loc.node === home && squadActive(s).length < 4)) {
      this.match.command(this.player, { type: 'createSquad', node: home });
    }
    for (const sq of this.mine()) {
      if (!sq.loc.node || !this.match.canRecruitAt(this.player, sq.loc.node)) continue;
      if (sq.state !== 'idle' && sq.state !== 'scattered') continue;
      for (let slot = 0; slot < SQUAD_SLOTS; slot++) {
        if (sq.slots[slot]) continue;
        const u = this.pickUnit(sq, slot, ps.gold);
        if (!u) break;
        const r = this.match.command(this.player, { type: 'recruit', squad: sq.id, unit: u, slot });
        if (!r.ok) break;
      }
    }
  }

  private squadStrength(sq: Squad): number {
    return squadActive(sq).reduce((a, u) => a + (u.hp / unitDef(u.def).hp) * unitDef(u.def).cost, 0);
  }

  private strategy() {
    const st = this.match.state;
    const me = this.player, en = enemyOf(me);
    const home = this.match.homeOf(me).id;
    const mine = this.mine();
    const threats = this.theirs().filter((s) => this.match.isCombatReady(s));
    for (const sq of mine) {
      if (sq.state !== 'idle' || !sq.loc.node) continue;
      const here = sq.loc.node;
      const str = this.squadStrength(sq);
      const active = squadActive(sq);
      // weak squads go home to heal/recruit
      if ((active.length <= 2 || str < 2.5) && here !== home && st.players[me].gold >= 20) {
        this.go(sq, home); continue;
      }
      if (here === home && sq.slots.some((s) => !s) && st.players[me].gold >= 10) continue; // wait to fill up
      // defend: enemy squad sitting on / heading to one of our nodes
      let best: string | null = null, bestScore = -Infinity;
      for (const n of st.map.nodes) {
        const owner = st.nodes[n.id].owner;
        if (owner === me && !threats.some((t) => t.loc.node === n.id || t.path.at(-1) === n.id)) continue;
        if (n.type === 'home' && owner === en && st.mode !== 'annihilation') continue;
        if (n.type === 'home' && owner === me) continue;
        const path = this.match.findPath(here, n.id);
        if (!path) continue;
        const dist = this.match.pathLength(here, path);
        let value = NODE_VALUE[n.type] ?? 1;
        if (st.mode === 'shrine' && n.type === 'shrine') value += 4;
        if (st.mode === 'annihilation' && n.type === 'home' && owner === en) value += 6;
        if (owner === en) value += 1.5;
        if (owner === me) value += 2; // defend
        // avoid piling multiple squads onto one target
        const taken = [...this.assigned.entries()].filter(([sid, tgt]) => sid !== sq.id && tgt === n.id && this.match.squad(sid)).length;
        value /= 1 + taken;
        // avoid walking into a much stronger enemy
        const enemyThere = threats.filter((t) => t.loc.node === n.id || t.path.at(-1) === n.id);
        const enemyStr = enemyThere.reduce((a, t) => a + this.squadStrength(t), 0);
        if (enemyStr > str * 1.3) value *= 0.25;
        const score = value / (dist + 6);
        if (score > bestScore) { bestScore = score; best = n.id; }
      }
      if (best && best !== here) this.go(sq, best);
    }
  }

  private go(sq: Squad, target: string) {
    const r = this.match.command(this.player, { type: 'move', squad: sq.id, target });
    if (r.ok) this.assigned.set(sq.id, target);
  }
}
