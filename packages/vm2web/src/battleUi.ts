import { type VM2Data, type MapInfo, type Natial, type Tileset, TERRAIN, ELEMENT } from './vm2data';
import { TileRenderer, drawMap, worldSize, pickCell, cellOrigin, hexPath } from './render';
import { Battle, reachableFrom, masterDef, dirOf, type UnitDef, type Unit, type Terrain } from './battle/engine';
import { botAct } from './battle/bot';
import { key, dist, type Cell } from './battle/hex';
import { RULES, clockText, lightAt } from './battle/rules';
import type { Sfx } from './sound';
import type { Facing } from './facing';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface BattleDeps { data: () => VM2Data | null; natials: () => Natial[]; mapGrid: (m: MapInfo) => Uint16Array; mapTileset: (m: MapInfo) => Tileset; mapName: (m: MapInfo) => string; portrait: (k: number) => HTMLCanvasElement | null; sfx: Sfx; sprite: (defId: string, side: 0 | 1, frame: number) => HTMLCanvasElement | null; masterSprite: (m: number, side: 0 | 1, frame: number) => HTMLCanvasElement | null; walk: (defId: string, side: 0 | 1, frame: number, masterIdx: number) => HTMLCanvasElement | null; effect: (entry: number, frame: number) => HTMLCanvasElement | null; facing: Facing; bgm: () => void; bgmStop: () => void }

