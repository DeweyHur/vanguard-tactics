import './style.css';
import { VM2Data, TERRAIN, ELEMENT, MOVETYPE, MAP_COUNT, patchHeader, type MapInfo, type MapHeader, type Natial, HEX_W, CHUNK_H, TILE_H } from './vm2data';
import { TileRenderer, drawMap, worldSize, pickCell, cellOrigin, hexPath } from './render';
import { compressStore, writeArchive } from './lbdat';
import { putFile, getAll, clearAll, download } from './store';
import { initBattle } from './battleUi';
import { Facing, CLOCKS, CLOCK_NAME } from './facing';
import { Sfx, SFX_ROLES, DEFAULT_SFX, type SfxRole } from './sound';
import { portraitCanvas, indexedCanvas } from './render';
import { MidiPlayer } from './midi';
import { NATIAL_SPRITE, MASTER_SPRITE, WALK_ENTRY } from './vm2data';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => { $('status').textContent = s; };

// ---------- edit state (persisted in IndexedDB as __edits.json) ----------
interface MapEdit { srcIndex: number; name: string; desc: string; desc2: string; grid: number[] }
interface Edits { maps: Record<number, MapEdit>; natials: Record<number, Natial>; sfx?: Record<SfxRole, number>; bgm?: string; spriteMap?: Record<number, number>; walkClock?: number[]; poseClock?: number[] }
const facing = new Facing();
let edits: Edits = { maps: {}, natials: {} };
const sfxRoles = () => ({ ...DEFAULT_SFX, ...(edits.sfx ?? {}) });
let saveTimer = 0;
function saveEdits() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => putFile('__edits.json', new TextEncoder().encode(JSON.stringify(edits))).catch(() => {}), 300);
}

// ---------- data ----------
const data = new VM2Data();
let loaded = false; let spritesBuilt = false;
const renderers = new Map<string, TileRenderer>();
const rendererFor = (m: MapInfo) => { const ts = headerBase(m) === m.header ? m.tileset : data.maps[edits.maps[m.index].srcIndex].tileset; let r = renderers.get(ts.key); if (!r) { r = new TileRenderer(ts, data.palette(ts.pal)); renderers.set(ts.key, r); } return r; };
const headerBase = (m: MapInfo): MapHeader => { const e = edits.maps[m.index]; return e && e.srcIndex !== m.index ? data.maps[e.srcIndex].header : m.header; };
const gridOf = (m: MapInfo): Uint16Array => { const e = edits.maps[m.index]; return e ? Uint16Array.from(e.grid) : m.grid; };
const textOf = (m: MapInfo) => { const e = edits.maps[m.index]; const h = m.header; return e ? { name: e.name, desc: e.desc, desc2: e.desc2 } : { name: h.name, desc: h.desc, desc2: h.desc2 }; };
function ensureEdit(m: MapInfo): MapEdit {
  let e = edits.maps[m.index];
  if (!e) { const t = textOf(m); e = edits.maps[m.index] = { srcIndex: m.index, ...t, grid: Array.from(m.grid) }; }
  return e;
}

async function loadAll() {
  const files = await getAll();
  const list = $('fileList'); list.innerHTML = '';
  const game: Record<string, Uint8Array> = {};
  for (const [n, b] of Object.entries(files)) {
    if (n === '__edits.json') { try { edits = JSON.parse(new TextDecoder().decode(b)); facing.load(edits); } catch { /* ignore */ } continue; }
    game[n] = b; const d = document.createElement('div'); d.innerHTML = `<span>${n}</span><span class="muted">${(b.length / 1024).toFixed(0)} KB</span>`; list.appendChild(d);
  }
  if (!Object.keys(game).length) { status('파일 없음 — 파일 탭에서 게임 파일을 넣어주세요'); return; }
  try { data.load(game); loaded = true; renderers.clear(); }
  catch (e) { status(`읽기 실패: ${(e as Error).message}`); return; }
  status(`맵 ${data.maps.length} · 타일셋 ${data.tilesets.size} · 마스터 ${data.masters.length}${data.exe ? ' · EXE 있음' : ' · EXE 없음(스탯 편집 불가)'}${data.has('DATA02') ? ' · 스프라이트' : ''}${Object.keys(data.extra).length ? ` · MIDI ${Object.keys(data.extra).length}` : ''}`);
  buildMapList(); buildNatials(); buildMasters(); buildSound(); selectMap(cur); battle.populate(); sfx.reset(); portraitCache.clear(); spriteCache.clear(); walkCache.clear(); spritesBuilt = false;
  if (!$('tab-maps').classList.contains('hidden')) fitView();
}

// ---------- file tab ----------
const drop = $('drop'), fileInput = $<HTMLInputElement>('fileInput');
drop.onclick = () => fileInput.click();
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer) ingest(e.dataTransfer.files); };
fileInput.onchange = () => { if (fileInput.files) ingest(fileInput.files); fileInput.value = ''; };
async function ingest(fl: FileList) {
  let n = 0;
  for (const f of Array.from(fl)) {
    const up = f.name.toUpperCase();
    if (!/^DATA\d\d\.DAT$/.test(up) && !up.endsWith('.EXE') && !up.endsWith('.MID')) continue;
    await putFile(up, new Uint8Array(await f.arrayBuffer())); n++;
  }
  status(`${n}개 저장`); await loadAll();
}
$('btnClear').onclick = async () => { if (confirm('브라우저에 저장된 게임 파일과 수정 내용을 모두 지울까요?')) { await clearAll(); location.reload(); } };
$('btnResetMods').onclick = () => { if (confirm('수정 내용을 전부 되돌릴까요?')) { edits = { maps: {}, natials: {} }; facing.load(edits); saveEdits(); loadAll(); } };

