import { CONDITIONS, skill, type Row, type Tactic, type UnitDef } from '@vt/sim';

export type TacticSets = { front: Tactic[]; back: Tactic[] };

/** Tactics for a row: the user's override or the unit's defaults. */
export function effectiveTactics(d: UnitDef, t: TacticSets, row: Row): Tactic[] {
  return t[row].length ? t[row] : d[row].tactics;
}

/** HTML for the per-row tactics editor (tabs + priority rows). Empty override = defaults. */
export function tacticsHTML(d: UnitDef, t: TacticSets, tab: Row): string {
  let html = `<div class="tabs"><button class="${tab === 'front' ? 'on' : ''}" data-tab="front">전열 세트</button><button class="${tab === 'back' ? 'on' : ''}" data-tab="back">후열 세트</button></div>`;
  const set = d[tab];
  const tactics = effectiveTactics(d, t, tab);
  const isDefault = t[tab].length === 0;
  if (set.actions === 0) return html + `<div class="muted">이 열에서는 행동하지 않는다.</div>`;
  html += `<div class="skills">${set.actions}회 행동 · 위에서부터 조건을 만족하는 첫 행동을 실행 ${isDefault ? '<span class="muted">(기본값)</span>' : ''}</div>`;
  tactics.forEach((tc, i) => {
    html += `<div class="tactic-row"><span class="idx">${i + 1}</span>
      <select data-tr="${i}" data-f="skill">${set.skills.map((s) => `<option value="${s}" ${tc.skill === s ? 'selected' : ''}>${skill(s).name}</option>`).join('')}</select>
      <select data-tr="${i}" data-f="cond1">${CONDITIONS.map((c) => `<option value="${c.id}" ${tc.cond1 === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      <select data-tr="${i}" data-f="cond2">${CONDITIONS.map((c) => `<option value="${c.id}" ${tc.cond2 === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      <button data-del="${i}" title="삭제">✕</button></div>`;
  });
  html += `<div class="btnrow"><button data-add-tactic ${tactics.length >= 6 ? 'disabled' : ''}>+ 행 추가</button><button data-reset-tactic ${isDefault ? 'disabled' : ''}>기본값으로</button></div>`;
  return html;
}

/** Wire the editor rendered by tacticsHTML. onChange receives the new override list for `tab` ([] = defaults). */
export function bindTactics(root: HTMLElement, d: UnitDef, t: TacticSets, tab: Row, onChange: (row: Row, tactics: Tactic[]) => void, onTab: (tab: Row) => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => onTab(b.dataset.tab as Row)));
  const current = (): Tactic[] => effectiveTactics(d, t, tab).map((x) => ({ ...x }));
  const fresh = (): Tactic => ({ skill: d[tab].skills[0], cond1: 'none', cond2: 'none' });
  root.querySelectorAll<HTMLSelectElement>('select[data-tr]').forEach((s) => (s.onchange = () => {
    const ts = current(); const i = Number(s.dataset.tr); (ts[i] as any)[s.dataset.f!] = s.value; onChange(tab, ts);
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => (b.onclick = () => { const ts = current(); ts.splice(Number(b.dataset.del), 1); onChange(tab, ts.length ? ts : [fresh()]); }));
  const add = root.querySelector<HTMLButtonElement>('[data-add-tactic]'); if (add) add.onclick = () => { const ts = current(); ts.push(fresh()); onChange(tab, ts); };
  const reset = root.querySelector<HTMLButtonElement>('[data-reset-tactic]'); if (reset) reset.onclick = () => onChange(tab, []);
}
