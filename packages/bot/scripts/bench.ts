/** Headless bot-vs-bot balance bench. Usage: npm run sim:bench -- [games] [mode] */
import { Match, MAP_RIVERLANDS, RULES, type GameMode } from '@vt/sim';
import { Bot } from '../src/index';

const games = Number(process.argv[2] ?? 20);
const mode = (process.argv[3] ?? 'domination') as GameMode;
const wins: Record<string, number> = { P1: 0, P2: 0, draw: 0 };
let totalT = 0, totalBattles = 0, firstBattle = 0;

for (let g = 0; g < games; g++) {
  const m = new Match(MAP_RIVERLANDS, mode, 1000 + g);
  const b1 = new Bot('P1', m, 'normal');
  const b2 = new Bot('P2', m, 'normal');
  let battles = 0, fb = -1;
  while (!m.state.winner) {
    if (g % 2) { b2.step(); b1.step(); } else { b1.step(); b2.step(); } m.tick();
    const n = m.state.battles.length;
    if (n > battles) { if (fb < 0) fb = m.state.t; battles = n; }
    if (m.state.t > RULES.matchLength + 1) break;
  }
  const w = m.state.winner ?? 'draw';
  wins[w]++;
  totalT += m.state.t; totalBattles += m['battleSeq' as keyof Match] as unknown as number; firstBattle += fb;
  console.log(`game ${g}: ${w} (${m.state.winReason}) t=${m.state.t.toFixed(0)}s battles=${m['battleSeq' as keyof Match]} first=${fb.toFixed(0)}s`);
}
console.log('---');
console.log(`wins`, wins, `avgLen=${(totalT / games / 60).toFixed(1)}min avgBattles=${(totalBattles / games).toFixed(1)} avgFirstBattle=${(firstBattle / games).toFixed(0)}s`);