export function initBattle(deps: BattleDeps) {
  const canvas = $<HTMLCanvasElement>('bmap'), wrap = $('bwrap'), g = canvas.getContext('2d')!;
  const world = document.createElement('canvas'); const ws = worldSize(); world.width = ws.w; world.height = ws.h; const wg = world.getContext('2d')!;
  const cam = { x: 0, y: 0, z: 2 };
  let b: Battle | null = null, ts: Tileset | null = null, grid: Uint16Array | null = null, rend: TileRenderer | null = null;
  let summonIdx = -1, magicMode = false, hover: Cell | null = null, busy = false; let masterIdx: [number, number] = [0, 1];
  const attackAnim = new Map<number, { t0: number; dx: number; dy: number }>();
  const pops: { uid: number; text: string; t0: number }[] = [];
  const STEP_MS = 170, SUMMON_MS = 1000, SUMMON_FX = 162;
  const walkAnim = new Map<number, { path: Cell[]; t0: number }>();
  const summonAnim = new Map<number, { t0: number }>();
  const STONE_MS = 1100; const stoneAnim = new Map<number, { t0: number; side: 0 | 1 }>();
  const stonesSnap = () => ({ ...b!.s.stones });
  /** flag stones whose owner changed since `before` (animated after `delay` ms, e.g. once the walk ends) */
  function noteStones(before: Record<number, number>, delay = 0) {
    for (const k of Object.keys(b!.s.stones)) { const o = b!.s.stones[+k]; if (o !== before[+k] && o >= 0) { stoneAnim.set(+k, { t0: now() + delay, side: o as 0 | 1 }); kickAnim(); } }
    if (delay) setTimeout(() => deps.sfx.role('turn'), delay);
  }
  const now = () => performance.now();
  /** start the walk animation for a unit that just moved along b.lastPath; returns its duration */
  function startWalk(u: Unit, delay = 0): number {
    const path = b!.lastPath; b!.lastPath = [];
    if (path.length < 2) return 0; walkAnim.set(u.uid, { path, t0: now() + delay }); kickAnim(); return (path.length - 1) * STEP_MS;
  }
  function startSummon(n0: number, delay = 0) {
    for (const u of b!.s.units) if (!u.def.master && !summonAnim.has(u.uid) && u.uid >= n0) { summonAnim.set(u.uid, { t0: now() + delay }); kickAnim(); }
  }
  const active = () => b?.activeUnit() ?? null;
  const mine = () => { const u = active(); return u && u.side === 0 && b!.s.winner < 0 ? u : null; };

  function noteDeaths(before: Unit[], delay = 0) { for (const u of before) if (u.hp <= 0 && !deaths.has(u.uid)) { deaths.set(u.uid, { t0: now() + delay, r: u.r, c: u.c, side: u.side, id: u.def.id, facing: u.facing }); kickAnim(); } }
  function popDamage(n0: number, delay = 0) {
    for (const line of b!.s.log.slice(n0)) { const hit = /^(.+?) → (.+?) (\d+) 피해/.exec(line); if (!hit) continue; const t = b!.s.units.find((u) => u.def.name === hit[2]); if (t) pops.push({ uid: t.uid, text: hit[3], t0: now() + delay }); }
    if (pops.length) kickAnim();
  }
  function frameOf(u: Unit): number {
    const an = attackAnim.get(u.uid); if (!an) return -1; // -1: use the walk cycle
    const age = now() - an.t0; if (age < 0) return -1; const g0 = deps.facing.poseGroupFor(u.facing) * 3;
    if (age > 700) { attackAnim.delete(u.uid); return g0; }
    return g0 + (age < 250 ? 1 : 2);
  }
  function animOffset(u: Unit): { x: number; y: number } {
    const an = attackAnim.get(u.uid); if (!an) return { x: 0, y: 0 }; const age = now() - an.t0; if (age < 0) return { x: 0, y: 0 }; const k = age < 250 ? age / 250 : age < 500 ? 1 : Math.max(0, 1 - (age - 500) / 200);
    return { x: an.dx * 10 * k, y: an.dy * 6 * k };
  }
  let blinkTick = 0; const blinkOn = () => blinkTick % 9 === 0;
  const deaths = new Map<number, { t0: number; r: number; c: number; side: 0 | 1; id: string; facing: number }>();
  setInterval(() => { if (!b || $('tab-battle').classList.contains('hidden')) return; blinkTick++; draw(); }, 120);
  let animTimer = 0; const kickAnim = () => { clearInterval(animTimer); animTimer = window.setInterval(() => { const t = now(); for (let i = pops.length - 1; i >= 0; i--) if (t - pops[i].t0 > 1100) pops.splice(i, 1); for (const [k, d] of deaths) if (t - d.t0 > 1400) deaths.delete(k); for (const [k, w] of walkAnim) if (t - w.t0 > (w.path.length - 1) * STEP_MS) walkAnim.delete(k); for (const [k, w] of summonAnim) if (t - w.t0 > SUMMON_MS) summonAnim.delete(k); for (const [k, w] of stoneAnim) if (t - w.t0 > STONE_MS) stoneAnim.delete(k); stepCam(); if (!attackAnim.size && !pops.length && !deaths.size && !walkAnim.size && !summonAnim.size && !stoneAnim.size && !camAnim) { clearInterval(animTimer); return; } draw(); }, 50); };

  const toUnitDef = (n: Natial): UnitDef => ({ id: `n${n.index}`, name: n.name, stats: n.stats, move: n.move, element: n.element, range: Math.max(1, n.range), moveType: Math.min(4, n.moveType), cost: n.cost, upkeep: Math.round(n.hp / RULES.upkeepDiv), spell: n.spell, light: n.flag1 });

  function populate() {
    const d = deps.data(); if (!d) return;
    $<HTMLSelectElement>('bMap').innerHTML = d.maps.map((m) => `<option value="${m.index}">${m.index} ${deps.mapName(m)}</option>`).join('');
    $<HTMLSelectElement>('bMap').onchange = () => { const m = d.maps[+$<HTMLSelectElement>('bMap').value]; const em = m.header.nums[11]; if (em >= 0 && em < d.masters.length) $<HTMLSelectElement>('bM1').value = `${d.masters[em].index}`; };
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
    b = new Battle(terrain, nats.map(toUnitDef), [findStart(terrain, { r: 5, c: 5 }), findStart(terrain, { r: 26, c: 26 })], [n0.selectedOptions[0].text, n1.selectedOptions[0].text], m.header.nums[3] >= 0 && m.header.nums[3] < 1440 ? m.header.nums[3] : RULES.startClock);
    (window as unknown as { __battle: Battle; __cam: typeof cam }).__battle = b; (window as unknown as { __cam: typeof cam }).__cam = cam; (window as unknown as { __cellScreen: (r: number, c: number) => { x: number; y: number } }).__cellScreen = (r, c) => { const p = center(r, c); return { x: p.x * cam.z - cam.x, y: p.y * cam.z - cam.y }; }; summonIdx = -1; magicMode = false; $('bsetup').classList.add('hidden');
    wg.clearRect(0, 0, ws.w, ws.h); drawMap(wg, rend, grid); fit(); refresh(); deps.bgm(); runBots();
  };
  $('bQuit').onclick = () => { b = null; deps.bgmStop(); $('bsetup').classList.remove('hidden'); refresh(); draw(); };
  $('bEnd').onclick = () => { const u = mine(); if (!u || busy) return; const err = b!.wait(u.uid); if (err) b!.log(`! ${err}`); else deps.sfx.role('turn'); afterAction(); };
  $('bMagic').onclick = () => { const u = mine(); if (!u || !u.def.spell) return; magicMode = !magicMode; summonIdx = -1; refresh(); draw(); };

  /** let the bot play every unit of side 1 until one of ours is active (with small delays so it can be followed) */
  async function runBots() {
    if (busy) return; busy = true;
    while (b && b.s.winner < 0 && active() && active()!.side === 1) {
      // the camera travels to the unit first; it acts only once it is on screen
      refresh(); draw(); await panTo(active()!); await new Promise((r) => setTimeout(r, 250));
      if (!b || !active() || active()!.side !== 1) break; const u = active()!; const n0 = b.s.log.length; const uid0 = b.s.nextUid; const before = { r: u.r, c: u.c }; const aliveBefore = b.alive(); const stonesBefore = stonesSnap();
      botAct(b); const walkMs = startWalk(u); noteDeaths(aliveBefore, walkMs); noteStones(stonesBefore, walkMs);
      const added = b.s.log.slice(n0); const hitLine = added.find((l) => l.includes('피해'));
      if (hitLine) { const tn = /→ (.+?) \d+ 피해/.exec(hitLine)?.[1]; const t = b.s.units.find((x) => x.def.name === tn); if (t) { const ax = u.c + (u.r & 1) * 0.5, tx = t.c + (t.r & 1) * 0.5; attackAnim.set(u.uid, { t0: now() + walkMs, dx: Math.sign(tx - ax), dy: Math.sign(t.r - u.r) }); kickAnim(); } setTimeout(() => { if (!deps.sfx.attack(u.def.id, masterIdx[1])) deps.sfx.role('attack'); }, walkMs); popDamage(n0, walkMs); if (added.some((l) => l.includes('격파'))) setTimeout(() => deps.sfx.role('kill'), walkMs + 600); }
      else if (added.some((l) => l.includes('소환'))) { deps.sfx.role('summon'); startSummon(uid0); }
      refresh(); draw();
      if (walkMs) { await new Promise((r) => setTimeout(r, walkMs)); await panTo(u); }
      if (hitLine) await new Promise((r) => setTimeout(r, 500));
    }
    busy = false; const u = active(); if (u && u.side === 0) { void panTo(u); deps.sfx.role('select'); } refresh(); draw();
  }
  function afterAction() { summonIdx = -1; magicMode = false; refresh(); draw(); void runBots(); }
  /** smooth camera: glide to centre a unit; resolves when it arrives (immediately if already centred) */
  let camAnim: { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; done: () => void } | null = null;
  function panTo(u: Unit): Promise<void> {
    if (!ts || !grid) return Promise.resolve(); const p = center(u.r, u.c); const x1 = p.x * cam.z - canvas.width / 2, y1 = p.y * cam.z - canvas.height / 2;
    const d = Math.hypot(x1 - cam.x, y1 - cam.y); if (d < 24) { camAnim = null; return Promise.resolve(); }
    const dur = Math.min(700, 220 + d * 0.5);
    return new Promise((done) => { camAnim = { x0: cam.x, y0: cam.y, x1, y1, t0: now(), dur, done }; kickAnim(); });
  }
  function stepCam() {
    if (!camAnim) return; const k = Math.min(1, (now() - camAnim.t0) / camAnim.dur); const e = 1 - Math.pow(1 - k, 3);
    cam.x = camAnim.x0 + (camAnim.x1 - camAnim.x0) * e; cam.y = camAnim.y0 + (camAnim.y1 - camAnim.y0) * e;
    if (k >= 1) { const f = camAnim.done; camAnim = null; f(); }
  }

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
    const tNow = now();
    for (const k of Object.keys(b.s.stones)) { const r = Math.floor(+k / 32), c = +k % 32; const own = b.s.stones[+k]; const p = center(r, c); const col = own === 0 ? '#4af' : own === 1 ? '#f66' : '#ee4';
      const sa = stoneAnim.get(+k); const age = sa ? tNow - sa.t0 : -1; const k1 = age >= 0 ? Math.min(1, age / STONE_MS) : 1;
      if (own >= 0) { hexPath(g, p.x, p.y); g.fillStyle = own === 0 ? `rgba(60,140,255,${age >= 0 ? 0.22 + 0.4 * (1 - k1) : 0.22})` : `rgba(255,80,80,${age >= 0 ? 0.22 + 0.4 * (1 - k1) : 0.22})`; g.fill(); }
      hexPath(g, p.x, p.y); g.lineWidth = 1.5; g.strokeStyle = col; g.stroke();
      if (age >= 0 && k1 < 1) { for (let ring = 0; ring < 2; ring++) { const kk = Math.max(0, k1 - ring * 0.25) / 0.75; if (kk <= 0 || kk > 1) continue; g.save(); g.translate(p.x, p.y); g.scale(1 + kk * 1.2, 1 + kk * 1.2); hexPath(g, 0, 0); g.restore(); g.lineWidth = 2.5 * (1 - kk); g.strokeStyle = sa!.side === 0 ? `rgba(120,180,255,${1 - kk})` : `rgba(255,120,120,${1 - kk})`; g.stroke(); }
        if (k1 < 0.3) { g.globalAlpha = (0.3 - k1) / 0.3 * 0.8; g.fillStyle = '#fff'; hexPath(g, p.x, p.y); g.fill(); g.globalAlpha = 1; } } }
    const u0 = mine();
    const lit: { r: number; c: number }[] = u0 && summonIdx < 0 && !magicMode ? [...b.reachable(u0).values()] : [];
    const tg = u0 ? (magicMode ? b.magicTargets(u0) : b.targetsFrom(u0, u0.r, u0.c)) : [];
    const sc = u0 && summonIdx >= 0 ? b.summonCells(0, b.natials[summonIdx]) : [];
    for (const v of lit) fillHex(v.r, v.c, 'rgba(80,160,255,.35)');
    for (const t of tg) fillHex(t.r, t.c, magicMode ? 'rgba(120,255,160,.45)' : 'rgba(255,60,60,.45)');
    for (const p of sc) fillHex(p.r, p.c, 'rgba(80,255,120,.4)');
    const act = active();
    const t = now();
    /** where a unit is drawn right now: walking along its path, or at its cell */
    const posOf = (u: Unit): { p: { x: number; y: number }; facing: number; walking: boolean; r: number } => {
      const w = walkAnim.get(u.uid);
      if (w) { const k = Math.max(0, (t - w.t0) / STEP_MS); const i = Math.min(w.path.length - 2, Math.floor(k)); const f = Math.min(1, k - i); const a = center(w.path[i].r, w.path[i].c), c = center(w.path[i + 1].r, w.path[i + 1].c); return { p: { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f }, facing: dirOf(w.path[i], w.path[i + 1]), walking: true, r: f < 0.5 ? w.path[i].r : w.path[i + 1].r }; }
      return { p: center(u.r, u.c), facing: u.facing, walking: false, r: u.r };
    };
    const drawn = b.alive().map((u) => ({ u, ...posOf(u) })).sort((x, y) => x.r - y.r || x.u.c - y.u.c);
    for (const { u, p, facing, walking } of drawn) {
      const fr = frameOf(u); const off = animOffset(u); p.x += off.x; p.y += off.y;
      const wf = deps.facing.walkFramesFor(facing); const stepTick = walking ? Math.floor((t - walkAnim.get(u.uid)!.t0) / (STEP_MS / 2)) : Math.floor(blinkTick / 3);
      const walkF = wf[stepTick % wf.length];
      const sp = fr < 0 ? (deps.walk(u.def.id, u.side, walkF, masterIdx[u.side]) ?? (u.def.master ? deps.masterSprite(masterIdx[u.side], u.side, deps.facing.poseGroupFor(facing) * 3) : deps.sprite(u.def.id, u.side, deps.facing.poseGroupFor(facing) * 3))) : (u.def.master ? deps.masterSprite(masterIdx[u.side], u.side, fr) : deps.sprite(u.def.id, u.side, fr));
      const isActive = u === act;
      const sm = summonAnim.get(u.uid); const sk = sm ? Math.min(1, Math.max(0, (t - sm.t0) / SUMMON_MS)) : 1;
      if (sm && sk < 1) { const fx = deps.effect(SUMMON_FX, Math.min(17, Math.floor(sk * 18))); if (fx) { g.globalAlpha = 0.9; g.drawImage(fx, p.x - 48, p.y - 60); g.globalAlpha = 1; } }
      if (sp) {
        g.beginPath(); g.ellipse(p.x, p.y + 4, 16, 8, 0, 0, Math.PI * 2); g.fillStyle = isActive ? 'rgba(255,255,255,.6)' : u.side === 0 ? 'rgba(60,120,255,.45)' : 'rgba(255,70,70,.45)'; g.fill();
        if (isActive && blinkOn()) g.globalAlpha = 0.45;
        if (sk < 1) { g.globalAlpha = Math.min(1, sk * 1.6); p.y -= (1 - sk) * 10; }
        g.drawImage(sp, p.x - sp.width / 2, p.y + 8 - (+(sp.dataset.bottom ?? sp.height - 6))); g.globalAlpha = 1;
        if (sk < 1) p.y += (1 - sk) * 10;
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
    for (const d of deaths.values()) { const age = t - d.t0; const p = center(d.r, d.c);
      if (age < 0) { const wf = deps.facing.walkFramesFor(d.facing); const sp = deps.walk(d.id, d.side, wf[Math.floor(blinkTick / 3) % wf.length], masterIdx[d.side]); if (sp) g.drawImage(sp, p.x - sp.width / 2, p.y + 8 - (+(sp.dataset.bottom ?? sp.height - 6))); continue; }
      const k = age / 1400; g.globalAlpha = Math.max(0, 1 - k);
      for (let i = 0; i < 8; i++) { const fr = deps.walk(d.id, d.side, 16 + i, masterIdx[d.side]); if (!fr) break; const ang = i / 8 * Math.PI * 2; g.drawImage(fr, 0, 24, 48, 24, p.x - 24 + Math.cos(ang) * 12 * k, p.y - 30 - k * 60 + Math.sin(ang) * 6 * k, 48, 24); } g.globalAlpha = 1; }
    for (const pp of pops) { const u = b.unit(pp.uid); if (!u) continue; const age = t - pp.t0; if (age < 0) continue; const p = center(u.r, u.c); const y = p.y - 40 - Math.min(age, 300) / 300 * 14;
      g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(pp.text, p.x, y); g.fillStyle = '#fff'; g.fillText(pp.text, p.x, y); }
    if (hover) { const p = center(hover.r, hover.c); hexPath(g, p.x, p.y); g.lineWidth = 1; g.strokeStyle = '#ff0'; g.stroke(); const d = ts.defs[grid[hover.r * 32 + hover.c]]; const u = b.unitAt(hover.r, hover.c);
      let extra = ''; if (u && u0 && u.side !== 0) { const can = magicMode ? b.magicTargets(u0).includes(u) : b.targetsFrom(u0, u0.r, u0.c).includes(u); if (can) extra = ` · 예상 피해 ${b.damage(u0, u, magicMode)}`; }
      $('bhud').textContent = `(${hover.r},${hover.c}) ${TERRAIN[d.terrain] ?? d.terrain} 높이 ${d.height} 방어 ${RULES.terrainDef[d.terrain] ?? 0}%${u ? ` · ${u.def.name} HP ${u.hp} OA ${u.oa}` : ''}${extra}`; }
    g.restore();
  }

  const portraitHtml = (id: string, h = 96) => (id.startsWith('n') && deps.portrait(+id.slice(1)) ? `<div class="pbox" data-k="${id.slice(1)}" data-h="${h}"></div>` : '');
  function mountPortrait(box: HTMLElement) { const c = deps.portrait(+box.dataset.k!); if (!c) return; const t = document.createElement('canvas'); const h = +(box.dataset.h ?? 96); t.height = h; t.width = Math.round(c.width * h / c.height); t.getContext('2d')!.drawImage(c, 0, 0, t.width, h); box.appendChild(t); }
  const STAT_NAME = ['⚔ 공격', '🛡 방어', '✨ 마공', '🔰 마방', '👢 속도'], STAT_CLS = ['atk', 'def', 'mag', 'mdef', 'spd'];
  /** highest value of each stat among every natial (any level) and the masters — the gauges' 100% */
  const statMax = (): number[] => [0, 1, 2, 3, 4].map((k) => Math.max(RULES.master.stats[k], ...(b?.natials ?? []).flatMap((n) => n.stats[k])));
  const statGauges = (v: number[], ref?: number[]) => { const mx = statMax(); const top = Math.max(...v); return `<div class="gauges">${v.map((x, k) => `<div class="gr ${STAT_CLS[k]}${x === top ? ' top' : ''}"><span class="gl">${STAT_NAME[k]}</span><span class="gb"><i style="width:${Math.min(100, x / mx[k] * 100)}%"></i>${ref && ref[k] !== x ? `<em style="left:${Math.min(100, ref[k] / mx[k] * 100)}%"></em>` : ''}</span><b>${x}</b></div>`).join('')}</div>`; };
  const hpBar = (hp: number) => `<div class="hp">${Array.from({ length: RULES.hp }, (_, i) => `<i class="${i < hp ? 'on' : ''}"></i>`).join('')}</div>`;
  const unitHtml = (u: Unit) => `${portraitHtml(u.def.id, 72)}<b>${u.def.name}</b> <span class="e${u.def.element}">${ELEMENT[u.def.element] ?? ''}</span> <span class="muted">Lv${u.level}${u.def.light ? ` · ${u.def.light === 1 ? '주간형' : '야간형'}` : ''}</span>${hpBar(u.hp)}${statGauges([0, 1, 2, 3, 4].map((k) => b!.stat(u, k)), u.def.stats.map((v) => v[u.level - 1]))}<div class="muted small" style="margin-top:4px">이동 ${u.def.move}${u.def.range > 1 ? ` · 사정 ${u.def.range}` : ''}${u.def.spell ? ' · 마법' : ''} · 다음 행동까지 ${u.oa}분${u.def.upkeep ? ` · 유지 ${u.def.upkeep}` : ''}</div>`;
  const natialHtml = (n: UnitDef) => `${portraitHtml(n.id, 72)}<b>${n.name}</b> <span class="e${n.element}">${ELEMENT[n.element] ?? ''}</span>${n.light ? ` <span class="muted">${n.light === 1 ? '주간형' : '야간형'}</span>` : ''}${statGauges(n.stats.map((v) => v[0]))}<div class="muted small" style="margin-top:4px">Lv2/3: ${n.stats.map((v) => `${v[1]}/${v[2]}`).join(' · ')}<br>이동 ${n.move} · 사정 ${n.range}${n.spell ? ' · 마법' : ''} · 소환 <b>${b!.summonCost(n)} MP</b> · 유지 ${n.upkeep}/시간</div>`;
  const mountAll = (el: HTMLElement) => el.querySelectorAll<HTMLElement>('.pbox').forEach(mountPortrait);
  function openSummon() { const me = mine(); if (!me || !me.def.master) return; buildSummonList(); $('bSummonPop').classList.remove('hidden'); }
  function closeSummon() { $('bSummonPop').classList.add('hidden'); }
  function buildSummonList() {
    const sm = $('bSummon'), info = $('bSummonInfo'); const s = b!.s; const me = mine(); const canSummon = !!me && !!me.def.master;
    $('bSummonMp').textContent = `MP ${s.mp[0]}/${s.mpMax[0]}`;
    sm.innerHTML = b!.natials.map((n, i) => { const cost = b!.summonCost(n); return `<button data-i="${i}" class="${i === summonIdx ? 'sel' : ''}" ${!canSummon || cost > s.mp[0] || !b!.summonCells(0, n).length ? 'disabled' : ''}><span class="pthumb" data-k="${n.id.slice(1)}"></span><span><span class="e${n.element}">${ELEMENT[n.element]?.[0] ?? ''}</span> ${n.name}</span><span class="cost">${cost} MP</span></button>`; }).join('');
    sm.querySelectorAll<HTMLElement>('.pthumb').forEach((t) => { const c = deps.portrait(+t.dataset.k!); if (!c) return; const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48; cv.getContext('2d')!.drawImage(c, 0, 0, 48, 48 * c.height / c.width); t.appendChild(cv); });
    sm.querySelectorAll<HTMLButtonElement>('button').forEach((bt) => {
      bt.onclick = () => { summonIdx = +bt.dataset.i!; magicMode = false; closeSummon(); refresh(); draw(); };
      bt.onmouseenter = () => { info.innerHTML = natialHtml(b!.natials[+bt.dataset.i!]); mountAll(info); };
    });
  }
  function refresh() {
    const info = $('bInfo'), ui = $('bUnit');
    if (!b) { info.textContent = ''; ui.textContent = ''; $('bSummon').innerHTML = ''; $('bLog').textContent = ''; $('bOrder').innerHTML = ''; closeSummon(); return; }
    const s = b.s; const st = (side: 0 | 1) => Object.values(s.stones).filter((o) => o === side).length; const L = lightAt(s.clock);
    const act = active();
    info.innerHTML = `${s.winner >= 0 ? `<b style="color:var(--acc)">${s.names[s.winner as 0 | 1]} 승리!</b><br>` : ''}🕒 <b>${clockText(s.clock)}</b> ${L === 0 ? '☀ 낮' : L === 2 ? '🌙 밤' : '🌤 어스름'}${act ? ` · <b>${act.def.name}</b>${act.side === 0 ? ' 차례' : ' (봇)'}` : ''}<br><span class="e2">${s.names[0]}</span> MP ${s.mp[0]}/${s.mpMax[0]} · 석 ${st(0)}<br><span class="e3">${s.names[1]}</span> MP ${s.mp[1]}/${s.mpMax[1]} · 석 ${st(1)}`;
    $('bOrder').innerHTML = b.order(8).map(({ u, at }) => `<span class="ord ${u.side === 0 ? 'e2' : 'e3'}${u === act ? ' now' : ''}" title="${u.def.name}">${u.def.name.slice(0, 4)}<small>${clockText(at)}</small></span>`).join('');
    ui.innerHTML = act ? unitHtml(act) : '<span class="muted">…</span>'; mountAll(ui);
    if (summonIdx >= 0) ui.innerHTML += `<div class="small" style="margin-top:6px;color:var(--acc)">소환: ${b.natials[summonIdx].name} — 초록 칸을 클릭 (우클릭 취소)</div>`;
    const me = mine(); const canSummon = !!me && !!me.def.master;
    $<HTMLButtonElement>('bSummonBtn').disabled = !canSummon; $('bSummonBtn').classList.toggle('sel', summonIdx >= 0);
    $<HTMLButtonElement>('bMagic').disabled = !me || !me.def.spell; $('bMagic').classList.toggle('sel', magicMode);
    $<HTMLButtonElement>('bEnd').disabled = !me;
    if (!$('bSummonPop').classList.contains('hidden')) buildSummonList();
    $('bLog').textContent = s.log.slice(-14).join('\n'); $('bLog').scrollTop = 1e6;
  }
  $('bSummonBtn').onclick = () => { if (summonIdx >= 0) { summonIdx = -1; refresh(); draw(); } else openSummon(); };
  $('bSummonClose').onclick = closeSummon;
  $('bSummonPop').onclick = (e) => { if (e.target === $('bSummonPop')) closeSummon(); };

  // --- input ---
  const toWorld = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left + cam.x) / cam.z, y: (e.clientY - r.top + cam.y) / cam.z }; };
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onpointerdown = (e) => {
    if (e.button === 2) { summonIdx = -1; magicMode = false; refresh(); draw(); return; }
    if (camAnim) { const f = camAnim.done; camAnim = null; f(); } drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId);
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
    const u = b.unitAt(cell.r, cell.c); let err: string | null = null; const n0 = b.s.log.length; let acted = false; const aliveBefore = b.alive(); const stonesBefore = stonesSnap();
    const uid0 = b.s.nextUid;
    if (summonIdx >= 0) { err = b.summon(summonIdx, cell.r, cell.c); if (!err) { deps.sfx.role('summon'); startSummon(uid0); acted = true; } }
    else if (u && u.side !== 0 && (magicMode ? b.magicTargets(me).includes(u) : b.targetsFrom(me, me.r, me.c).includes(u))) {
      const ax = me.c + (me.r & 1) * 0.5, ux = u.c + (u.r & 1) * 0.5;
      err = magicMode ? b.magic(me.uid, u.uid) : b.attack(me.uid, u.uid);
      if (!err) { attackAnim.set(me.uid, { t0: now(), dx: Math.sign(ux - ax), dy: Math.sign(u.r - me.r) }); kickAnim(); if (!deps.sfx.attack(me.def.id, masterIdx[0])) deps.sfx.role('attack'); if (b.s.log.slice(n0).some((l) => l.includes('격파'))) setTimeout(() => deps.sfx.role('kill'), 600); popDamage(n0); acted = true; }
    }
    else if (!u && b.reachable(me).has(key(cell.r, cell.c))) { err = b.move(me.uid, cell.r, cell.c); if (!err) noteStones(stonesBefore, startWalk(me)); }
    else if (u && u.side !== 0 && dist(me, u) > 1) err = magicMode ? '마법 사정거리 밖' : '사정거리 밖';
    if (err) b.log(`! ${err}`); noteDeaths(aliveBefore); if (acted) noteStones(stonesBefore);
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
  return { populate, onShow: () => { populate(); fit(); } };
}
