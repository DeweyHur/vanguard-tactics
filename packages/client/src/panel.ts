import {
  Match, RULES, CONDITIONS, UNIT_IDS, skill, unitDef, squadActive, squadUnits, slotRow,
  type Squad, type Row, type Tactic, type Command, type PlayerId,
} from '@vt/sim';
import { spriteEl } from './sprites';

const STATE_KO: Record<string, string> = { idle: '대기', moving: '이동 중', capturing: '점령 중', battle: '전투 중', retreating: '퇴각 중', scattered: '와해' };

export class Panel {
  selectedSquad: string | null = null;
  selectedSlot: number | null = null;
  tab: Row = 'front';
  swapMode = false;
  error = '';
  private sig = '';
  onSelectSquad: (id: string | null) => void = () => {};

  constructor(private el: HTMLElement, private m: Match, private me: PlayerId) {}

  private cmd(c: Command) {
    const r = this.m.command(this.me, c);
    this.error = r.ok ? '' : r.error ?? '';
    this.sig = '';
    this.render(true);
  }

  select(id: string | null) {
    if (this.selectedSquad !== id) { this.selectedSlot = null; }
    this.selectedSquad = id;
    this.onSelectSquad(id);
    this.sig = '';
    this.render(true);
  }

  squad(): Squad | null { return this.selectedSquad ? this.m.squad(this.selectedSquad) ?? null : null; }

