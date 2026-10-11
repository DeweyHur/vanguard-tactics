import { describe, it, expect } from 'vitest';
import { Match, RULES } from '../src/match';
import { MAP_RIVERLANDS } from '../src/data/maps';

const run = (m: Match, seconds: number) => { for (let i = 0; i < seconds / RULES.tick; i++) m.tick(); };

describe('Match', () => {
  it('starts with one squad per player at home and starting gold', () => {
    const m = new Match(MAP_RIVERLANDS, 'domination', 1);
    expect(m.state.squads.length).toBe(2);
    expect(m.state.squads[0].loc.node).toBe('h1');
    expect(m.state.players.P1.gold).toBe(RULES.startGold);
  });

  it('moves along a path and captures a neutral node', () => {
    const m = new Match(MAP_RIVERLANDS, 'domination', 1);
    const sq = m.state.squads[0];
    expect(m.command('P1', { type: 'move', squad: sq.id, target: 'w_sup' }).ok).toBe(true);
    expect(sq.state).toBe('moving');
    run(m, 40);
    expect(m.state.nodes['w_sup'].owner).toBe('P1');
    expect(sq.state).toBe('idle');
    expect(m.state.players.P1.gold).toBeGreaterThan(RULES.startGold);
  });

  it('cannot capture the enemy home outside annihilation mode', () => {
    const m = new Match(MAP_RIVERLANDS, 'domination', 1);
    const sq = m.state.squads[0];
    m.command('P2', { type: 'disband', squad: m.state.squads[1].id });
    m.command('P1', { type: 'move', squad: sq.id, target: 'h2' });
    run(m, 200);
    expect(sq.loc.node).toBe('h2');
    expect(m.state.nodes['h2'].owner).toBe('P2');
  });

  it('two squads meeting at the shrine fight; loser retreats and becomes scattered', () => {
    const m = new Match(MAP_RIVERLANDS, 'domination', 42);
    const [a, b] = m.state.squads;
    m.command('P1', { type: 'move', squad: a.id, target: 'shrine' });
    m.command('P2', { type: 'move', squad: b.id, target: 'shrine' });
    run(m, 60);
    expect(m.state.battles.length).toBeGreaterThan(0);
    const bt = m.state.battles[0];
    expect(bt.result.events[0].t).toBe('start');
    run(m, 120);
    expect(bt.applied).toBe(true);
    if (bt.result.winner !== 'draw') {
      const loser = bt.result.winner === 'A' ? b : a;
      const winner = bt.result.winner === 'A' ? a : b;
      expect(['retreating', 'scattered']).toContain(loser.state);
      expect(['idle', 'moving', 'capturing', 'battle']).toContain(winner.state);
      // scattered squad cannot move until reformed
      run(m, 120);
      expect(loser.state).toBe('scattered');
      expect(m.command(loser.owner, { type: 'move', squad: loser.id, target: 'shrine' }).ok).toBe(false);
      expect(m.command(loser.owner, { type: 'reform', squad: loser.id }).ok).toBe(true);
      expect(loser.state).toBe('idle');
    }
  });

  it('recruiting costs gold and only works at home/barracks', () => {
    const m = new Match(MAP_RIVERLANDS, 'domination', 1);
    const sq = m.state.squads[0];
    const g = m.state.players.P1.gold;
    expect(m.command('P1', { type: 'recruit', squad: sq.id, unit: 'healer', slot: 4 }).ok).toBe(true);
    expect(m.state.players.P1.gold).toBe(g - 20);
    expect(m.command('P1', { type: 'recruit', squad: sq.id, unit: 'giant', slot: 4 }).ok).toBe(false);
  });

  it('is deterministic given seed and identical commands', () => {
    const play = () => {
      const m = new Match(MAP_RIVERLANDS, 'domination', 9);
      m.command('P1', { type: 'move', squad: m.state.squads[0].id, target: 'shrine' });
      m.command('P2', { type: 'move', squad: m.state.squads[1].id, target: 'shrine' });
      run(m, 300);
      return JSON.stringify({ n: m.state.nodes, s: m.state.squads, g: m.state.players });
    };
    expect(play()).toEqual(play());
  });
});