// ---------- tabs ----------
document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'maps') fitView();
  if (b.dataset.tab === 'battle') battle.onShow();
  if (b.dataset.tab === 'sprites' && !spritesBuilt) { buildSprites(); spritesBuilt = true; }
});

// ---------- map tab ----------
let cur = 0, brush = 0;
const canvas = $<HTMLCanvasElement>('map'), wrap = $('mapwrap'), g = canvas.getContext('2d')!;
const world = document.createElement('canvas'); const wg = world.getContext('2d')!;
const cam = { x: 0, y: 0, z: 2 };
let hover: { r: number; c: number } | null = null, worldDirty = true;

function buildMapList() {
  const ml = $('mapList'); ml.innerHTML = '';
  data.maps.forEach((m) => { const d = document.createElement('div'); d.textContent = `${m.index.toString().padStart(2, '0')} ${textOf(m).name}`; d.classList.toggle('mod', !!edits.maps[m.index]); d.classList.toggle('sel', m.index === cur); d.onclick = () => selectMap(m.index); ml.appendChild(d); });
  const st = $<HTMLSelectElement>('selTarget'); st.innerHTML = '';
  data.maps.forEach((m) => { const o = document.createElement('option'); o.value = `${m.index}`; o.textContent = `${m.index} ${m.header.name}`; st.appendChild(o); });
}
function selectMap(i: number) {
  if (!loaded) return;
  cur = i; const m = data.maps[i]; const t = textOf(m);
  document.querySelectorAll('#mapList div').forEach((d, k) => d.classList.toggle('sel', k === i));
  $<HTMLInputElement>('inpName').value = t.name; $('mapNo').textContent = `${i}`;
  $<HTMLTextAreaElement>('txtDesc').value = t.desc; $<HTMLTextAreaElement>('txtDesc2').value = t.desc2;
  $<HTMLSelectElement>('selTarget').value = `${i}`;
  buildPalette(); worldDirty = true; draw();
}
const ws = worldSize(); world.width = ws.w; world.height = ws.h;
function redrawWorld() { const m = data.maps[cur]; wg.clearRect(0, 0, ws.w, ws.h); drawMap(wg, rendererFor(m), gridOf(m)); worldDirty = false; }
function fitView() {
  canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight;
  cam.z = +$<HTMLSelectElement>('selZoom').value; cam.x = Math.max(0, (ws.w * cam.z - canvas.width) / 2); cam.y = Math.max(0, (ws.h * cam.z - canvas.height) / 2);
  draw();
}
function draw() {
  if (!loaded) return;
  if (worldDirty) redrawWorld();
  g.imageSmoothingEnabled = false; g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.save(); g.translate(-cam.x, -cam.y); g.scale(cam.z, cam.z); g.drawImage(world, 0, 0);
  if (hover) {
    const m = data.maps[cur]; const ts = rendererFor(m).ts; const idx = gridOf(m)[hover.r * 32 + hover.c]; const o = cellOrigin(hover.r, hover.c);
    const h = ts.defs[idx].height; hexPath(g, o.x + 24, o.base - 18 - 12 * h); g.strokeStyle = '#ff0'; g.lineWidth = 1 / cam.z; g.stroke();
    const d = ts.defs[idx]; $('hud').textContent = `(${hover.r},${hover.c}) 타일 ${idx} · ${TERRAIN[d.terrain] ?? d.terrain} · 높이 ${d.height} · base ${d.base}`;
  }
  g.restore();
}
window.addEventListener('resize', () => { if (!$('tab-maps').classList.contains('hidden')) fitView(); });
$<HTMLSelectElement>('selZoom').onchange = fitView;

const toWorld = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left + cam.x) / cam.z, y: (e.clientY - r.top + cam.y) / cam.z }; };
let drag: { x: number; y: number; cx: number; cy: number } | null = null, painting = false;
canvas.oncontextmenu = (e) => e.preventDefault();
canvas.onmousedown = (e) => {
  if (!loaded) return;
  if (e.button === 1) { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; return; }
  const p = toWorld(e); const m = data.maps[cur]; const cell = pickCell(rendererFor(m).ts, gridOf(m), p.x, p.y); if (!cell) return;
  if (e.button === 2) { setBrush(gridOf(m)[cell.r * 32 + cell.c]); return; }
  painting = true; paint(cell);
};
canvas.onmousemove = (e) => {
  if (drag) { cam.x = drag.cx - (e.clientX - drag.x); cam.y = drag.cy - (e.clientY - drag.y); draw(); return; }
  if (!loaded) return;
  const p = toWorld(e); const m = data.maps[cur]; const cell = pickCell(rendererFor(m).ts, gridOf(m), p.x, p.y);
  if (cell?.r !== hover?.r || cell?.c !== hover?.c) { hover = cell; if (painting && cell) paint(cell); else draw(); }
};
window.addEventListener('mouseup', () => { drag = null; painting = false; });
canvas.onmouseleave = () => { hover = null; draw(); };
canvas.onwheel = (e) => {
  e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = (mx + cam.x) / cam.z, wy = (my + cam.y) / cam.z; cam.z = Math.min(4, Math.max(0.5, cam.z * (e.deltaY < 0 ? 1.25 : 0.8)));
  cam.x = wx * cam.z - mx; cam.y = wy * cam.z - my; draw();
};
window.addEventListener('keydown', (e) => {
  if ($('tab-maps').classList.contains('hidden') || (e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|SELECT/)) return;
  const s = 48; if (e.key === 'ArrowLeft') cam.x -= s; else if (e.key === 'ArrowRight') cam.x += s; else if (e.key === 'ArrowUp') cam.y -= s; else if (e.key === 'ArrowDown') cam.y += s; else return; draw();
});
function paint(cell: { r: number; c: number }) {
  const m = data.maps[cur]; const e = ensureEdit(m); const k = cell.r * 32 + cell.c;
  if (e.grid[k] === brush) { draw(); return; }
  e.grid[k] = brush; worldDirty = true; draw(); markMod(); saveEdits();
}
function markMod() { document.querySelectorAll('#mapList div')[cur]?.classList.add('mod'); }

