import { type VM2Data, type MapInfo, type Natial, type Tileset, TERRAIN, ELEMENT, TILE_H } from './vm2data';
import { TileRenderer, drawMap, worldSize, pickCell, cellOrigin, hexPath } from './render';
import { Battle, reachableFrom, masterDef, dirOf, type UnitDef, type Unit, type Terrain } from './battle/engine';
import { botAct } from './battle/bot';
import { key, dist, type Cell } from './battle/hex';
import { RULES, clockText, lightAt } from './battle/rules';
import type { Sfx } from './sound';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface BattleDeps { data: () => VM2Data | null; natials: () => Natial[]; mapGrid: (m: MapInfo) => Uint16Array; mapTileset: (m: MapInfo) => Tileset; mapName: (m: MapInfo) => string; portrait: (k: number) => HTMLCanvasElement | null; sfx: Sfx; sprite: (defId: string, side: 0 | 1, frame: number) => HTMLCanvasElement | null; masterSprite: (m: number, side: 0 | 1, frame: number) => HTMLCanvasElement | null; bgm: () => void; bgmStop: () => void }

export function initBattle(deps: BattleDeps) {
  const canvas = $<HTMLCanvasElement>('bmap'), wrap = $('bwrap'), g = canvas.getContext('2d')!;
  const world = document.createElement('canvas'); const ws = worldSize(); world.width = ws.w; world.height = ws.h; const wg = world.getContext('2d')!;
  const cam = { x: 0, y: 0, z: 2 };
  let b: Battle | null = null, ts: Tileset | null = null, grid: Uint16Array | null = null, rend: TileRenderer | null = null;
  let summonIdx = -1, magicMode = false, hover: Cell | null = null, busy = false; let masterIdx: [number, number] = [0, 1];
  const attackAnim = new Map<number, { t0: number; dx: number; dy: number }>();
  const pops: { uid: number; text: string; t0: number }[] = [];
  const active = () => b?.activeUnit() ?? null;
  const mine = () => { const u = active(); return u && u.side === 0 && b!.s.winner < 0 ? u : null; };

  function popDamage(n0: number) {
    for (const line of b!.s.log.slice(n0)) { const hit = /^(.+?) → (.+?) (\d+) 피해/.exec(line); if (!hit) continue; const t = b!.s.units.find((u) => u.def.name === hit[2]); if (t) pops.push({ uid: t.uid, text: hit[3], t0: performance.now() }); }
    if (pops.length) kickAnim();
  }
  function frameOf(u: Unit): number {
    const an = attackAnim.get(u.uid); if (!an) return u.facing * 3;
    const age = performance.now() - an.t0; if (age > 700) { attackAnim.delete(u.uid); return u.facing * 3; }
    return u.facing * 3 + (age < 250 ? 1 : 2);
  }
  function animOffset(u: Unit): { x: number; y: number } {
    const an = attackAnim.get(u.uid); if (!an) return { x: 0, y: 0 }; const age = performance.now() - an.t0; const k = age < 250 ? age / 250 : age < 500 ? 1 : Math.max(0, 1 - (age - 500) / 200);
    return { x: an.dx * 10 * k, y: an.dy * 6 * k };
  }
  let blinkTick = 0; const blinkOn = () => blinkTick % 9 === 0;
  setInterval(() => { if (!b || $('tab-battle').classList.contains('hidden')) return; const was = blinkOn(); blinkTick++; if (was !== blinkOn()) draw(); }, 120);
  let animTimer = 0; const kickAnim = () => { clearInterval(animTimer); animTimer = window.setInterval(() => { const now = performance.now(); for (let i = pops.length - 1; i >= 0; i--) if (now - pops[i].t0 > 1100) pops.splice(i, 1); if (!attackAnim.size && !pops.length) { clearInterval(animTimer); return; } draw(); }, 50); };

  const toUnitDef = (n: Natial): UnitDef => ({ id: `n${n.index}`, name: n.name, stats: n.stats, move: n.move, element: n.element, range: Math.max(1, n.range), moveType: Math.min(4, n.moveType), cost: n.cost, upkeep: Math.round(n.hp / RULES.upkeepDiv), spell: n.spell, light: n.flag1 });

  function populate() {
    const d = deps.data(); if (!d) return;
    $<HTMLSelectElement>('bMap').innerHTML = d.maps.map((m) => `<option value="${m.index}">${m.index} ${deps.mapName(m)}</option>`).join('');
    const opts = d.masters.map((m) => `<option value="${m.index}">${m.name}</option>`).join('');
    $<HTMLSelectElement>('bM0').innerHTML = opts; $<HTMLSelectElement>('bM1').innerHTML = opts; $<HTMLSelectElement>('bM1').selectedIndex = Math.min(1, d.masters.length - 1);
  }
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
    (window as unknown as { __battle: Battle; __cam: typeof cam }).__battle = b; (window as unknown as { __cam: typeof cam }).__cam = cam; summonIdx = -1; magicMode = false; $('bsetup').classList.add('hidden');
    wg.clearRect(0, 0, ws.w, ws.h); drawMap(wg, rend, grid); fit(); refresh(); deps.bgm(); runBots();
  };
  $('bQuit').onclick = () => { b = null; deps.bgmStop(); $('bsetup').classList.remove('hidden'); refresh(); draw(); };
  $('bEnd').onclick = () => { const u = mine(); if (!u || busy) return; const err = b!.wait(u.uid); if (err) b!.log(`! ${err}`); else deps.sfx.role('turn'); afterAction(); };
  $('bMagic').onclick = () => { const u = mine(); if (!u || !u.def.spell) return; magicMode = !magicMode; summonIdx = -1; refresh(); draw(); };

  /** let the bot play every unit of side 1 until one of ours is active (with small delays so it can be followed) */
  async function runBots() {
    if (busy) return; busy = true;
    while (b && b.s.winner < 0 && active() && active()!.side === 1) {
      await new Promise((r) => setTimeout(r, 350));
      if (!b) break; const u = active()!; const n0 = b.s.log.length; const before = { r: u.r, c: u.c };
      botAct(b);
      const added = b.s.log.slice(n0); const hitLine = added.find((l) => l.includes('피해'));
      if (hitLine) { const tn = /→ (.+?) \d+ 피해/.exec(hitLine)?.[1]; const t = b.s.units.find((x) => x.def.name === tn); if (t) { const ax = u.c + (u.r & 1) * 0.5, tx = t.c + (t.r & 1) * 0.5; attackAnim.set(u.uid, { t0: performance.now(), dx: Math.sign(tx - ax), dy: Math.sign(t.r - u.r) }); kickAnim(); } if (!deps.sfx.attack(u.def.id, masterIdx[1])) deps.sfx.role('attack'); popDamage(n0); if (added.some((l) => l.includes('격파'))) setTimeout(() => deps.sfx.role('kill'), 600); }
      else if (added.some((l) => l.includes('소환'))) deps.sfx.role('summon');
      if (u.r !== before.r || u.c !== before.c) panTo(u);
      refresh(); draw();
    }
    busy = false; const u = active(); if (u && u.side === 0) { panTo(u); deps.sfx.role('select'); } refresh(); draw();
  }
  function afterAction() { summonIdx = -1; magicMode = false; refresh(); draw(); void runBots(); }
  function panTo(u: Unit) { if (!ts || !grid) return; const p = center(u.r, u.c); const sx = p.x * cam.z - cam.x, sy = p.y * cam.z - cam.y; if (sx < 60 || sy < 60 || sx > canvas.width - 60 || sy > canvas.height - 60) { cam.x = p.x * cam.z - canvas.width / 2; cam.y = p.y * cam.z - canvas.height / 2; } }

  function fit() {
    canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; cam.z = 2;
    const u = b && ts && grid ? (active() ?? b.master(0)) : null; const m = u ? center(u.r, u.c) : { x: ws.w / 2, y: ws.h / 2 };
    cam.x = m.x * cam.z - canvas.width / 2; cam.y = m.y * cam.z - canvas.height / 2; draw();
  }
  const center = (r: number, c: number) => { const o = cellOrigin(r, c); const h = ts!.defs[grid![r * 32 + c]].height; return { x: o.x + 24, y: o.base - 18 - 12 * h }; };
  const fillHex = (r: number, c: number, style: string) => { const p = center(r, c); hexPath(g, p.x, p.y); g.fillStyle = style; g.fill(); };

  function draw() {
    g.imageSmoothingEnabled = false; g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (!b || !ts || !grid) return;
    g.save(); g.translate(-cam.x, -cam.y); g.scale(cam.z, cam.z); g.drawImage(world, 0, 0);
    const L = lightAt(b.s.clock); if (L) { g.fillStyle = L === 2 ? 'rgba(10,15,50,.45)' : 'rgba(40,20,50,.2)'; g.fillRect(cam.x / cam.z, cam.y / cam.z, canvas.width / cam.z, canvas.height / cam.z); }
    for (const k of Object.keys(b.s.stones)) { const r = Math.floor(+k / 32), c = +k % 32; const own = b.s.stones[+k]; const p = center(r, c); hexPath(g, p.x, p.y); g.lineWidth = 1.5; g.strokeStyle = own === 0 ? '#4af' : own === 1 ? '#f66' : '#ee4'; g.stroke(); }
    const u0 = mine();
    const lit: { r: number; c: number }[] = u0 && !summonIdx && summonIdx < 0 && !magicMode ? [...b.reachable(u0).values()] : [];
    const tg = u0 ? (magicMode ? b.magicTargets(u0) : b.targetsFrom(u0, u0.r, u0.c)) : [];
    const sc = u0 && summonIdx >= 0 ? b.summonCells(0, b.natials[summonIdx]) : [];
    if (lit.length || tg.length || sc.length) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(cam.x / cam.z, cam.y / cam.z, canvas.width / cam.z, canvas.height / cam.z);
      const cells = [...lit, ...tg.map((t) => ({ r: t.r, c: t.c })), ...sc]; cells.sort((a, c) => a.r - c.r || a.c - c.c);
      for (const cell of cells) { const o = cellOrigin(cell.r, cell.c); g.drawImage(rend!.tile(grid[cell.r * 32 + cell.c]), o.x, o.base - TILE_H); }
      for (const t of tg) fillHex(t.r, t.c, magicMode ? 'rgba(120,255,160,.4)' : 'rgba(255,60,60,.35)');
      for (const p of sc) fillHex(p.r, p.c, 'rgba(80,255,120,.35)');
    }
    const act = active();
    for (const u of b.alive().sort((x, y) => x.r - y.r || x.c - y.c)) {
      const p = center(u.r, u.c); const fr = frameOf(u); const off = animOffset(u); p.x += off.x; p.y += off.y;
      const sp = u.def.master ? deps.masterSprite(masterIdx[u.side], u.side, fr) : deps.sprite(u.def.id, u.side, fr);
      const isActive = u === act;
      if (sp) {
        g.beginPath(); g.ellipse(p.x, p.y + 4, 16, 8, 0, 0, Math.PI * 2); g.fillStyle = isActive ? 'rgba(255,255,255,.6)' : u.side === 0 ? 'rgba(60,120,255,.45)' : 'rgba(255,70,70,.45)'; g.fill();
        if (isActive && blinkOn()) g.globalAlpha = 0.45;
        g.drawImage(sp, p.x - 48, p.y + 8 - (+(sp.dataset.bottom ?? 90))); g.globalAlpha = 1;
        if (u.def.master) { g.lineWidth = 2; g.strokeStyle = '#ffd24a'; g.beginPath(); g.ellipse(p.x, p.y + 4, 17, 9, 0, 0, Math.PI * 2); g.stroke(); }
      } else {
        g.beginPath(); g.arc(p.x, p.y, u.def.master ? 13 : 11, 0, Math.PI * 2); g.fillStyle = u.side === 0 ? '#2a6fd6' : '#d63a3a'; g.fill();
        g.lineWidth = isActive ? 3 : 1.5; g.strokeStyle = u.def.master ? '#ffd24a' : isActive ? '#fff' : '#000'; g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(u.def.master ? 'M' : (ELEMENT[u.def.element]?.[0] ?? '?'), p.x, p.y);
      }
      // HP as 10 pips like the game's bar
      for (let i = 0; i < RULES.hp; i++) { g.fillStyle = i < u.hp ? (u.hp > 5 ? '#ffd24a' : u.hp > 2 ? '#f90' : '#e44') : '#333'; g.fillRect(p.x - 15 + i * 3, p.y + 13, 2, 3); }
      if (u.level > 1) { g.fillStyle = '#ffd24a'; g.font = 'bold 9px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`L${u.level}`, p.x + 16, p.y + 11); }
    }
    for (const pp of pops) { const u = b.unit(pp.uid); if (!u) continue; const age = performance.now() - pp.t0; if (age < 0) continue; const p = center(u.r, u.c); const y = p.y - 40 - Math.min(age, 300) / 300 * 14;
      g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(pp.text, p.x, y); g.fillStyle = '#fff'; g.fillText(pp.text, p.x, y); }
    if (hover) { const p = center(hover.r, hover.c); hexPath(g, p.x, p.y); g.lineWidth = 1; g.strokeStyle = '#ff0'; g.stroke(); const d = ts.defs[grid[hover.r * 32 + hover.c]]; const u = b.unitAt(hover.r, hover.c);
      let extra = ''; if (u && u0 && u.side !== 0) { const can = magicMode ? b.magicTargets(u0).includes(u) : b.targetsFrom(u0, u0.r, u0.c).includes(u); if (can) extra = ` · 예상 피해 ${b.damage(u0, u, magicMode)}`; }
      $('bhud').textContent = `(${hover.r},${hover.c}) ${TERRAIN[d.terrain] ?? d.terrain} 높이 ${d.height} 방어 ${RULES.terrainDef[d.terrain] ?? 0}%${u ? ` · ${u.def.name} HP ${u.hp} OA ${u.oa}` : ''}${extra}`; }
    g.restore();
  }

  const portraitHtml = (id: string) => (id.startsWith('n') && deps.portrait(+id.slice(1)) ? `<div class="pbox" data-k="${id.slice(1)}"></div>` : '');
  function mountPortrait(box: HTMLElement) { const c = deps.portrait(+box.dataset.k!); if (!c) return; const t = document.createElement('canvas'); const h = 150; t.height = h; t.width = Math.round(c.width * h / c.height); t.getContext('2d')!.drawImage(c, 0, 0, t.width, h); box.appendChild(t); }
  const unitHtml = (u: Unit) => `${portraitHtml(u.def.id)}<b>${u.def.name}</b> <span class="e${u.def.element}">${ELEMENT[u.def.element] ?? ''}</span> Lv${u.level}${u.def.light ? ` <span class="muted small">${u.def.light === 1 ? '주간형' : '야간형'}</span>` : ''}<br>♥ ${u.hp}/${RULES.hp} · ⚔${b!.stat(u, 0)} 🛡${b!.stat(u, 1)} ✨${b!.stat(u, 2)} 🔰${b!.stat(u, 3)} 👢${b!.stat(u, 4)} · 이동 ${u.def.move}${u.def.range > 1 ? ` 사정 ${u.def.range}` : ''}${u.def.spell ? ' · 마법' : ''}<br><span class="muted">⏳ OA ${u.oa} · 유지 ${u.def.upkeep}</span>`;
  function refresh() {
    const info = $('bInfo'), ui = $('bUnit'), sm = $('bSummon');
    if (!b) { info.textContent = ''; ui.textContent = ''; sm.innerHTML = ''; $('bLog').textContent = ''; $('bOrder').innerHTML = ''; return; }
    const s = b.s; const st = (side: 0 | 1) => Object.values(s.stones).filter((o) => o === side).length; const L = lightAt(s.clock);
    const act = active();
    info.innerHTML = `${s.winner >= 0 ? `<b style="color:var(--acc)">${s.names[s.winner as 0 | 1]} 승리!</b> · ` : ''}🕒 <b>${clockText(s.clock)}</b> ${L === 0 ? '☀ 낮' : L === 2 ? '🌙 밤' : '🌤 어스름'}${act ? ` · <b>${act.def.name}</b>${act.side === 0 ? ' (내 차례)' : ' (봇)'}` : ''}<br><span class="e2">${s.names[0]}</span> MP ${s.mp[0]}/${s.mpMax[0]} 석 ${st(0)} · <span class="e3">${s.names[1]}</span> MP ${s.mp[1]}/${s.mpMax[1]} 석 ${st(1)}`;
    $('bOrder').innerHTML = b.order(8).map(({ u, at }) => `<span class="ord ${u.side === 0 ? 'e2' : 'e3'}${u === act ? ' now' : ''}" title="${u.def.name}">${u.def.name.slice(0, 4)}<small>${clockText(at)}</small></span>`).join('');
    ui.innerHTML = act ? unitHtml(act) : '<span class="muted">…</span>'; ui.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait);
    const me = mine(); const canSummon = !!me && !!me.def.master;
    sm.innerHTML = b.natials.map((n, i) => { const cost = b!.summonCost(n); return `<button data-i="${i}" class="${i === summonIdx ? 'sel' : ''}" ${!canSummon || cost > s.mp[0] || !b!.summonCells(0, n).length ? 'disabled' : ''} title="⚔${n.stats[0][0]} 🛡${n.stats[1][0]} ✨${n.stats[2][0]} 🔰${n.stats[3][0]} 👢${n.stats[4][0]} 이동 ${n.move} 유지 ${n.upkeep}/시간"><span class="e${n.element}">${ELEMENT[n.element]?.[0] ?? ''}</span> ${n.name} ${cost}</button>`; }).join('');
    sm.querySelectorAll<HTMLButtonElement>('button').forEach((bt) => { bt.onclick = () => { summonIdx = summonIdx === +bt.dataset.i! ? -1 : +bt.dataset.i!; magicMode = false; refresh(); draw(); };
      bt.onmouseenter = () => { const n = b!.natials[+bt.dataset.i!]; ui.innerHTML = `${portraitHtml(n.id)}<b>${n.name}</b> <span class="e${n.element}">${ELEMENT[n.element] ?? ''}</span>${n.light ? ` <span class="muted small">${n.light === 1 ? '주간형' : '야간형'}</span>` : ''}<br>⚔${n.stats[0].join('/')} 🛡${n.stats[1].join('/')} ✨${n.stats[2].join('/')} 🔰${n.stats[3].join('/')} 👢${n.stats[4].join('/')}<br>이동 ${n.move} 사정 ${n.range}${n.spell ? ' · 마법' : ''} · 소환 ${b!.summonCost(n)} MP · 유지 ${n.upkeep}/시간`; ui.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait); };
      bt.onmouseleave = () => { ui.innerHTML = act ? unitHtml(act) : ''; ui.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait); }; });
    $<HTMLButtonElement>('bMagic').disabled = !me || !me.def.spell; $('bMagic').classList.toggle('sel', magicMode);
    $<HTMLButtonElement>('bEnd').disabled = !me;
    $('bLog').textContent = s.log.slice(-14).join('\n'); $('bLog').scrollTop = 1e6;
  }

  // --- input ---
  const toWorld = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left + cam.x) / cam.z, y: (e.clientY - r.top + cam.y) / cam.z }; };
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onpointerdown = (e) => {
    if (e.button === 2) { summonIdx = -1; magicMode = false; refresh(); draw(); return; }
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
    const me = mine(); if (!me) return;
    const u = b.unitAt(cell.r, cell.c); let err: string | null = null; const n0 = b.s.log.length; let acted = false;
    if (summonIdx >= 0) { err = b.summon(summonIdx, cell.r, cell.c); if (!err) { deps.sfx.role('summon'); acted = true; } }
    else if (u && u.side !== 0 && (magicMode ? b.magicTargets(me).includes(u) : b.targetsFrom(me, me.r, me.c).includes(u))) {
      const ax = me.c + (me.r & 1) * 0.5, ux = u.c + (u.r & 1) * 0.5;
      err = magicMode ? b.magic(me.uid, u.uid) : b.attack(me.uid, u.uid);
      if (!err) { attackAnim.set(me.uid, { t0: performance.now(), dx: Math.sign(ux - ax), dy: Math.sign(u.r - me.r) }); kickAnim(); if (!deps.sfx.attack(me.def.id, masterIdx[0])) deps.sfx.role('attack'); if (b.s.log.slice(n0).some((l) => l.includes('격파'))) setTimeout(() => deps.sfx.role('kill'), 600); popDamage(n0); acted = true; }
    }
    else if (!u && b.reachable(me).has(key(cell.r, cell.c))) { err = b.move(me.uid, cell.r, cell.c); }
    else if (u && u.side !== 0 && dist(me, u) > 1) err = magicMode ? '마법 사정거리 밖' : '사정거리 밖';
    if (err) b.log(`! ${err}`);
    if (acted) afterAction(); else { refresh(); draw(); }
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const wx = (mx + cam.x) / cam.z, wy = (my + cam.y) / cam.z; cam.z = Math.min(4, Math.max(0.5, cam.z * Math.exp(-e.deltaY * 0.01))); cam.x = wx * cam.z - mx; cam.y = wy * cam.z - my; }
    else { cam.x += e.deltaX; cam.y += e.deltaY; }
    draw();
  };
  window.addEventListener('resize', () => { if (!$('tab-battle').classList.contains('hidden')) fit(); });
  $('bFit').onclick = fit;
  void dirOf;
  return { populate, onShow: () => { populate(); fit(); } };
}
