import { RULES, UNIT_IDS, unitDef, skill, slotRow, type Row, type StartSetup, type StartSquad } from '@vt/sim';
import { spriteEl } from './sprites';
import { allPresets, loadUserPresets, saveUserPresets, clonePreset, presetGold, type SquadPreset } from './presets';
import { tacticsHTML, bindTactics, type TacticSets } from './tacticsEditor';

export const BUDGETS = [60, 100, 150, 200];
const KEY = 'vt.setup.v1';

interface SetupSquad { slots: (string | null)[]; leader: number; tactics: Record<number, TacticSets> }
interface SetupState { budget: number; squads: SetupSquad[] }

const blank = (): SetupSquad => ({ slots: [null, null, null, null, null, null], leader: -1, tactics: {} });
const fromPreset = (p: SquadPreset): SetupSquad => ({ slots: [...p.slots], leader: p.leader, tactics: JSON.parse(JSON.stringify(p.tactics ?? {})) });

/** Pre-match setup screen: spend a budget on squads, formation and tactics before entering the map. */
export class Setup {
  st: SetupState;
  active = 0;
  slot: number | null = null;
  tab: Row = 'front';
  msg = '';
  onStart: (setup: StartSetup, budget: number) => void = () => {};
  onBack: () => void = () => {};

  constructor(private el: HTMLElement) {
    this.st = this.load();
  }