// palette
function buildPalette() {
  const m = data.maps[cur]; const rend = rendererFor(m); const ts = rend.ts; const grid = gridOf(m);
  const used = new Set<number>(grid); const ft = $<HTMLSelectElement>('fTerrain'), fh = $<HTMLSelectElement>('fHeight');
  if (!ft.options.length) {
    ft.innerHTML = '<option value="-1">전부</option>' + Object.entries(TERRAIN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    fh.innerHTML = '<option value="-1">전부</option>' + Array.from({ length: 8 }, (_, i) => `<option value="${i}">${i}</option>`).join('');
    ft.onchange = fh.onchange = $('fUsed').onchange = buildPalette;
  }
  const tf = +ft.value, hf = +fh.value, onlyUsed = $<HTMLInputElement>('fUsed').checked;
  const pal = $('pal'); pal.innerHTML = '';
  for (let i = 0; i < 512; i++) {
    const d = ts.defs[i]; if (d.left.every((v) => v === 0x7ff) && d.right.every((v) => v === 0x7ff)) continue;
    if (tf >= 0 && d.terrain !== tf) continue; if (hf >= 0 && d.height !== hf) continue; if (onlyUsed && !used.has(i)) continue;
    const top = rend.topRow(i); const h = Math.min(TILE_H - top * CHUNK_H, 72);
    const c = document.createElement('canvas'); c.width = HEX_W; c.height = h; c.title = `${i} ${TERRAIN[d.terrain] ?? d.terrain} h${d.height}`;
    c.getContext('2d')!.drawImage(rend.tile(i), 0, top * CHUNK_H, HEX_W, h, 0, 0, HEX_W, h);
    c.dataset.i = `${i}`; c.classList.toggle('sel', i === brush); c.onclick = () => setBrush(i); pal.appendChild(c);
  }
}
function setBrush(i: number) {
  brush = i; const d = rendererFor(data.maps[cur]).ts.defs[i];
  $('brushInfo').textContent = `${i} · ${TERRAIN[d.terrain] ?? d.terrain} · 높이 ${d.height}`;
  document.querySelectorAll<HTMLCanvasElement>('#pal canvas').forEach((c) => c.classList.toggle('sel', c.dataset.i === `${i}`));
}

// text + slot copy
const onText = () => { const m = data.maps[cur]; const e = ensureEdit(m); e.name = $<HTMLInputElement>('inpName').value; e.desc = $<HTMLTextAreaElement>('txtDesc').value; e.desc2 = $<HTMLTextAreaElement>('txtDesc2').value;
  try { patchHeader(headerBase(m), e.name, e.desc, e.desc2); status('텍스트 OK'); } catch (err) { status((err as Error).message); }
  markMod(); (document.querySelectorAll('#mapList div')[cur] as HTMLElement).textContent = `${cur.toString().padStart(2, '0')} ${e.name}`; saveEdits(); };
$('inpName').oninput = $('txtDesc').oninput = $('txtDesc2').oninput = onText;
$('btnCopySlot').onclick = () => {
  const t = +$<HTMLSelectElement>('selTarget').value; if (t === cur) return;
  const m = data.maps[cur]; const src = edits.maps[cur]; const tx = textOf(m);
  if (!confirm(`맵 ${cur}의 현재 상태를 슬롯 ${t}(${data.maps[t].header.name})에 덮어쓸까요?`)) return;
  edits.maps[t] = { srcIndex: src ? src.srcIndex : cur, name: tx.name, desc: tx.desc, desc2: tx.desc2, grid: Array.from(gridOf(m)) };
  saveEdits(); buildMapList(); selectMap(t);
};

// ---------- natials ----------
const STAT = ['공격', '방어', '마공', '마방', '속도'];
const portraitCache = new Map<number, HTMLCanvasElement | null>();
const spriteCache = new Map<string, HTMLCanvasElement | null>();
/** 96x96 canvas of one frame of a DATA02 sprite entry (centred at x=48); dataset.bottom = last opaque row (feet) */
function spriteFrame(entry: number, frame: number): HTMLCanvasElement | null {
  const k = `${entry}:${frame}`;
  if (!spriteCache.has(k)) {
    const sp = loaded ? data.sprite(entry) : null; const fr = sp?.frames[frame]; let c: HTMLCanvasElement | null = null;
    if (fr) { c = indexedCanvas(fr, sp!.w, sp!.h, data.palette()); let bottom = sp!.h - 1; while (bottom > 0 && !fr.subarray(bottom * sp!.w, bottom * sp!.w + sp!.w).some((v) => v !== 16)) bottom--; c.dataset.bottom = `${bottom}`; }
    spriteCache.set(k, c);
  }
  return spriteCache.get(k) ?? null;
}
const walkCache = new Map<string, HTMLCanvasElement | null>();
/** 48x72 canvas of one DATA01 walk/death frame for a DATA02 sprite entry */
function walkFrame(data02Entry: number, frame: number): HTMLCanvasElement | null {
  const k = `${data02Entry}:${frame}`;
  if (!walkCache.has(k)) { const sp = loaded ? data.walk(WALK_ENTRY(data02Entry)) : null; const fr = sp?.frames[frame]; let c: HTMLCanvasElement | null = null; if (fr) { c = indexedCanvas(fr, 48, 72, data.palette()); let bottom = 71; while (bottom > 0 && !fr.subarray(bottom * 48, bottom * 48 + 48).some((v) => v !== 16)) bottom--; c.dataset.bottom = `${bottom}`; } walkCache.set(k, c); }
  return walkCache.get(k) ?? null;
}
const effectCache = new Map<string, HTMLCanvasElement | null>();
/** 96x96 canvas of one frame of a DATA03 effect entry (summon sparkle etc.) */
function effectFrame(entry: number, frame: number): HTMLCanvasElement | null {
  const k = `${entry}:${frame}`;
  if (!effectCache.has(k)) { const sp = loaded ? data.sprite(entry, 'DATA03') : null; const fr = sp?.frames[frame]; effectCache.set(k, fr ? indexedCanvas(fr, 96, 96, data.palette()) : null); }
  return effectCache.get(k) ?? null;
}
const midi = new MidiPlayer();
const spriteEntryFor = (k: number) => edits.spriteMap?.[k] ?? NATIAL_SPRITE[k];
/** animated preview cycling through the given frames (driven by one shared timer) */
const anims: { c: HTMLCanvasElement; src: (tick: number) => HTMLCanvasElement | null; label: (tick: number) => string }[] = [];
let animFps = 8;
function animOf(entry: number, frames: number[], scale = 2): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 96 * scale; c.height = 96 * scale; c.className = 'anim'; c.title = `#${entry} 연속재생`;
  anims.push({ c, src: (t) => spriteFrame(entry, frames[t % frames.length]), label: (t) => `${frames[t % frames.length]}` }); return c;
}
/** animated walk cycle (DATA01 frames) of a DATA02 entry */
function walkAnimOf(entry: number, frames: number[], scale = 2, label = true): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 48 * scale; c.height = 72 * scale; c.className = 'anim';
  anims.push({ c, src: (t) => walkFrame(entry, frames[Math.floor(t / 2) % frames.length]), label: (t) => (label ? `${frames[Math.floor(t / 2) % frames.length]}` : '') }); return c;
}
let animTick = 0;
setInterval(() => {
  if ($('tab-sprites').classList.contains('hidden') || !anims.length) return; animTick++;
  if (animTick % 40 === 0) anims.splice(0, anims.length, ...anims.filter((a) => a.c.isConnected));
  for (const a of anims) { if (!a.c.isConnected) continue; const src = a.src(animTick); const g = a.c.getContext('2d')!; g.imageSmoothingEnabled = false; g.clearRect(0, 0, a.c.width, a.c.height); if (src) g.drawImage(src, 0, 0, a.c.width, a.c.height); const l = a.label(animTick); if (l) { g.fillStyle = '#ffd24a'; g.font = '10px monospace'; g.fillText(l, 2, 10); } }
}, 1000 / animFps);
/** 8 cells, one per clock direction, with the walk cycle and the attack pose that the current facing tables assign to it */
function dirGrid(entry: number, scale = 1): HTMLElement {
  const box = document.createElement('div'); box.className = 'dirgrid';
  for (const ck of CLOCKS) {
    const cell = document.createElement('div'); cell.className = 'dircell'; const lab = document.createElement('div'); lab.className = 'small'; lab.textContent = CLOCK_NAME[ck]; cell.appendChild(lab);
    const row = document.createElement('div'); row.className = 'row';
    row.appendChild(walkAnimOf(entry, facing.walkFrames(ck), scale, false));
    const g0 = facing.poseGroup(ck) * 3; const pc = document.createElement('canvas'); pc.width = 48 * scale; pc.height = 72 * scale; pc.className = 'anim'; pc.title = `공격 포즈 그룹 ${g0 / 3}`;
    anims.push({ c: pc, src: (t) => { const f = spriteFrame(entry, g0 + [0, 0, 0, 1, 2, 2][Math.floor(t / 2) % 6]); if (!f) return null; const cv = document.createElement('canvas'); cv.width = 48; cv.height = 72; cv.getContext('2d')!.drawImage(f, 24, 24, 48, 72, 0, 0, 48, 72); return cv; }, label: () => '' });
    row.appendChild(pc); cell.appendChild(row); box.appendChild(cell);
  }
  return box;
}
let dirEntry = 0;
/** editable facing tables: which DATA01 frame / DATA02 pose group shows which clock direction */
function buildDirs() {
  const el = $('spriteDirs'); el.innerHTML = ''; if (!loaded || !data.has('DATA02')) return;
  const entries: number[] = []; data.entries.DATA02.forEach((e, i) => { if (i % 2 === 0 && e.length && data.entries.DATA02[i + 1]?.length) entries.push(i); });
  if (!entries.includes(dirEntry)) dirEntry = entries[0] ?? 0;
  const nats = data.natials(); const nameOf = (e: number) => { const k = nats.findIndex((_, i) => spriteEntryFor(i) === e); return e < 72 ? `마스터 ${Math.floor(e / 4)}` : k >= 0 ? nats[k].name : ''; };
  const clockSel = (v: number) => `<select>${CLOCKS.map((c) => `<option value="${c}" ${c === v ? 'selected' : ''}>${CLOCK_NAME[c]}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="row"><label>미리보기 유닛 <select id="dirEntry">${entries.map((e) => `<option value="${e}" ${e === dirEntry ? 'selected' : ''}>#${e} ${nameOf(e)}</option>`).join('')}</select></label> <button id="dirReset">기본값으로</button> <span class="muted small">프레임마다 어느 방향을 보는지 골라 주세요. 배틀과 아래 방향별 보기에 바로 반영됩니다.</span></div>
    <div class="muted small" style="margin-top:8px">DATA01 걷기 프레임 → 방향</div><div class="strip" id="dirWalk"></div>
    <div class="muted small" style="margin-top:8px">DATA02 공격 포즈 그룹 (프레임 0-2, 3-5 …) → 방향</div><div class="strip" id="dirPose"></div>
    <div class="muted small" style="margin-top:8px">방향별 보기 (걷기 · 공격 포즈)</div><div id="dirView"></div>`;
  const wk = $('dirWalk'); for (let f = 0; f < 16; f++) { const d = document.createElement('div'); d.className = 'dircell'; const c = walkFrame(dirEntry, f); const t = document.createElement('canvas'); t.width = 96; t.height = 144; t.className = 'anim'; if (c) { const g = t.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, 96, 144); } d.innerHTML = `<div class="small">W${f}</div>`; d.appendChild(t); d.insertAdjacentHTML('beforeend', clockSel(facing.walkClock[f])); d.querySelector('select')!.onchange = (ev) => { facing.walkClock[f] = +(ev.target as HTMLSelectElement).value; edits.walkClock = [...facing.walkClock]; saveEdits(); rebuildDirView(); }; wk.appendChild(d); }
  const pk = $('dirPose'); for (let gI = 0; gI < 6; gI++) { const d = document.createElement('div'); d.className = 'dircell'; d.innerHTML = `<div class="small">P${gI * 3}-${gI * 3 + 2}</div>`; d.appendChild(animOf(dirEntry, [gI * 3, gI * 3 + 1, gI * 3 + 2], 1)); d.insertAdjacentHTML('beforeend', clockSel(facing.poseClock[gI])); d.querySelector('select')!.onchange = (ev) => { facing.poseClock[gI] = +(ev.target as HTMLSelectElement).value; edits.poseClock = [...facing.poseClock]; saveEdits(); rebuildDirView(); }; pk.appendChild(d); }
  const rebuildDirView = () => { const v = $('dirView'); v.innerHTML = ''; v.appendChild(dirGrid(dirEntry, 2)); if (shownEntry >= 0) showEntry(shownEntry, $('spriteDetail').querySelector('h3')?.textContent?.replace(/^#\d+ /, '') ?? ''); };
  rebuildDirView();
  $<HTMLSelectElement>('dirEntry').onchange = (ev) => { dirEntry = +(ev.target as HTMLSelectElement).value; buildDirs(); };
  $('dirReset').onclick = () => { facing.load({}); delete edits.walkClock; delete edits.poseClock; saveEdits(); buildDirs(); };
}
function stripOf(entry: number, frames: number[], scale = 1): HTMLElement {
  const box = document.createElement('div'); box.className = 'strip';
  for (const f of frames) { const c = spriteFrame(entry, f); if (!c) continue; const t = document.createElement('canvas'); t.width = 96 * scale; t.height = 96 * scale; t.title = `#${entry} frame ${f}`; const g = t.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, t.width, t.height); box.appendChild(t); }
  return box;
}
/** a direction cell: the animated cycle on top, its frames small underneath */
function dirCell(label: string, anim: HTMLCanvasElement, frames: (HTMLCanvasElement | null)[], fw: number, fh: number, names: string[]): HTMLElement {
  const cell = document.createElement('div'); cell.className = 'dircell'; const l = document.createElement('div'); l.className = 'small'; l.textContent = label; cell.appendChild(l); cell.appendChild(anim);
  const st = document.createElement('div'); st.className = 'strip'; frames.forEach((c, i) => { const t = document.createElement('canvas'); t.width = fw; t.height = fh; t.title = names[i]; if (c) { const g = t.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, fw, fh); } st.appendChild(t); }); cell.appendChild(st);
  return cell;
}
/** one DATA02 entry laid out by direction: attack pose groups (3 frames each) and the DATA01 walk cycle, death fragments last */
function entryDirRows(e: number): HTMLElement {
  const box = document.createElement('div');
  const pose = document.createElement('div'); pose.className = 'dirgrid';
  for (const ck of CLOCKS) facing.poseClock.forEach((c, gI) => { if (c !== ck) return; const fr = [gI * 3, gI * 3 + 1, gI * 3 + 2]; pose.appendChild(dirCell(`${CLOCK_NAME[ck]} · 공격 P${fr[0]}-${fr[2]}`, animOf(e, [fr[0], fr[0], fr[0], fr[1], fr[2], fr[2]], 1), fr.map((f) => spriteFrame(e, f)), 48, 48, fr.map((f) => `#${e} frame ${f}`))); });
  box.appendChild(pose);
  if (walkFrame(e, 0)) {
    const wk = document.createElement('div'); wk.className = 'dirgrid'; wk.style.marginTop = '6px';
    for (const ck of CLOCKS) { const fr: number[] = []; facing.walkClock.forEach((c, i) => { if (c === ck) fr.push(i); }); if (!fr.length) continue; wk.appendChild(dirCell(`${CLOCK_NAME[ck]} · 걷기 W${fr.join(',')}`, walkAnimOf(e, fr, 1, false), fr.map((f) => walkFrame(e, f)), 24, 36, fr.map((f) => `걷기 ${f}`))); }
    const death = Array.from({ length: 8 }, (_, i) => walkFrame(e, 16 + i)); const dc = document.createElement('div'); dc.className = 'dircell'; const l = document.createElement('div'); l.className = 'small'; l.textContent = '사망 조각'; dc.appendChild(l); const st = document.createElement('div'); st.className = 'strip'; death.forEach((c, i) => { const t = document.createElement('canvas'); t.width = 48; t.height = 72; t.title = `사망 ${i}`; if (c) t.getContext('2d')!.drawImage(c, 0, 0); st.appendChild(t); }); dc.appendChild(st); wk.appendChild(dc);
    box.appendChild(wk);
  }
  return box;
}
const nameOfEntry = (e: number) => { const nats = loaded ? data.natials() : []; const k = nats.findIndex((_, i) => spriteEntryFor(i) === e); return k >= 0 ? nats[k].name : ''; };
/** 48x48 static thumbnail (frame 0, cropped to the body) of a DATA02 entry */
function thumbOf(e: number): HTMLCanvasElement {
  const t = document.createElement('canvas'); t.width = 48; t.height = 48; t.className = 'thumb'; const sp = spriteFrame(e, 0);
  if (sp) { const g = t.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(sp, 24, 36, 48, 48, 0, 0, 48, 48); }
  return t;
}
let shownEntry = -1;
/** show one entry's motions in the detail panel (only this entry animates) */
function showEntry(e: number, title: string) {
  shownEntry = e; const det = $('spriteDetail'); det.innerHTML = ''; anims.splice(0, anims.length, ...anims.filter((a) => a.c.isConnected));
  const h = document.createElement('h3'); h.textContent = `#${e} ${title}`; det.appendChild(h);
  const row = document.createElement('div'); row.className = 'sprow-body'; row.appendChild(animOf(e, Array.from({ length: 18 }, (_, i) => i))); row.appendChild(entryDirRows(e)); det.appendChild(row);
  const st = document.createElement('div'); st.className = 'muted small'; st.textContent = '전체 18프레임'; det.appendChild(st); det.appendChild(stripOf(e, Array.from({ length: 18 }, (_, i) => i)));
  document.querySelectorAll<HTMLElement>('#spriteAll .gal').forEach((g) => g.classList.toggle('sel', +g.dataset.e! === e));
  det.scrollIntoView({ block: 'nearest' });
}
function buildSprites() {
  const mapEl = $('spriteMap'), allEl = $('spriteAll'); mapEl.innerHTML = ''; allEl.innerHTML = ''; $('spriteDetail').innerHTML = ''; anims.length = 0;
  if (!loaded || !data.has('DATA02')) { mapEl.innerHTML = '<p class="muted">DATA00.DAT + DATA02.DAT를 넣으면 스프라이트가 나옵니다.</p>'; return; }
  const entries: number[] = []; data.entries.DATA02.forEach((e, i) => { if (i % 2 === 0 && e.length && data.entries.DATA02[i + 1]?.length) entries.push(i); });
  const nats = data.natials();
  buildDirs();
  // mapping table: portrait, name, entry select, static thumbnail; click = details
  const tbl = document.createElement('table'); tbl.innerHTML = '<tr><th>#</th><th>초상화</th><th>이름</th><th>엔트리</th><th>스프라이트</th></tr>';
  for (let k = 0; k < 24; k++) {
    const tr = document.createElement('tr'); const cur = spriteEntryFor(k); tr.className = 'clickable';
    tr.innerHTML = `<td>${k}</td><td class="port"></td><td class="l">${nats[k]?.name ?? ''}</td><td><select>${entries.map((e) => `<option value="${e}" ${e === cur ? 'selected' : ''}>${e}</option>`).join('')}</select></td><td class="l thumb-cell"></td>`;
    const pc = portrait(k); if (pc) { const t = document.createElement('canvas'); t.width = 48; t.height = 48; t.getContext('2d')!.drawImage(pc, 0, 0, 48, 48 * pc.height / pc.width); tr.querySelector('.port')!.appendChild(t); }
    const cell = tr.querySelector<HTMLElement>('.thumb-cell')!; cell.appendChild(thumbOf(cur));
    tr.onclick = (ev) => { if ((ev.target as HTMLElement).tagName === 'SELECT') return; showEntry(spriteEntryFor(k), `${nats[k]?.name ?? ''} 파랑`); };
    tr.querySelector('select')!.onchange = (ev) => { const v = +(ev.target as HTMLSelectElement).value; edits.spriteMap = { ...(edits.spriteMap ?? {}), [k]: v }; saveEdits(); cell.innerHTML = ''; cell.appendChild(thumbOf(v)); showEntry(v, `${nats[k]?.name ?? ''} 파랑`); };
    tbl.appendChild(tr);
  }
  mapEl.appendChild(tbl);
  // gallery: static thumbnails by section; click = details
  const team = (e: number, base = 0) => ((e - base) % 4 ? '빨강' : '파랑');
  const section = (title: string, list: number[], label: (e: number) => string) => {
    if (!list.length) return; const h = document.createElement('h3'); h.textContent = `${title} (${list.length})`; allEl.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'gallery';
    for (const e of list) { const g = document.createElement('div'); g.className = 'gal'; g.dataset.e = `${e}`; g.appendChild(thumbOf(e)); const l = document.createElement('div'); l.className = 'small'; l.textContent = `#${e} ${label(e)}`; g.appendChild(l); g.onclick = () => showEntry(e, label(e)); grid.appendChild(g); }
    allEl.appendChild(grid);
  };
  section('마스터', entries.filter((e) => e < 72), (e) => `마스터 ${Math.floor(e / 4)} ${team(e)}${data.masters[Math.floor(e / 4)]?.name ? ' · ' + data.masters[Math.floor(e / 4)].name : ''}`);
  section('소환수', entries.filter((e) => e >= 90 && e < 90 + 24 * 4), (e) => `${nats[Math.floor((e - 90) / 4)]?.name ?? ''} ${team(e, 90)}`);
  section('기타', entries.filter((e) => (e >= 72 && e < 90) || e >= 90 + 24 * 4), (e) => nameOfEntry(e));
  if (shownEntry >= 0 && entries.includes(shownEntry)) showEntry(shownEntry, ''); 
}
function midFiles(): string[] { return loaded ? Object.keys(data.extra).filter((n) => n.endsWith('.MID')).sort() : []; }
function portrait(k: number): HTMLCanvasElement | null {
  if (!portraitCache.has(k)) { const p = loaded ? data.portrait(k) : null; portraitCache.set(k, p ? portraitCanvas(p) : null); }
  return portraitCache.get(k) ?? null;
}
function buildSound() {
  const mids = midFiles(); const bg = $('bgmRow');
  bg.innerHTML = mids.length ? `<label>배틀 BGM <select id="bgmSel"><option value="">없음</option>${mids.map((m) => `<option value="${m}" ${edits.bgm === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label> <button id="bgmPlay">▶ 재생</button><button id="bgmStop">■ 정지</button> <label>볼륨 <input type="range" id="bgmVol" min="0" max="1" step="0.05" value="0.35"></label> <span class="muted small">(WebAudio 칩튠 신스로 재생 — 원곡 음색과 다릅니다)</span>` : '<span class="muted">MIDI 폴더의 *.MID 파일을 파일 탭에 넣으면 BGM을 고를 수 있습니다.</span>';
  if (mids.length) {
    const sel = $<HTMLSelectElement>('bgmSel'); sel.onchange = () => { edits.bgm = sel.value || undefined; saveEdits(); };
    $('bgmPlay').onclick = () => { const f = sel.value && data.extra[sel.value]; if (f) midi.play(f); };
    $('bgmStop').onclick = () => midi.stop();
    $<HTMLInputElement>('bgmVol').oninput = (e) => midi.setVolume(+(e.target as HTMLInputElement).value);
  }
  const unitEl = $('sfxUnits'); const nats0 = loaded && data.has('DATA12') ? data.natials() : [];
  unitEl.innerHTML = nats0.length ? `<table><tr><th>#</th><th>네이티얼</th><th>스크립트</th><th>사운드 큐 (틱:번호)</th><th></th></tr>${nats0.map((nt, k) => { const cues = data.animSounds(27 + k); return `<tr><td>${k}</td><td class="l">${nt.name}</td><td>DATA12 #${27 + k}</td><td class="l">${cues.map((c) => `${c.tick}:#${c.sfx}`).join(' · ') || '—'}</td><td class="l"><button data-k="${k}">▶ 공격음</button></td></tr>`; }).join('')}</table>` : '<p class="muted">DATA12.DAT(애니메이션 스크립트)를 넣으면 유닛별 공격음이 나옵니다.</p>';
  unitEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.onclick = () => sfx.sequence(data.animSounds(27 + +b.dataset.k!)));
  const list = $('sfxList'), roles = $('sfxRoles'); const n = loaded ? data.sfxCount() : 0;
  if (!n) { list.innerHTML = '<p class="muted">DATA13.DAT를 넣으면 효과음 목록이 나옵니다.</p>'; roles.innerHTML = ''; return; }
  const cur = sfxRoles();
  roles.innerHTML = SFX_ROLES.map(([r, label]) => `<label>${label} <select data-role="${r}">${Array.from({ length: n }, (_, i) => `<option value="${i}" ${cur[r] === i ? 'selected' : ''}>#${i}</option>`).join('')}<option value="-1" ${cur[r] < 0 ? 'selected' : ''}>없음</option></select></label>`).join('');
  roles.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => sel.onchange = () => { edits.sfx = { ...sfxRoles(), [sel.dataset.role as SfxRole]: +sel.value }; saveEdits(); if (+sel.value >= 0) sfx.play(+sel.value); });
  list.innerHTML = `<table><tr><th>#</th><th>길이</th><th></th></tr>${Array.from({ length: n }, (_, i) => { const w = data.sfx(i); const dv = w ? new DataView(w.buffer, w.byteOffset) : null; const sec = w && dv ? ((w.length - 44) / dv.getUint32(28, true)).toFixed(2) : '?'; return `<tr><td>${i}</td><td>${sec}s</td><td class="l"><button data-i="${i}">▶ 재생</button></td></tr>`; }).join('')}</table>`;
  list.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.onclick = () => sfx.play(+b.dataset.i!));
}
function buildNatials() {
  const host = $('natTable'); const nats = data.natials();
  if (!nats.length) { host.innerHTML = '<p class="muted">Vmtv2.exe를 파일 탭에서 넣으면 스탯이 표시됩니다.</p>'; return; }
  const cols = ['#', '', '이름', '공격명', '유지×8', ...STAT.flatMap((s) => [`${s}·L1`, `${s}·L2`, `${s}·L3`]), '이동', '속성', 'flag1', '사정', '마법', '이동형', 'MP'];
  let html = `<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  for (const n of nats) {
    const e = edits.natials[n.index] ?? n;
    const inp = (path: string, v: number, orig: number) => `<td><input type="number" min="0" data-i="${n.index}" data-p="${path}" value="${v}" class="${v !== orig ? 'chg' : ''}"></td>`;
    html += `<tr><td>${n.index}</td><td class="l port" data-k="${n.index}"></td><td class="l">${n.name}</td><td class="l">${n.attack}</td>${inp('hp', e.hp, n.hp)}`;
    for (let k = 0; k < 5; k++) for (let l = 0; l < 3; l++) html += inp(`stats.${k}.${l}`, e.stats[k][l], n.stats[k][l]);
    html += inp('move', e.move, n.move) + `<td>${ELEMENT[e.element] ?? e.element}</td>` + inp('flag1', e.flag1, n.flag1) + inp('range', e.range, n.range) + inp('spell', e.spell, n.spell) + `<td>${MOVETYPE[e.moveType] ?? e.moveType}</td>` + inp('cost', e.cost, n.cost) + '</tr>';
  }
  host.innerHTML = html + '</table><p class="muted small">게임 정보창 순서(⚔공격 🛡방어 ✨마공 🔰마방 👢속도)와 대조해 확인. 각 스탯은 레벨 1·2·3 값.</p>';
  host.querySelectorAll<HTMLElement>('td.port').forEach((td) => { const k = +td.dataset.k!; const c = portrait(k); if (c) { const t = document.createElement('canvas'); t.width = 48; t.height = 48; t.getContext('2d')!.drawImage(c, 0, 0, 48, 48 * c.height / c.width); td.appendChild(t); }
    const sp = spriteFrame(spriteEntryFor(k), 0); if (sp) { const t = document.createElement('canvas'); t.width = 48; t.height = 48; t.style.imageRendering = 'pixelated'; t.getContext('2d')!.drawImage(sp, 24, 40, 48, 48, 0, 0, 48, 48); td.appendChild(t); } });
  host.querySelectorAll<HTMLInputElement>('input').forEach((inp) => inp.onchange = () => {
    const i = +inp.dataset.i!; const base = nats[i]; const e = edits.natials[i] ?? (edits.natials[i] = JSON.parse(JSON.stringify(base)));
    const v = Math.max(0, Math.floor(+inp.value || 0)); const p = inp.dataset.p!.split('.');
    if (p[0] === 'stats') e.stats[+p[1]][+p[2]] = v; else (e as unknown as Record<string, number>)[p[0]] = v;
    inp.classList.toggle('chg', JSON.stringify(e) !== JSON.stringify(base)); saveEdits();
  });
}
function buildMasters() {
  $('masterTable').innerHTML = `<table><tr><th>#</th><th>이름</th><th>클래스</th><th>소개</th></tr>${data.masters.map((m) => `<tr><td>${m.index}</td><td class="l">${m.name}</td><td>${m.cls}</td><td class="l" style="white-space:pre-wrap">${m.desc}</td></tr>`).join('')}</table>`;
}