  render(force = false) {
    const active = document.activeElement;
    if (!force && active && this.el.contains(active) && active.tagName === 'SELECT') return;
    const st = this.m.state;
    const mine = st.squads.filter((s) => s.owner === this.me);
    const sq = this.squad();
    const sig = JSON.stringify([mine.map((s) => [s.id, s.state, s.loc, squadActive(s).length]), sq?.slots.map((u) => u && [u.uid, Math.round(u.hp), u.injured]), sq?.leader, this.selectedSlot, this.tab, this.swapMode, Math.floor(st.players[this.me].gold / 10), this.error]);
    if (!force && sig === this.sig) return;
    this.sig = sig;

    let html = `<h3>내 부대 (${mine.length}/${RULES.maxSquads})</h3><div class="squad-list">`;
    for (const s of mine) {
      const where = s.loc.node ? this.m.node(s.loc.node).name : `${this.m.node(s.loc.edge!.from).name} → ${this.m.node(s.loc.edge!.to).name}`;
      html += `<div class="sq ${s.id === this.selectedSquad ? 'sel' : ''}" data-sq="${s.id}"><span>${s.name} <span class="muted">${squadActive(s).length}/6</span></span><span class="state state-${s.state}">${STATE_KO[s.state]} · ${where}</span></div>`;
    }
    html += `</div>`;
    const home = this.m.homeOf(this.me).id;
    html += `<div class="btnrow"><button id="btn-new-squad" ${mine.length >= RULES.maxSquads ? 'disabled' : ''}>+ 본진에 새 부대</button></div>`;
    html += `<div class="err">${this.error}</div>`;

    if (sq) {
      const atNode = sq.loc.node;
      const canEdit = !!atNode && (sq.state === 'idle' || sq.state === 'scattered' || sq.state === 'capturing');
      const canRecruit = !!atNode && this.m.canRecruitAt(this.me, atNode) && canEdit;
      const owned = !!atNode && this.m.ownerOf(atNode) === this.me;
      html += `<h3>${sq.name} — 편성 ${canEdit ? '' : '<span class="muted">(거점 대기 중에만 편성 가능)</span>'}</h3>`;
      html += `<div class="formation">`;
      const cell = (slot: number) => {
        const u = sq.slots[slot];
        const sel = this.selectedSlot === slot ? 'sel' : '';
        if (!u) return `<div class="cell empty ${sel}" data-slot="${slot}">${canRecruit ? '+ 소환' : '빈 칸'}</div>`;
        const d = unitDef(u.def);
        const set = d[slotRow(slot)];
        return `<div class="cell ${sel} ${u.injured ? 'injured' : ''}" data-slot="${slot}">
          ${sq.leader === slot ? '<span class="leader">★</span>' : ''}<span class="acts">${set.actions}회</span>
          <div class="spr" data-def="${u.def}"></div>
          <div>${d.nameKo}${u.injured ? ' (부상)' : ''}</div>
          <div class="hpbar"><i style="width:${(100 * u.hp) / d.hp}%"></i></div>
        </div>`;
      };
      html += `<div class="row-label">전열 (적과 맞닿음)</div>${[0, 1, 2].map(cell).join('')}<div class="row-label">후열</div>${[3, 4, 5].map(cell).join('')}</div>`;
      html += `<div class="btnrow">`;
      if (sq.state === 'scattered') html += `<button id="btn-reform" ${owned ? '' : 'disabled'}>재편성 (와해 해제)</button>`;
      else if (owned && squadUnits(sq).some((u) => u.injured)) html += `<button id="btn-reform">재편성 (부상 회복)</button>`;
      if (sq.state === 'moving') html += `<button id="btn-stop">정지</button>`;
      html += `<button id="btn-disband">부대 해산</button></div>`;
      html += `<div class="muted">이동 속도 ${this.m.squadSpeed(sq).toFixed(1)} · 맵에서 거점을 클릭하면 이동</div>`;

      const slot = this.selectedSlot;
      if (slot !== null) {
        const u = sq.slots[slot];
        if (!u) {
          if (canRecruit) {
            html += `<h3>${slotRow(slot) === 'front' ? '전열' : '후열'} ${slot % 3 + 1}번 칸에 소환</h3><div class="recruit">`;
            for (const id of UNIT_IDS) {
              const d = unitDef(id);
              const set = d[slotRow(slot)];
              const cost = d.cost * RULES.goldPerCost;
              html += `<button data-recruit="${id}" ${st.players[this.me].gold < cost ? 'disabled' : ''} title="${d.front.actions}/${d.back.actions}회 · ${d.tags.join(',')}">${d.nameKo} <span class="muted">${set.actions}회</span><span class="cost">${cost}G</span></button>`;
            }
            html += `</div><div class="muted">숫자는 이 열에서의 행동 횟수. 0회 유닛은 그 열에서 아무것도 못 한다.</div>`;
          } else html += `<div class="muted">본진/병영에서만 소환할 수 있다.</div>`;
        } else {
          const d = unitDef(u.def);
          html += `<div class="unit-info"><b>${d.nameKo}</b> <span class="tags">${d.tags.join(' · ')}</span><br/>HP ${Math.round(u.hp)}/${d.hp} · ATK ${d.atk} · DEF ${d.def} · SPD ${d.spd}<br/>
            전열 ${d.front.actions}회: ${d.front.skills.map((s) => skill(s).name).join(', ') || '—'}<br/>후열 ${d.back.actions}회: ${d.back.skills.map((s) => skill(s).name).join(', ') || '—'}</div>`;
          html += `<div class="btnrow"><button id="btn-leader" ${sq.leader === slot ? 'disabled' : ''}>리더 지정</button><button id="btn-swap" class="${this.swapMode ? 'on' : ''}" ${canEdit ? '' : 'disabled'}>${this.swapMode ? '교체할 칸을 클릭…' : '자리 바꾸기'}</button><button id="btn-dismiss" ${canEdit && owned ? '' : 'disabled'}>해고 (50% 환불)</button></div>`;
          // tactics editor
          html += `<h3>택틱</h3><div class="tabs"><button class="${this.tab === 'front' ? 'on' : ''}" data-tab="front">전열 세트</button><button class="${this.tab === 'back' ? 'on' : ''}" data-tab="back">후열 세트</button></div>`;
          const set = d[this.tab];
          const tactics = u.tactics[this.tab].length ? u.tactics[this.tab] : set.tactics;
          const isDefault = u.tactics[this.tab].length === 0;
          if (set.actions === 0) html += `<div class="muted">이 열에서는 행동하지 않는다.</div>`;
          else {
            html += `<div class="skills">${set.actions}회 행동 · 위에서부터 조건을 만족하는 첫 행동을 실행 ${isDefault ? '<span class="muted">(기본값)</span>' : ''}</div>`;
            tactics.forEach((t, i) => {
              html += `<div class="tactic-row"><span class="idx">${i + 1}</span>
                <select data-tr="${i}" data-f="skill">${set.skills.map((s) => `<option value="${s}" ${t.skill === s ? 'selected' : ''}>${skill(s).name}</option>`).join('')}</select>
                <select data-tr="${i}" data-f="cond1">${CONDITIONS.map((c) => `<option value="${c.id}" ${t.cond1 === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
                <select data-tr="${i}" data-f="cond2">${CONDITIONS.map((c) => `<option value="${c.id}" ${t.cond2 === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
                <button data-del="${i}" title="삭제">✕</button></div>`;
            });
            html += `<div class="btnrow"><button id="btn-add-tactic" ${tactics.length >= 6 ? 'disabled' : ''}>+ 행 추가</button><button id="btn-reset-tactic" ${isDefault ? 'disabled' : ''}>기본값으로</button></div>`;
          }
        }
      } else html += `<div class="muted">칸을 클릭하면 소환 / 유닛 정보 / 택틱 편집.</div>`;
    } else {
      html += `<div class="muted">맵이나 위 목록에서 부대를 선택하세요.</div>`;
      html += `<h3>유닛 요약</h3><div class="muted" style="font-size:11px;line-height:1.5">${UNIT_IDS.map((id) => { const d = unitDef(id); return `<b>${d.nameKo}</b> ${d.cost * 10}G — 전${d.front.actions}/후${d.back.actions}`; }).join('<br/>')}</div>`;
    }
    this.el.innerHTML = html;
    this.el.querySelectorAll<HTMLElement>('.spr').forEach((h) => h.appendChild(spriteEl(h.dataset.def!, this.me, 1)));
    this.bind(sq, home);
  }

  private bind(sq: Squad | null, home: string) {
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T | null;
    this.el.querySelectorAll<HTMLElement>('.sq').forEach((e) => (e.onclick = () => this.select(e.dataset.sq!)));
    const nb = q<HTMLButtonElement>('#btn-new-squad');
    if (nb) nb.onclick = () => { this.cmd({ type: 'createSquad', node: home }); const last = this.m.state.squads.filter((s) => s.owner === this.me).at(-1); if (last) this.select(last.id); };
    if (!sq) return;
    this.el.querySelectorAll<HTMLElement>('.cell[data-slot]').forEach((e) => (e.onclick = () => {
      const slot = Number(e.dataset.slot);
      // swap mode: a unit is selected and another cell is clicked -> swap / move
      if (this.swapMode && this.selectedSlot !== null && this.selectedSlot !== slot && sq.slots[this.selectedSlot]) {
        const r = this.m.command(this.me, { type: 'swap', squad: sq.id, from: this.selectedSlot, to: slot });
        this.error = r.ok ? '' : r.error ?? '';
        if (r.ok) this.selectedSlot = slot;
        this.swapMode = false;
        this.sig = ''; this.render(true); return;
      }
      this.swapMode = false;
      this.selectedSlot = slot; this.sig = ''; this.render(true);
    }));
    const on = (sel: string, fn: () => void) => { const b = q<HTMLButtonElement>(sel); if (b) b.onclick = fn; };
    on('#btn-reform', () => this.cmd({ type: 'reform', squad: sq.id }));
    on('#btn-stop', () => this.cmd({ type: 'stop', squad: sq.id }));
    on('#btn-disband', () => { this.cmd({ type: 'disband', squad: sq.id }); this.select(null); });
    on('#btn-swap', () => { this.swapMode = !this.swapMode; this.sig = ''; this.render(true); });
    on('#btn-leader', () => this.cmd({ type: 'setLeader', squad: sq.id, slot: this.selectedSlot! }));
    on('#btn-dismiss', () => this.cmd({ type: 'dismiss', squad: sq.id, slot: this.selectedSlot! }));
    this.el.querySelectorAll<HTMLButtonElement>('[data-recruit]').forEach((b) => (b.onclick = () => this.cmd({ type: 'recruit', squad: sq.id, unit: b.dataset.recruit!, slot: this.selectedSlot! })));
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab as Row; this.sig = ''; this.render(true); }));
    const u = this.selectedSlot !== null ? sq.slots[this.selectedSlot] : null;
    if (!u) return;
    const d = unitDef(u.def);
    const current = (): Tactic[] => (u.tactics[this.tab].length ? u.tactics[this.tab] : d[this.tab].tactics).map((t) => ({ ...t }));
    const save = (ts: Tactic[]) => this.cmd({ type: 'setTactics', squad: sq.id, slot: this.selectedSlot!, row: this.tab, tactics: ts });
    this.el.querySelectorAll<HTMLSelectElement>('select[data-tr]').forEach((s) => (s.onchange = () => {
      const ts = current(); const i = Number(s.dataset.tr); (ts[i] as any)[s.dataset.f!] = s.value; save(ts);
    }));
    this.el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => (b.onclick = () => { const ts = current(); ts.splice(Number(b.dataset.del), 1); save(ts.length ? ts : [{ skill: d[this.tab].skills[0], cond1: 'none', cond2: 'none' }]); }));
    on('#btn-add-tactic', () => { const ts = current(); ts.push({ skill: d[this.tab].skills[0], cond1: 'none', cond2: 'none' }); save(ts); });
    on('#btn-reset-tactic', () => save([]));
  }
}