  private load(): SetupState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.squads) && s.squads.length) return s; }
    } catch { /* ignore */ }
    return { budget: 100, squads: [fromPreset(allPresets()[0])] };
  }
  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.st)); } catch { /* ignore */ } }

  squadGold(sq: SetupSquad) { return sq.slots.reduce((a, s) => a + (s ? unitDef(s).cost * 10 : 0), 0); }
  spent() { return this.st.squads.reduce((a, s) => a + this.squadGold(s), 0); }
  left() { return this.st.budget - this.spent(); }

  show() { this.el.classList.remove('hidden'); this.render(); }
  hide() { this.el.classList.add('hidden'); }

  toStartSetup(): StartSetup {
    const squads: StartSquad[] = this.st.squads.filter((s) => s.slots.some((x) => x)).map((s) => ({ slots: [...s.slots], leader: s.leader, tactics: s.tactics }));
    return { gold: Math.max(0, this.left()), squads };
  }

  render() {
    const st = this.st;
    const sq = st.squads[this.active] ?? st.squads[0];
    const left = this.left();
    const user = loadUserPresets();
    let html = `<div class="setup-card">
      <div class="setup-head">
        <span class="title">▶ 출전 준비</span>
        <span>예산 <select id="sel-budget">${BUDGETS.map((b) => `<option value="${b}" ${b === st.budget ? 'selected' : ''}>${b}G</option>`).join('')}</select></span>
        <span>사용 <b>${this.spent()}G</b></span>
        <span class="${left < 0 ? 'over' : ''}">남음 <b>${left}G</b> <span class="muted">→ 시작 군자금</span></span>
        <span class="muted">부대 ${st.squads.length}/${RULES.maxSquads}</span>
      </div>
      <div class="setup-body">
        <div class="setup-left">
          <div class="tabs">${st.squads.map((s, i) => `<button data-sq="${i}" class="${i === this.active ? 'on' : ''}">부대 ${i + 1} <span class="muted">${this.squadGold(s)}G</span></button>`).join('')}<button id="btn-add-squad" ${st.squads.length >= RULES.maxSquads ? 'disabled' : ''}>+ 부대</button><button id="btn-del-squad" ${st.squads.length <= 1 ? 'disabled' : ''}>삭제</button></div>
          <div class="preset-bar">
            <select id="sel-preset">${allPresets(user).map((p) => `<option value="${p.id}">${p.builtin ? '★ ' : ''}${p.name} (${presetGold(p)}G)</option>`).join('')}</select>
            <button id="btn-apply-preset">이 부대에 적용</button>
            <input id="inp-preset-name" placeholder="프리셋 이름" size="10" /><button id="btn-save-preset">저장</button>
            ${user.length ? `<button id="btn-del-preset" title="선택한 내 프리셋 삭제">프리셋 삭제</button>` : ''}
          </div>
          <div id="preset-desc" class="muted"></div>
          <div class="formation">`;
    const cell = (i: number) => {
      const u = sq.slots[i];
      const sel = this.slot === i ? 'sel' : '';
      if (!u) return `<div class="cell empty ${sel}" data-slot="${i}">+ 배치</div>`;
      const d = unitDef(u);
      return `<div class="cell ${sel}" data-slot="${i}">${sq.leader === i ? '<span class="leader">★</span>' : ''}<span class="acts">${d[slotRow(i)].actions}회</span><div class="spr" data-def="${u}"></div><div>${d.nameKo} <span class="muted">${d.cost * 10}G</span></div></div>`;
    };
    html += `<div class="row-label">전열</div>${[0, 1, 2].map(cell).join('')}<div class="row-label">후열</div>${[3, 4, 5].map(cell).join('')}</div>`;
    if (this.slot !== null) {
      const u = sq.slots[this.slot];
      html += `<h3>${slotRow(this.slot) === 'front' ? '전열' : '후열'} ${this.slot % 3 + 1}번 칸${u ? ` — ${unitDef(u).nameKo}` : ''}</h3><div class="recruit">`;
      for (const id of UNIT_IDS) {
        const d = unitDef(id);
        const cost = d.cost * 10;
        const affordable = left + (u ? unitDef(u).cost * 10 : 0) >= cost;
        html += `<button data-pick="${id}" class="${u === id ? 'on' : ''}" ${affordable ? '' : 'disabled'} title="전${d.front.actions}/후${d.back.actions}회 · ${d.tags.join(',')}">${d.nameKo} <span class="muted">${d[slotRow(this.slot)].actions}회</span><span class="cost">${cost}G</span></button>`;
      }
      html += `</div><div class="btnrow"><button id="btn-leader" ${!u || sq.leader === this.slot ? 'disabled' : ''}>리더 지정</button><button id="btn-remove" ${u ? '' : 'disabled'}>비우기</button></div>`;
    } else html += `<div class="muted">칸을 클릭해 유닛을 배치하거나 택틱을 편집하세요. 숫자는 그 열에서의 행동 횟수.</div>`;
    html += `</div><div class="setup-right">`;
    const u = this.slot !== null ? sq.slots[this.slot] : null;
    if (u && this.slot !== null) {
      const d = unitDef(u);
      const t = sq.tactics[this.slot] ?? { front: [], back: [] };
      html += `<div class="unit-info"><b>${d.nameKo}</b> <span class="tags">${d.tags.join(' · ')}</span><br/>HP ${d.hp} · ATK ${d.atk} · DEF ${d.def} · SPD ${d.spd} · 이동 ${d.move}<br/>전열 ${d.front.actions}회: ${d.front.skills.map((s) => skill(s).name).join(', ') || '—'}<br/>후열 ${d.back.actions}회: ${d.back.skills.map((s) => skill(s).name).join(', ') || '—'}</div><h3>택틱</h3>` + tacticsHTML(d, t, this.tab);
    } else html += `<div class="muted">유닛을 선택하면 택틱을 미리 짤 수 있습니다.<br/><br/>전열 세트와 후열 세트는 따로 설정되며, 전투 중 끌려나오거나 밀려나면 그 열의 세트로 바뀝니다.</div>`;
    html += `</div></div>
      <div class="setup-foot"><button id="btn-back">← 뒤로</button><span class="err">${this.msg}</span><button id="btn-go" class="go" ${left < 0 ? 'disabled' : ''}>매치 시작 ▶</button></div>
    </div>`;
    this.el.innerHTML = html;
    this.el.querySelectorAll<HTMLElement>('.spr').forEach((h) => h.appendChild(spriteEl(h.dataset.def!, 'P1', 1)));
    this.bind(sq, user);
  }

  private bind(sq: SetupSquad, user: SquadPreset[]) {
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T | null;
    const on = (sel: string, fn: () => void) => { const b = q<HTMLButtonElement>(sel); if (b) b.onclick = fn; };
    const rerender = () => { this.save(); this.render(); };
    (q<HTMLSelectElement>('#sel-budget')!).onchange = (ev) => { this.st.budget = Number((ev.target as HTMLSelectElement).value); rerender(); };
    this.el.querySelectorAll<HTMLButtonElement>('[data-sq]').forEach((b) => (b.onclick = () => { this.active = Number(b.dataset.sq); this.slot = null; this.render(); }));
    on('#btn-add-squad', () => { this.st.squads.push(blank()); this.active = this.st.squads.length - 1; this.slot = null; rerender(); });
    on('#btn-del-squad', () => { this.st.squads.splice(this.active, 1); this.active = Math.max(0, this.active - 1); this.slot = null; rerender(); });
    const presetSel = q<HTMLSelectElement>('#sel-preset')!;
    const showDesc = () => { const p = allPresets(user).find((x) => x.id === presetSel.value); const d = q('#preset-desc'); if (d) d.textContent = p?.desc ?? ''; };
    presetSel.onchange = showDesc; showDesc();
    on('#btn-apply-preset', () => {
      const p = allPresets(user).find((x) => x.id === presetSel.value); if (!p) return;
      this.st.squads[this.active] = fromPreset(p); this.slot = null; this.msg = ''; rerender();
    });
    on('#btn-save-preset', () => {
      const name = (q<HTMLInputElement>('#inp-preset-name')!.value || '내 프리셋').trim();
      const list = loadUserPresets();
      list.push(clonePreset({ id: '', name, slots: sq.slots, leader: sq.leader, tactics: sq.tactics }, name));
      saveUserPresets(list); this.msg = `프리셋 "${name}" 저장됨`; this.render();
    });
    on('#btn-del-preset', () => {
      const id = presetSel.value; const list = loadUserPresets(); const i = list.findIndex((p) => p.id === id);
      if (i < 0) { this.msg = '내장 프리셋은 삭제할 수 없습니다'; this.render(); return; }
      list.splice(i, 1); saveUserPresets(list); this.msg = '프리셋 삭제됨'; this.render();
    });
    this.el.querySelectorAll<HTMLElement>('.cell[data-slot]').forEach((e) => (e.onclick = () => { this.slot = Number(e.dataset.slot); this.msg = ''; this.render(); }));
    this.el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => {
      if (this.slot === null) return;
      sq.slots[this.slot] = b.dataset.pick!;
      delete sq.tactics[this.slot];
      if (sq.leader < 0) sq.leader = this.slot;
      rerender();
    }));
    on('#btn-leader', () => { sq.leader = this.slot!; rerender(); });
    on('#btn-remove', () => { sq.slots[this.slot!] = null; delete sq.tactics[this.slot!]; if (sq.leader === this.slot) sq.leader = sq.slots.findIndex((x) => x); rerender(); });
    const u = this.slot !== null ? sq.slots[this.slot] : null;
    if (u && this.slot !== null) {
      const slot = this.slot;
      const t = sq.tactics[slot] ?? (sq.tactics[slot] = { front: [], back: [] });
      bindTactics(this.el, unitDef(u), t, this.tab, (row, ts) => { t[row] = ts; rerender(); }, (tab) => { this.tab = tab; this.render(); });
    }
    on('#btn-back', () => this.onBack());
    on('#btn-go', () => {
      const setup = this.toStartSetup();
      if (!setup.squads.length) { this.msg = '최소 한 부대에 유닛을 배치하세요'; this.render(); return; }
      if (this.left() < 0) { this.msg = '예산 초과'; this.render(); return; }
      this.save();
      this.onStart(setup, this.st.budget);
    });
  }
}
