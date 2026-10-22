import './style.css';
import { VM2Data, TERRAIN, ELEMENT, MOVETYPE, MAP_COUNT, patchHeader, type MapInfo, type MapHeader, type Natial, HEX_W, CHUNK_H, TILE_H } from './vm2data';
import { TileRenderer, drawMap, worldSize, pickCell, cellOrigin, hexPath } from './render';
import { compressStore, writeArchive } from './lbdat';
import { putFile, getAll, clearAll, download } from './store';
import { initBattle } from './battleUi';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => { $('status').textContent = s; };

// ---------- edit state (persisted in IndexedDB as __edits.json) ----------
interface MapEdit { srcIndex: number; name: string; desc: string; desc2: string; grid: number[] }
interface Edits { maps: Record<number, MapEdit>; natials: Record<number, Natial> }
let edits: Edits = { maps: {}, natials: {} };
let saveTimer = 0;
function saveEdits() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => putFile('__edits.json', new TextEncoder().encode(JSON.stringify(edits))).catch(() => {}), 300);
}

// ---------- data ----------
const data = new VM2Data();
let loaded = false;
const renderers = new Map<string, TileRenderer>();
const rendererFor = (m: MapInfo) => { const ts = headerBase(m) === m.header ? m.tileset : data.maps[edits.maps[m.index].srcIndex].tileset; let r = renderers.get(ts.key); if (!r) { r = new TileRenderer(ts); renderers.set(ts.key, r); } return r; };
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
    if (n === '__edits.json') { try { edits = JSON.parse(new TextDecoder().decode(b)); } catch { /* ignore */ } continue; }
    game[n] = b; const d = document.createElement('div'); d.innerHTML = `<span>${n}</span><span class="muted">${(b.length / 1024).toFixed(0)} KB</span>`; list.appendChild(d);
  }
  if (!Object.keys(game).length) { status('파일 없음 — 파일 탭에서 게임 파일을 넣어주세요'); return; }
  try { data.load(game); loaded = true; renderers.clear(); }
  catch (e) { status(`읽기 실패: ${(e as Error).message}`); return; }
  status(`맵 ${data.maps.length} · 타일셋 ${data.tilesets.size} · 마스터 ${data.masters.length}${data.exe ? ' · EXE 있음' : ' · EXE 없음(스탯 편집 불가)'}`);
  buildMapList(); buildNatials(); buildMasters(); selectMap(cur); battle.populate();
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
    if (!/^DATA\d\d\.DAT$/.test(up) && up !== 'VMTV2.EXE') continue;
    await putFile(up, new Uint8Array(await f.arrayBuffer())); n++;
  }
  status(`${n}개 저장`); await loadAll();
}
$('btnClear').onclick = async () => { if (confirm('브라우저에 저장된 게임 파일과 수정 내용을 모두 지울까요?')) { await clearAll(); location.reload(); } };
$('btnResetMods').onclick = () => { if (confirm('수정 내용을 전부 되돌릴까요?')) { edits = { maps: {}, natials: {} }; saveEdits(); loadAll(); } };

// ---------- tabs ----------
document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'maps') fitView();
  if (b.dataset.tab === 'battle') battle.onShow();
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
const STAT = ['스탯1', '스탯2', '스탯3', '스탯4', '스탯5'];
function buildNatials() {
  const host = $('natTable'); const nats = data.natials();
  if (!nats.length) { host.innerHTML = '<p class="muted">Vmtv2.exe를 파일 탭에서 넣으면 스탯이 표시됩니다.</p>'; return; }
  const cols = ['#', '이름', '공격명', 'HP', ...STAT.flatMap((s) => [`${s}·L1`, `${s}·L2`, `${s}·L3`]), '이동', '속성', 'flag1', '사정', '마법', '이동형', 'MP'];
  let html = `<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  for (const n of nats) {
    const e = edits.natials[n.index] ?? n;
    const inp = (path: string, v: number, orig: number) => `<td><input type="number" min="0" data-i="${n.index}" data-p="${path}" value="${v}" class="${v !== orig ? 'chg' : ''}"></td>`;
    html += `<tr><td>${n.index}</td><td class="l">${n.name}</td><td class="l">${n.attack}</td>${inp('hp', e.hp, n.hp)}`;
    for (let k = 0; k < 5; k++) for (let l = 0; l < 3; l++) html += inp(`stats.${k}.${l}`, e.stats[k][l], n.stats[k][l]);
    html += inp('move', e.move, n.move) + `<td>${ELEMENT[e.element] ?? e.element}</td>` + inp('flag1', e.flag1, n.flag1) + inp('range', e.range, n.range) + inp('spell', e.spell, n.spell) + `<td>${MOVETYPE[e.moveType] ?? e.moveType}</td>` + inp('cost', e.cost, n.cost) + '</tr>';
  }
  host.innerHTML = html + '</table><p class="muted small">스탯1~5의 의미(공/방/마/마방/속도 추정)는 아직 미확인. 각 스탯은 레벨 1·2·3 값.</p>';
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

const battle = initBattle({ data: () => (loaded ? data : null), natials: () => data.natials().map((n) => edits.natials[n.index] ?? n), mapGrid: gridOf, mapTileset: (m) => rendererFor(m).ts, mapName: (m) => textOf(m).name });
loadAll();