// ---------- export ----------
$('btnExportDat').onclick = () => {
  if (!loaded) return;
  try {
    const entries = data.entries.DATA10.slice();
    for (let i = 0; i < MAP_COUNT; i++) {
      const e = edits.maps[i]; if (!e) continue; const m = data.maps[i];
      entries[i] = compressStore(patchHeader(headerBase(m), e.name, e.desc, e.desc2, e.srcIndex !== i ? m.tilemapEntry : undefined));
      const tm = data.get('DATA10', m.tilemapEntry).slice(); new Uint8Array(tm.buffer, tm.byteOffset, 2048).set(new Uint8Array(Uint16Array.from(e.grid).buffer));
      entries[m.tilemapEntry] = compressStore(tm);
    }
    download('DATA10.DAT', writeArchive(entries)); status(`DATA10.DAT 생성 (수정 맵 ${Object.keys(edits.maps).length}개)`);
  } catch (err) { status(`내보내기 실패: ${(err as Error).message}`); }
};
$('btnExportExe').onclick = () => {
  if (!data.exe) { status('Vmtv2.exe가 없습니다'); return; }
  download('Vmtv2.exe', data.patchedExe(Object.values(edits.natials))); status(`Vmtv2.exe 생성 (수정 네이티얼 ${Object.keys(edits.natials).length}종)`);
};

