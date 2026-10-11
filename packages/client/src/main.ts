import { Match, MAP_RIVERLANDS, RULES, enemyOf, type GameMode, type PlayerId } from '@vt/sim';
import { Bot, type Difficulty } from '@vt/bot';
import { MapView } from './mapView';
import { Panel } from './panel';
import { BattleView } from './battleView';
import { spriteEl, UNIT_SPRITES } from './sprites';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const ME: PlayerId = 'P1';

const MODE_KO: Record<GameMode, string> = { domination: '점령전', shrine: '성소 쟁탈', annihilation: '전멸전' };

class Game {
  match: Match;
  bot: Bot;
  mapView = new MapView($('#map'));
  panel: Panel;
  battleView: BattleView;
  speed = 1;
  running = true;
  paused = false;
  acc = 0;
  last = performance.now();
  lastPanel = 0;
  lastBattle = 0;
  logSig = '';

  constructor(public mode: GameMode, diff: Difficulty, seed: number) {
    this.match = new Match(MAP_RIVERLANDS, mode, seed);
    this.bot = new Bot(enemyOf(ME), this.match, diff);
    this.panel = new Panel($('#panel'), this.match, ME);
    this.battleView = new BattleView($('#battle-overlay'), () => {});
    this.panel.onSelectSquad = () => {};
    this.panel.select(this.match.state.squads.find((s) => s.owner === ME)?.id ?? null);
    this.bindInput();
  }

  private bindInput() {
    const c = this.mapView.canvas;
    const toMap = (ev: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const map = this.match.state.map;
      return { x: ((ev.clientX - r.left) / r.width) * map.width, y: ((ev.clientY - r.top) / r.height) * map.height };
    };
    c.onmousemove = (ev) => { const p = toMap(ev); this.mapView.hover = this.mapView.hitTest(this.match, p.x, p.y); };
    c.onmouseleave = () => { this.mapView.hover = {}; };
    c.onclick = (ev) => {
      const p = toMap(ev);
      const hit = this.mapView.hitTest(this.match, p.x, p.y);
      if (hit.battle) { this.battleView.open(hit.battle); return; }
      if (hit.squad) {
        if (hit.squad.owner === ME) this.panel.select(hit.squad.id);
        else {
          // clicking an enemy squad: move selected squad to its node if it's at one
          const sq = this.panel.squad();
          if (sq && hit.squad.loc.node) this.issueMove(sq.id, hit.squad.loc.node);
        }
        return;
      }
      if (hit.node) {
        const sq = this.panel.squad();
        if (sq) this.issueMove(sq.id, hit.node.id);
        else {
          const here = this.match.state.squads.find((s) => s.owner === ME && s.loc.node === hit.node!.id);
          if (here) this.panel.select(here.id);
        }
      }
    };
    c.oncontextmenu = (ev) => { ev.preventDefault(); const sq = this.panel.squad(); if (sq) this.match.command(ME, { type: 'stop', squad: sq.id }); };
    document.querySelectorAll<HTMLButtonElement>('#time-ctl [data-speed]').forEach((b) => (b.onclick = () => this.setSpeed(Number(b.dataset.speed))));
    window.onkeydown = (ev) => {
      if ((ev.target as HTMLElement)?.tagName === 'INPUT' || (ev.target as HTMLElement)?.tagName === 'SELECT') return;
      if (ev.key === ' ') { ev.preventDefault(); this.setSpeed(0); }
      if (ev.key === '1') this.setSpeed(1);
      if (ev.key === '2') this.setSpeed(2);
      if (ev.key === '3') this.setSpeed(0.5);
      if (ev.key === '4') this.setSpeed(4);
      if (ev.key === 'Escape') this.battleView.close();
    };
    this.battleView.onOpen = () => { if (($('#chk-autopause') as HTMLInputElement).checked) this.setSpeed(0); };
    this.setSpeed(1);
  }

  /** 0 = toggle pause; otherwise set speed and resume */
  setSpeed(v: number) {
    if (v === 0) this.paused = !this.paused;
    else { this.speed = v; this.paused = false; }
    document.querySelectorAll<HTMLButtonElement>('#time-ctl [data-speed]').forEach((b) => {
      const sv = Number(b.dataset.speed);
      b.classList.toggle('on', sv === 0 ? this.paused : !this.paused && sv === this.speed);
    });
    $('#btn-pause').textContent = this.paused ? '▶' : '❚❚';
    let banner = document.querySelector('#pause-banner') as HTMLElement | null;
    if (this.paused && !banner) { banner = document.createElement('div'); banner.id = 'pause-banner'; banner.textContent = 'PAUSED'; $('#map-wrap').appendChild(banner); }
    if (!this.paused && banner) banner.remove();
  }

  private issueMove(squadId: string, node: string) {
    const r = this.match.command(ME, { type: 'move', squad: squadId, target: node });
    this.panel.error = r.ok ? '' : r.error ?? '';
    this.panel.render(true);
  }

  frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused && !this.match.state.winner) {
      this.acc += dt * this.speed;
      while (this.acc >= RULES.tick) {
        this.bot.step();
        this.match.tick();
        this.acc -= RULES.tick;
      }
    }
    this.fitMap();
    this.mapView.draw(this.match, this.panel.squad(), now);
    this.hud();
    if (now - this.lastPanel > 250) { this.panel.render(); this.lastPanel = now; }
    if (now - this.lastBattle > 120) { this.battleView.render(this.match); this.battleList(); this.lastBattle = now; }
    if (this.match.state.winner) this.showEnd();
    requestAnimationFrame(this.frame);
  };

  private lastFit = '';
  /** integer-scale the low-res map canvas to the available area so pixels stay crisp */
  private fitMap() {
    const wrap = $('#map-wrap');
    const c = this.mapView.canvas;
    const cw = wrap.clientWidth - 8, ch = wrap.clientHeight - 8;
    const scale = Math.max(1, Math.floor(Math.min(cw / c.width, ch / c.height)));
    const key = `${scale}`;
    if (key === this.lastFit) return;
    this.lastFit = key;
    c.style.width = `${c.width * scale}px`;
    c.style.height = `${c.height * scale}px`;
  }

  private hud() {
    const st = this.match.state;
    const t = Math.floor(st.t);
    $('#hud-time').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    $('#hud-mode').textContent = `[${MODE_KO[st.mode]}]`;
    $('#hud-gold').textContent = `${Math.floor(st.players[ME].gold)}G (+${this.match.incomeRate(ME).toFixed(1)}/s)`;
    $('#hud-nodes').textContent = `거점 ${this.match.nodeCount('P1')} : ${this.match.nodeCount('P2')}`;
    let obj = '';
    if (st.mode === 'domination') {
      const need = Math.floor(st.map.nodes.length / 2) + 1;
      obj = `과반(${need}개) 유지 — 나 ${st.hold.P1.toFixed(0)}s / 적 ${st.hold.P2.toFixed(0)}s / ${RULES.dominationHold}s`;
    } else if (st.mode === 'shrine') obj = `성소 보유 누적 — 나 ${st.hold.P1.toFixed(0)}s / 적 ${st.hold.P2.toFixed(0)}s / ${RULES.shrineHold}s`;
    else obj = '적 본진을 점령하라';
    $('#hud-objective').textContent = obj;
    // log
    const lines = st.log.slice(-7);
    const sig = lines.map((l) => l.t + l.msg).join('|');
    if (sig !== this.logSig) {
      this.logSig = sig;
      $('#log').innerHTML = lines.map((l) => `<div class="${l.kind}">[${Math.floor(l.t / 60)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}] ${l.msg}</div>`).join('');
    }
  }

  private blSig = '';
  private battleList() {
    const st = this.match.state;
    const items = [...st.battles].reverse().slice(0, 8);
    const body = $('#battle-list-body');
    const statusOf = (b: typeof items[number]) => {
      const a = this.match.squad(b.squads.A)?.name ?? '?', bb = this.match.squad(b.squads.B)?.name ?? '?';
      return b.applied ? (b.result.winner === 'draw' ? '무승부' : `${b.result.winner === 'A' ? a : bb} 승`) : `진행 ${Math.floor(st.t - b.startT)}s`;
    };
    const sig = items.map((b) => b.id + (b.applied ? 1 : 0)).join('|');
    if (sig !== this.blSig) {
      this.blSig = sig;
      body.innerHTML = items.length ? items.map((b) => {
        const a = this.match.squad(b.squads.A)?.name ?? '?', bb = this.match.squad(b.squads.B)?.name ?? '?';
        return `<div class="bl-item ${b.applied ? 'done' : ''}" data-b="${b.id}">⚔ ${b.where}<br/><span class="muted">${a} vs ${bb} · <span class="bl-status"></span></span></div>`;
      }).join('') : '<div class="bl-item muted">진행 중인 전투 없음</div>';
      body.querySelectorAll<HTMLElement>('[data-b]').forEach((e) => (e.onclick = () => { const b = st.battles.find((x) => x.id === e.dataset.b); if (b) this.battleView.open(b); }));
    }
    body.querySelectorAll<HTMLElement>('[data-b]').forEach((e) => {
      const b = items.find((x) => x.id === e.dataset.b);
      const sEl = e.querySelector('.bl-status');
      if (b && sEl) sEl.textContent = statusOf(b);
    });
  }

  private ended = false;
  private showEnd() {
    if (this.ended) return;
    this.ended = true;
    const st = this.match.state;
    const w = st.winner;
    const card = $('#start-screen');
    card.classList.remove('hidden');
    const res = document.createElement('div');
    res.className = 'result';
    res.textContent = w === 'draw' ? '무승부' : w === ME ? `승리! — ${st.winReason}` : `패배 — ${st.winReason}`;
    const h1 = card.querySelector('h1')!;
    card.querySelector('.result')?.remove();
    h1.after(res);
    $('#btn-start').textContent = '다시 시작';
  }
}

let game: Game | null = null;
// unit parade on the title screen
for (const id of Object.keys(UNIT_SPRITES)) $('#parade').appendChild(spriteEl(id, 'P1', 1));
$('#btn-start').onclick = async () => {
  try { await Promise.all([document.fonts.load('11px Galmuri11'), document.fonts.load('9px Galmuri9'), document.fonts.load('7px Galmuri7')]); } catch {}
  const mode = ($('#sel-mode') as HTMLSelectElement).value as GameMode;
  const diff = ($('#sel-diff') as HTMLSelectElement).value as Difficulty;
  const seed = Number(($('#inp-seed') as HTMLInputElement).value) || 1;
  $('#start-screen').classList.add('hidden');
  $('#battle-overlay').classList.add('hidden');
  if (game) game.running = false;
  game = new Game(mode, diff, seed);
  requestAnimationFrame(game.frame);
};
// expose for debugging / automated tests
(window as any).vt = { get game() { return game; } };
