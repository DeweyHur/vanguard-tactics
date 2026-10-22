import { type VM2Data, type MapInfo, type Natial, type Tileset, TERRAIN, ELEMENT } from './vm2data';
import { TileRenderer, drawMap, worldSize, pickCell, cellOrigin, hexPath } from './render';
import { TILE_H } from './vm2data';
import { Battle, reachableFrom, masterDef, type UnitDef, type Unit, type Terrain } from './battle/engine';
import { botTurn } from './battle/bot';
import { key, neighbors, type Cell } from './battle/hex';
import { RULES } from './battle/rules';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

import type { Sfx } from './sound';
export interface BattleDeps { data: () => VM2Data | null; natials: () => Natial[]; mapGrid: (m: MapInfo) => Uint16Array; mapTileset: (m: MapInfo) => Tileset; mapName: (m: MapInfo) => string; portrait: (k: number) => HTMLCanvasElement | null; sfx: Sfx; sprite: (defId: string, side: 0 | 1, frame: number) => HTMLCanvasElement | null; masterSprite: (m: number, side: 0 | 1, frame: number) => HTMLCanvasElement | null; bgm: () => void; bgmStop: () => void }

export function initBattle(deps: BattleDeps) {
  const canvas = $<HTMLCanvasElement>('bmap'), wrap = $('bwrap'), g = canvas.getContext('2d')!;
  const world = document.createElement('canvas'); const ws = worldSize(); world.width = ws.w; world.height = ws.h; const wg = world.getContext('2d')!;
  const cam = { x: 0, y: 0, z: 2 };
  let b: Battle | null = null, ts: Tileset | null = null, grid: Uint16Array | null = null, rend: TileRenderer | null = null;
  let sel: Unit | null = null, summonIdx = -1, hover: Cell | null = null, busy = false; let masterIdx: [number, number] = [0, 1];
  // facing (0..5 = frame group) and a short attack animation per unit
  const facing = new Map<number, number>(); const attackAnim = new Map<number, { t0: number; dx: number; dy: number }>();
  /** hex direction from a -> b as a frame group: 0 W, 1 SW, 2 SE, 3 E, 4 NE, 5 NW (order as stored in DATA02) */
  function dirOf(a: Cell, b: Cell): number {
    const ax = a.c + (a.r & 1) * 0.5, bx = b.c + (b.r & 1) * 0.5; const dx = bx - ax, dy = b.r - a.r;
    if (dy === 0) return dx < 0 ? 0 : 3;
    if (dy > 0) return dx < 0 ? 1 : 2; return dx < 0 ? 5 : 4;
  }
  function frameOf(u: Unit): number {
    const dir = facing.get(u.uid) ?? (u.side === 0 ? 2 : 5); const an = attackAnim.get(u.uid);
    if (!an) return dir * 3;
    const age = performance.now() - an.t0; if (age > 700) { attackAnim.delete(u.uid); return dir * 3; }
    return dir * 3 + (age < 250 ? 1 : 2);
  }
  function animOffset(u: Unit): { x: number; y: number } {
    const an = attackAnim.get(u.uid); if (!an) return { x: 0, y: 0 }; const age = performance.now() - an.t0; const k = age < 250 ? age / 250 : age < 500 ? 1 : Math.max(0, 1 - (age - 500) / 200);
    return { x: an.dx * 10 * k, y: an.dy * 6 * k };
  }
  // the original flashes units that can still act: one translucent frame roughly every second
  let blinkTick = 0; const blinkOn = () => blinkTick % 9 === 0;
  setInterval(() => { if (!b || $('tab-battle').classList.contains('hidden')) return; const was = blinkOn(); blinkTick++; if (was !== blinkOn()) draw(); }, 120);
  let animTimer = 0; const kickAnim = () => { clearInterval(animTimer); animTimer = window.setInterval(() => { if (!attackAnim.size) { clearInterval(animTimer); return; } draw(); }, 50); };

  const toUnitDef = (n: Natial): UnitDef => ({ id: `n${n.index}`, name: n.name, hp: n.hp, stats: n.stats, move: n.move, element: n.element, range: Math.max(1, n.range), moveType: Math.min(4, n.moveType), cost: n.cost });

  function populate() {
    const d = deps.data(); if (!d) return;
    const bm = $<HTMLSelectElement>('bMap'); bm.innerHTML = d.maps.map((m) => `<option value="${m.index}">${m.index} ${deps.mapName(m)}</option>`).join('');
    const opts = d.masters.map((m) => `<option value="${m.index}">${m.name}</option>`).join('');
    $<HTMLSelectElement>('bM0').innerHTML = opts; $<HTMLSelectElement>('bM1').innerHTML = opts; $<HTMLSelectElement>('bM1').selectedIndex = Math.min(1, d.masters.length - 1);
  }

  /** nearest cell to `near` from which a walking master can actually reach plenty of cells */
  function findStart(terrain: Terrain, near: Cell): Cell {
    const md = masterDef('m'); let best: Cell = near, bd = 1e9;
    for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
      const dd = Math.hypot(r - near.r, c - near.c); if (dd >= bd) continue;
      if ((RULES.moveCost[terrain.terrain(r, c)]?.[0] ?? Infinity) === Infinity) continue;
      if (reachableFrom(terrain, md, r, c, () => null).size < 12) continue;
      bd = dd; best = { r, c };
    }
    return best;
  }

  $('bStart').onclick = () => {
    const d = deps.data(); if (!d) return; const nats = deps.natials();
    if (!nats.length) { $('bInfo').textContent = 'Vmtv2.exe가 필요합니다 (네이티얼 스탯)'; return; }
    const m = d.maps[+$<HTMLSelectElement>('bMap').value]; ts = deps.mapTileset(m); grid = deps.mapGrid(m); rend = new TileRenderer(ts, d.palette(ts.pal));
    const T = ts, G = grid; const terrain: Terrain = { terrain: (r, c) => T.defs[G[r * 32 + c]].terrain, height: (r, c) => T.defs[G[r * 32 + c]].height };
    const n0 = $<HTMLSelectElement>('bM0'), n1 = $<HTMLSelectElement>('bM1'); masterIdx = [+n0.value - 52, +n1.value - 52];
    b = new Battle(terrain, nats.map(toUnitDef), [findStart(terrain, { r: 5, c: 5 }), findStart(terrain, { r: 26, c: 26 })], [n0.selectedOptions[0].text, n1.selectedOptions[0].text]);
    (window as unknown as { __battle: Battle; __cam: typeof cam }).__battle = b; (window as unknown as { __cam: typeof cam }).__cam = cam; sel = null; summonIdx = -1; $('bsetup').classList.add('hidden');
    wg.clearRect(0, 0, ws.w, ws.h); drawMap(wg, rend, grid); fit(); refresh(); deps.bgm();
  };
  $('bQuit').onclick = () => { b = null; deps.bgmStop(); $('bsetup').classList.remove('hidden'); refresh(); draw(); };
  $('bEnd').onclick = async () => {
    if (!b || busy || b.s.winner >= 0) return; sel = null; summonIdx = -1; b.endTurn(); deps.sfx.role('turn'); refresh(); draw();
    busy = true; await new Promise((r) => setTimeout(r, 300)); const n0 = b.s.log.length; if (b.s.side === 1 && b.s.winner < 0) botTurn(b); busy = false;
    for (const u of b.s.units) if (u.hp > 0 && u.side === 1) { let best: Unit | null = null, bd = 1e9; for (const o of b.s.units) if (o.hp > 0 && o.side === 0) { const d = Math.hypot(o.r - u.r, o.c - u.c); if (d < bd) { bd = d; best = o; } } if (best) facing.set(u.uid, dirOf(u, best)); }
    const added = b.s.log.slice(n0); if (added.some((l) => l.includes('격파'))) deps.sfx.role('kill'); else if (added.some((l) => l.includes('피해'))) deps.sfx.role('attack'); else if (added.some((l) => l.includes('소환'))) deps.sfx.role('summon');
    refresh(); draw();
  };

  function fit() {
    canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; cam.z = 2;
    const m = b && ts && grid ? center(b.master(0).r, b.master(0).c) : { x: ws.w / 2, y: ws.h / 2 };
    cam.x = m.x * cam.z - canvas.width / 2; cam.y = m.y * cam.z - canvas.height / 2; draw();
  }
  const center = (r: number, c: number) => { const o = cellOrigin(r, c); const h = ts!.defs[grid![r * 32 + c]].height; return { x: o.x + 24, y: o.base - 18 - 12 * h }; };
  const fillHex = (r: number, c: number, style: string) => { const p = center(r, c); hexPath(g, p.x, p.y); g.fillStyle = style; g.fill(); };

  function draw() {
    g.imageSmoothingEnabled = false; g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (!b || !ts || !grid) return;
    g.save(); g.translate(-cam.x, -cam.y); g.scale(cam.z, cam.z); g.drawImage(world, 0, 0);
    for (const k of Object.keys(b.s.stones)) { const r = Math.floor(+k / 32), c = +k % 32; const own = b.s.stones[+k]; const p = center(r, c); hexPath(g, p.x, p.y); g.lineWidth = 1.5; g.strokeStyle = own === 0 ? '#4af' : own === 1 ? '#f66' : '#ee4'; g.stroke(); }
    // like the original: dim the whole map and redraw the cells that matter at full brightness
    const lit: { r: number; c: number }[] = [];
    if (sel && !sel.moved) for (const v of b.reachable(sel).values()) lit.push(v);
    const tg = sel && !sel.acted ? b.targetsFrom(sel, sel.r, sel.c) : [];
    const sc = summonIdx >= 0 ? b.summonCells(b.s.side, b.natials[summonIdx]) : [];
    if (lit.length || tg.length || sc.length) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(cam.x / cam.z, cam.y / cam.z, canvas.width / cam.z, canvas.height / cam.z);
      const cells = [...lit, ...tg.map((t) => ({ r: t.r, c: t.c })), ...sc]; cells.sort((a, c) => a.r - c.r || a.c - c.c);
      for (const cell of cells) { const o = cellOrigin(cell.r, cell.c); g.drawImage(rend!.tile(grid[cell.r * 32 + cell.c]), o.x, o.base - TILE_H); }
      for (const t of tg) fillHex(t.r, t.c, 'rgba(255,60,60,.35)');
      for (const p of sc) fillHex(p.r, p.c, 'rgba(80,255,120,.35)');
    }
    const units = b.s.units.filter((u) => u.hp > 0).sort((x, y) => x.r - y.r || x.c - y.c);
    for (const u of units) {
      const p = center(u.r, u.c);
      const fr = frameOf(u); const off = animOffset(u); p.x += off.x; p.y += off.y;
      const sp = u.def.master ? deps.masterSprite(masterIdx[u.side], u.side, fr) : deps.sprite(u.def.id, u.side, fr);
      const canAct = (!u.moved || !u.acted) && u.side === b.s.side && b.s.winner < 0;
      if (sp) {
        g.beginPath(); g.ellipse(p.x, p.y + 4, 16, 8, 0, 0, Math.PI * 2); g.fillStyle = u === sel ? 'rgba(255,255,255,.55)' : u.side === 0 ? 'rgba(60,120,255,.45)' : 'rgba(255,70,70,.45)'; g.fill();
        if (canAct && blinkOn()) g.globalAlpha = 0.45;
        g.drawImage(sp, p.x - 48, p.y + 8 - (+(sp.dataset.bottom ?? 90))); g.globalAlpha = 1;
        if (u.def.master) { g.lineWidth = 2; g.strokeStyle = '#ffd24a'; g.beginPath(); g.ellipse(p.x, p.y + 4, 17, 9, 0, 0, Math.PI * 2); g.stroke(); }
      } else {
        g.beginPath(); g.arc(p.x, p.y, u.def.master ? 13 : 11, 0, Math.PI * 2); g.fillStyle = u.side === 0 ? '#2a6fd6' : '#d63a3a'; g.fill();
        g.lineWidth = u === sel ? 3 : 1.5; g.strokeStyle = u.def.master ? '#ffd24a' : u === sel ? '#fff' : '#000'; g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(u.def.master ? 'M' : (ELEMENT[u.def.element]?.[0] ?? '?') + (u.level > 1 ? u.level : ''), p.x, p.y);
      }
      g.fillStyle = '#000'; g.fillRect(p.x - 12, p.y + 13, 24, 4); g.fillStyle = u.hp / u.def.hp > 0.5 ? '#4e4' : u.hp / u.def.hp > 0.25 ? '#ee4' : '#e44'; g.fillRect(p.x - 12, p.y + 13, 24 * u.hp / u.def.hp, 4);
      if (u.level > 1 && sp) { g.fillStyle = '#ffd24a'; g.font = 'bold 9px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`L${u.level}`, p.x + 13, p.y + 11); }
      if (canAct && b.s.side === 0 && !sp) { g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x + 14, p.y - 6, 3, 0, Math.PI * 2); g.fill(); }
    }
    if (hover) { const p = center(hover.r, hover.c); hexPath(g, p.x, p.y); g.lineWidth = 1; g.strokeStyle = '#ff0'; g.stroke(); const d = ts.defs[grid[hover.r * 32 + hover.c]]; const u = b.unitAt(hover.r, hover.c); $('bhud').textContent = `(${hover.r},${hover.c}) ${TERRAIN[d.terrain] ?? d.terrain} 높이 ${d.height} 방어 ${RULES.terrainDef[d.terrain] ?? 0}%${u ? ` · ${u.def.name} HP ${u.hp}/${u.def.hp}` : ''}`; }
    g.restore();
  }

  const portraitHtml = (id: string) => (id.startsWith('n') && deps.portrait(+id.slice(1)) ? `<div class="pbox" data-k="${id.slice(1)}"></div>` : '');
  function mountPortrait(box: HTMLElement) { const c = deps.portrait(+box.dataset.k!); if (!c) return; const t = document.createElement('canvas'); const h = 150; t.height = h; t.width = Math.round(c.width * h / c.height); t.getContext('2d')!.drawImage(c, 0, 0, t.width, h); box.appendChild(t); }
  function refresh() {
    const info = $('bInfo'), ui = $('bUnit'), sm = $('bSummon');
    if (!b) { info.textContent = ''; ui.textContent = ''; sm.innerHTML = ''; $('bLog').textContent = ''; return; }
    const s = b.s; const st = (side: 0 | 1) => Object.values(s.stones).filter((o) => o === side).length;
    info.innerHTML = s.winner >= 0 ? `<b style="color:var(--acc)">${s.names[s.winner as 0 | 1]} 승리!</b> (턴 ${s.turn})` : `턴 ${s.turn} · <b>${s.side === 0 ? '내 차례' : '봇 차례'}</b><br><span class="e2">${s.names[0]}</span> MP ${s.mp[0]} 마법석 ${st(0)} · <span class="e3">${s.names[1]}</span> MP ${s.mp[1]} 마법석 ${st(1)}`;
    if (sel) { const u = sel; ui.innerHTML = `${portraitHtml(u.def.id)}<b>${u.def.name}</b> <span class="e${u.def.element}">${ELEMENT[u.def.element] ?? ''}</span> Lv${u.level}<br>HP ${u.hp}/${u.def.hp} · 공 ${b.stat(u, 0)} 방 ${b.stat(u, 1)} 마공 ${b.stat(u, 2)} 마방 ${b.stat(u, 3)} 속 ${b.stat(u, 4)} · 이동 ${u.def.move} 사정 ${u.def.range}<br><span class="muted">${u.moved ? '이동 완료' : '이동 가능'} · ${u.acted ? '행동 완료' : '행동 가능'}</span>`; }
    else ui.innerHTML = '<span class="muted">유닛을 클릭하세요</span>';
    ui.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait);
    const my = s.side === 0 && s.winner < 0;
    sm.innerHTML = b.natials.map((n, i) => `<button data-i="${i}" class="${i === summonIdx ? 'sel' : ''}" ${!my || n.cost > s.mp[0] || !b!.summonCells(0, n).length ? 'disabled' : ''} title="HP ${n.hp} 공 ${n.stats[0][0]} 방 ${n.stats[1][0]} 이동 ${n.move} 사정 ${n.range}"><span class="e${n.element}">${ELEMENT[n.element]?.[0] ?? ''}</span> ${n.name} ${n.cost}</button>`).join('');
    sm.querySelectorAll<HTMLButtonElement>('button').forEach((bt) => { bt.onclick = () => { summonIdx = summonIdx === +bt.dataset.i! ? -1 : +bt.dataset.i!; sel = null; refresh(); draw(); };
      bt.onmouseenter = () => { if (sel) return; const n = b!.natials[+bt.dataset.i!]; ui.innerHTML = `${portraitHtml(n.id)}<b>${n.name}</b> <span class="e${n.element}">${ELEMENT[n.element] ?? ''}</span><br>HP ${n.hp} · 공 ${n.stats[0][0]}/${n.stats[0][1]}/${n.stats[0][2]} 방 ${n.stats[1][0]}/${n.stats[1][1]}/${n.stats[1][2]}<br>이동 ${n.move} 사정 ${n.range} · MP ${n.cost}`; ui.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait); }; });
    $('bLog').textContent = s.log.slice(-14).join('\n'); $('bLog').scrollTop = 1e6;
  }

  // --- input (mouse + trackpad) ---
  const toWorld = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left + cam.x) / cam.z, y: (e.clientY - r.top + cam.y) / cam.z }; };
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onpointerdown = (e) => {
    if (e.button === 2) { sel = null; summonIdx = -1; refresh(); draw(); return; }
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (drag) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true; if (drag.moved) { cam.x = drag.cx - (e.clientX - drag.x); cam.y = drag.cy - (e.clientY - drag.y); draw(); return; } }
    if (!ts || !grid) return; const p = toWorld(e); hover = pickCell(ts, grid, p.x, p.y); draw();
  };
  canvas.onpointerup = (e) => {
    const d = drag; drag = null; if (!d || d.moved || e.button !== 0) return;
    if (!b || !ts || !grid || busy) return;
    const p = toWorld(e); const cell = pickCell(ts, grid, p.x, p.y); if (!cell) return;
    const s = b.s; if (s.side !== 0 || s.winner >= 0) return;
    const u = b.unitAt(cell.r, cell.c); let err: string | null = null;
    const n0 = b.s.log.length;
    if (summonIdx >= 0) { err = b.summon(summonIdx, cell.r, cell.c); if (!err) { summonIdx = -1; deps.sfx.role('summon'); } }
    else if (sel && u && u.side !== 0 && !sel.acted && b.targetsFrom(sel, sel.r, sel.c).includes(u)) { const atk = sel; err = b.attack(sel.uid, u.uid); if (!err) { facing.set(atk.uid, dirOf(atk, u)); facing.set(u.uid, dirOf(u, atk)); const ax = atk.c + (atk.r & 1) * 0.5, ux = u.c + (u.r & 1) * 0.5; attackAnim.set(atk.uid, { t0: performance.now(), dx: Math.sign(ux - ax), dy: Math.sign(u.r - atk.r) }); kickAnim(); const killed = b.s.log.slice(n0).some((l) => l.includes('격파')); if (!deps.sfx.attack(atk.def.id, masterIdx[0])) deps.sfx.role('attack'); if (killed) setTimeout(() => deps.sfx.role('kill'), 600); } if (sel.hp <= 0) sel = null; }
    else if (sel && !u && !sel.moved && b.reachable(sel).has(key(cell.r, cell.c))) { const from = { r: sel.r, c: sel.c }; err = b.move(sel.uid, cell.r, cell.c); if (!err) facing.set(sel.uid, dirOf(from, cell)); }
    else if (u && u.side === 0) { sel = u; deps.sfx.role('select'); if (!u.moved && b.reachable(u).size <= 1) b.log(`! ${u.def.name}: 갈 수 있는 칸이 없음`); }
    else sel = null;
    if (err) b.log(`! ${err}`);
    refresh(); draw();
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const wx = (mx + cam.x) / cam.z, wy = (my + cam.y) / cam.z; cam.z = Math.min(4, Math.max(0.5, cam.z * Math.exp(-e.deltaY * 0.01))); cam.x = wx * cam.z - mx; cam.y = wy * cam.z - my; }
    else { cam.x += e.deltaX; cam.y += e.deltaY; }
    draw();
  };
  window.addEventListener('resize', () => { if (!$('tab-battle').classList.contains('hidden')) fit(); });
  $('bFit').onclick = fit;

  return { populate, onShow: () => { populate(); fit(); } };
}
