import { Match, RULES, skill, unitDef, type BattleInstance, type BattleEvent, type Combatant, type Side } from '@vt/sim';
import { spriteEl } from './sprites';

interface Replay {
  A: Combatant[]; B: Combatant[];
  moraleA: number; moraleB: number; moraleMaxA: number; moraleMaxB: number;
  acting?: { side: Side; uid: string };
  fx: Map<string, { kind: 'dmg' | 'heal' | 'miss' | 'move'; text: string }>;
  lines: { side: Side | null; text: string }[];
  idx: number;
}

/** time (seconds since battle start) at which event i becomes visible */
function eventTimes(events: BattleEvent[]): number[] {
  const out: number[] = [];
  let t = 1;
  for (const e of events) {
    if (e.t === 'act') t += RULES.battleSecondsPerAction;
    out.push(e.t === 'start' ? 0 : e.t === 'act' ? t - RULES.battleSecondsPerAction + 0.2 : t);
  }
  return out;
}

function replayUpTo(b: BattleInstance, elapsed: number): Replay {
  const r = b.result;
  const times = eventTimes(r.events);
  const rp: Replay = {
    A: r.A0.map((c) => ({ ...c })), B: r.B0.map((c) => ({ ...c })),
    moraleA: 0, moraleB: 0, moraleMaxA: 100, moraleMaxB: 100, fx: new Map(), lines: [], idx: 0,
  };
  const find = (side: Side, uid: string) => (side === 'A' ? rp.A : rp.B).find((c) => c.uid === uid)!;
  const nameOf = (side: Side, uid: string) => find(side, uid)?.name ?? '?';
  let lastActT = -1;
  for (let i = 0; i < r.events.length; i++) {
    if (times[i] > elapsed) break;
    const e = r.events[i];
    rp.idx = i + 1;
    switch (e.t) {
      case 'start':
        rp.moraleA = e.moraleA; rp.moraleB = e.moraleB; rp.moraleMaxA = Math.max(100, e.moraleA); rp.moraleMaxB = Math.max(100, e.moraleB);
        rp.lines.push({ side: null, text: `전투 개시 — 사기 ${e.moraleA} : ${e.moraleB}` });
        break;
      case 'act':
        if (times[i] !== lastActT) { rp.fx.clear(); lastActT = times[i]; }
        rp.acting = { side: e.side, uid: e.uid };
        rp.lines.push({ side: e.side, text: `${nameOf(e.side, e.uid)} ▶ ${skill(e.skill).name}${e.tacticIdx >= 0 ? ` (택틱 ${e.tacticIdx + 1})` : ' (기본)'}` });
        break;
      case 'hit': {
        const c = find(e.side, e.uid); c.hp = e.hp;
        rp.fx.set(e.uid, { kind: 'dmg', text: `-${e.dmg}${e.crit ? '!' : ''}${e.guarded ? '🛡' : ''}` });
        rp.lines.push({ side: e.side, text: `  ${c.name} ${e.dmg} 피해${e.crit ? ' (치명타)' : ''}${e.guarded ? ' (가드)' : ''} → HP ${e.hp}` });
        break;
      }
      case 'miss': rp.fx.set(e.uid, { kind: 'miss', text: 'MISS' }); rp.lines.push({ side: e.side, text: `  ${nameOf(e.side, e.uid)} 회피` }); break;
      case 'ko': { const c = find(e.side, e.uid); c.alive = false; rp.lines.push({ side: e.side, text: `  ${c.name} 전투불능!` }); break; }
      case 'heal': { const c = find(e.side, e.uid); c.hp = e.hp; rp.fx.set(e.uid, { kind: 'heal', text: `+${e.amount}` }); rp.lines.push({ side: e.side, text: `  ${c.name} ${e.amount} 회복` }); break; }
      case 'guard': { const c = find(e.side, e.uid); c.guarding = true; rp.lines.push({ side: e.side, text: `  ${c.name} 가드 태세` }); break; }
      case 'rally': rp.lines.push({ side: e.side, text: `  사기 +${e.amount}` }); break;
      case 'move': { const c = find(e.side, e.uid); c.slot = e.toSlot; c.row = e.row; c.guarding = false; rp.fx.set(e.uid, { kind: 'move', text: e.row === 'front' ? '▼전열' : '▲후열' }); rp.lines.push({ side: e.side, text: `  ${c.name} ${e.row === 'front' ? '전열로 끌려남' : '후열로 밀려남'}!` }); break; }
      case 'morale': if (e.side === 'A') rp.moraleA = e.morale; else rp.moraleB = e.morale; break;
      case 'end': rp.acting = undefined; rp.lines.push({ side: null, text: `전투 종료 — ${e.winner === 'draw' ? '무승부' : (e.winner === 'A' ? '서쪽' : '동쪽') + ' 승리'} (${e.moraleA} : ${e.moraleB})` }); break;
    }
    // a guard consumed by a hit
    if (e.t === 'hit' && e.guarded) find(e.side, e.uid).guarding = false;
  }
  return rp;
}