const sfx = new Sfx(() => (loaded ? data : null), sfxRoles);
$<HTMLInputElement>('sfxOn').onchange = (e) => { sfx.enabled = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('sfxVol').oninput = (e) => { sfx.volume = +(e.target as HTMLInputElement).value; };
const battle = initBattle({ data: () => (loaded ? data : null), natials: () => data.natials().map((n) => edits.natials[n.index] ?? n), mapGrid: gridOf, mapTileset: (m) => rendererFor(m).ts, mapName: (m) => textOf(m).name, portrait, sfx, sprite: (id, side, frame) => { const e = id === 'master' ? -1 : id.startsWith('n') ? spriteEntryFor(+id.slice(1)) : -1; return e < 0 ? null : spriteFrame(e + side * 2, frame); }, masterSprite: (m, side, frame) => spriteFrame(MASTER_SPRITE(m) + side * 2, frame), walk: (id, side, frame, m) => { const e = id === 'master' ? MASTER_SPRITE(m) : id.startsWith('n') ? spriteEntryFor(+id.slice(1)) : -1; return e < 0 ? null : walkFrame(e + side * 2, frame); }, effect: effectFrame, facing, bgm: () => { const f = edits.bgm && data.extra[edits.bgm]; if (f) midi.play(f); }, bgmStop: () => midi.stop() });
loadAll();