export class BattleView {
  current: BattleInstance | null = null;
  onOpen: () => void = () => {};
  private lastLines = 0;
  constructor(private el: HTMLElement, private onClose: () => void) {}

  open(b: BattleInstance) { this.current = b; this.lastLines = 0; this.el.classList.remove('hidden'); this.el.innerHTML = ''; this.onOpen(); }
  close() { this.current = null; this.el.classList.add('hidden'); this.onClose(); }

  render(m: Match) {
    const b = this.current;
    if (!b) return;
    const st = m.state;
    const elapsed = Math.min(st.t - b.startT, b.endT - b.startT + 100);
    const rp = replayUpTo(b, elapsed);
    const sqA = m.squad(b.squads.A), sqB = m.squad(b.squads.B);
    const nameA = sqA?.name ?? b.squads.A, nameB = sqB?.name ?? b.squads.B;
    const done = st.t >= b.endT;
    const side = (s: Side, cs: Combatant[], name: string, morale: number, max: number) => {
      const cells: string[] = [];
      for (let slot = 0; slot < 6; slot++) {
        const c = cs.find((x) => x.slot === slot);
        if (!c) { cells.push(`<div class="cell empty"></div>`); continue; }
        const d = unitDef(c.def);
        const fx = rp.fx.get(c.uid);
        const cls = ['cell', c.alive ? '' : 'ko', rp.acting?.uid === c.uid ? 'acting' : '', fx?.kind === 'dmg' ? 'hurt' : '', c.guarding ? 'guard' : ''].join(' ');
        cells.push(`<div class="${cls}" data-uid="${c.uid}">
          ${c.isLeader ? '<span class="leader">★</span>' : ''}
          <span class="acts">${c.row === 'front' ? '전' : '후'}</span>
          <div class="spr" data-def="${c.def}" data-owner="${s === 'A' ? b.owners.A : b.owners.B}"></div>
          <div>${d.nameKo}</div>
          <div class="hpbar"><i style="width:${(100 * c.hp) / c.hpMax}%"></i></div>
          ${fx ? `<span class="fx ${fx.kind}">${fx.text}</span>` : ''}
        </div>`);
      }
      // front row shown nearest the center: A: back,front ; B: front,back
      const front = cells.slice(0, 3).join(''), back = cells.slice(3, 6).join('');
      const grid = s === 'A' ? `<div class="row-label">후열</div>${back}<div class="row-label">전열</div>${front}` : `<div class="row-label">전열</div>${front}<div class="row-label">후열</div>${back}`;
      return `<div class="bo-side ${s === 'A' ? 'p1' : 'p2'}">
        <div class="name">${name} ${s === 'A' ? '(서)' : '(동)'}</div>
        <div class="morale"><i style="width:${(100 * Math.max(0, morale)) / max}%"></i><span>사기 ${Math.max(0, Math.round(morale))}</span></div>
        <div class="bo-grid formation">${grid}</div>
      </div>`;
    };
    this.el.innerHTML = `
      <div class="bo-head">
        <b>⚔ ${b.where}</b>
        <span class="muted">${done ? '종료 (리플레이)' : `진행 중 ${Math.floor(elapsed)}s / ${Math.ceil(b.endT - b.startT)}s`}</span>
        <button id="bo-close">닫기 ✕</button>
      </div>
      <div class="bo-field">${side('A', rp.A, nameA, rp.moraleA, rp.moraleMaxA)}${side('B', rp.B, nameB, rp.moraleB, rp.moraleMaxB)}</div>
      <div class="bo-log" id="bo-log">${rp.lines.map((l) => `<div class="${l.side ?? ''}">${l.text}</div>`).join('')}</div>`;
    this.el.querySelectorAll<HTMLElement>('.spr').forEach((holder) => {
      holder.appendChild(spriteEl(holder.dataset.def!, holder.dataset.owner as 'P1' | 'P2', 1));
    });
    (this.el.querySelector('#bo-close') as HTMLButtonElement).onclick = () => this.close();
    const log = this.el.querySelector('#bo-log') as HTMLElement;
    if (rp.lines.length !== this.lastLines) { log.scrollTop = log.scrollHeight; this.lastLines = rp.lines.length; }
  }
}
