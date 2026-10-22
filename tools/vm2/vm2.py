#!/usr/bin/env python3
"""Vantage Master V2 (Vmtv2.exe, Korean release) modding toolchain.

  python3 vm2.py unpack  <gamedir> <outdir>            decompress every entry -> outdir/DATAxx/NNN.bin (+ index.json)
  python3 vm2.py pack    <gamedir> <moddir> <outdir>   rebuild DATAxx.DAT, replacing entries found in moddir/DATAxx/NNN.bin
  python3 vm2.py maps    <gamedir>                     list the 52 maps (name, tileset refs, description)
  python3 vm2.py map-export <gamedir> <map#> <out.json>   header + 32x32 tile grid + tile properties
  python3 vm2.py map-import <in.json> <moddir>            write edited tile grid / texts back as mod entries
  python3 vm2.py map-render <gamedir> <map#> <out.png>    schematic hex render (terrain colour + height)
  python3 vm2.py map-render-real <gamedir> <map#> <out.png> [scale]   real tile graphics
  python3 vm2.py editor <gamedir> <out.html>           self-contained browser map editor (all maps + tilesets embedded)
  python3 vm2.py masters <gamedir>                     dump the 38 enemy masters (name/class/description)
  python3 vm2.py natials <Vmtv2.exe>                   24 natial stat records from the EXE (.data 0x46DE80)
  python3 vm2.py natials-export <Vmtv2.exe> <out.json>
  python3 vm2.py natials-import <in.json> <Vmtv2.exe> <out.exe>   patch stats into a copy of the EXE
  python3 vm2.py text-export <gamedir> <out.json>      all map + natial texts
  python3 vm2.py text-import <in.json> <moddir>        texts back (same byte budget as original)

Formats (reverse-engineered, see docs/vm2-formats.md):
  LB DAT archive: "LB DAT\\x1a\\0", u32 count, pad, u32 offsets[count]; entries compressed with the
  two-mode Falcom codec implemented in lbdat.py. Resource ids are (file << 16 | entry).
  DATA10: 0-51 map headers, 52-89 natial texts, 90-171 tilesets (image, palette, tiledefs, tilemaps...),
          172-275 per-map derived tables (205000 = 25 natial types x 32x32 move-cost, 44720 = ?).
  Map header (716B+): name[16] (cp949), u32 ids: ?, ?, tileset image, palette, tiledefs, tilemap, bgm, ...
          description text at +120 (cp949, \\n), second text block (commentary) later.
  Tilemap: 32x32 u16 tile ids, odd rows shifted half a hex to the right.
  Tiledef (100B x 512): 2 x 24 u16 atlas-chunk ids (left/right 24px columns, 12px slabs, 0x7ff=none),
          +96 base height, +97 height (used for LOS), +98 terrain type, +99 flags.
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lbdat

FILES = ['DATA00', 'DATA08', 'DATA09', 'DATA10', 'DATA13']
TERRAIN = {0: '평지', 1: '사막', 2: '수풀', 3: '습지', 4: '적설', 5: '썩은늪', 6: '수면판', 7: '물(깊이1)', 8: '물(깊이2)', 9: '물(깊이3)',
           10: '장애물', 11: '허공', 12: '마법석(땅)', 13: '마법석(물)', 14: '마법석(불)', 15: '마법석(하늘)', 16: '벽'}
TERRAIN_RGB = {0: (120, 150, 80), 1: (210, 190, 120), 2: (40, 110, 50), 3: (90, 110, 70), 4: (230, 235, 240), 5: (80, 70, 40), 6: (120, 170, 200),
               7: (90, 140, 200), 8: (60, 110, 180), 9: (30, 70, 150), 10: (90, 90, 90), 11: (20, 20, 30), 12: (200, 120, 60), 13: (60, 120, 220),
               14: (220, 70, 50), 15: (200, 200, 240), 16: (50, 50, 60)}

MAP_COUNT, NATIAL_FIRST, NATIAL_COUNT = 52, 52, 38


def load(gamedir, name):
    return lbdat.read_archive(os.path.join(gamedir, name + '.DAT'))


def dec(entry):
    if entry[:4] == b'RIFF': return bytes(entry)
    return lbdat.decompress(entry)


def cstr(b, off, maxlen=None):
    end = b.find(b'\0', off)
    if maxlen is not None: end = min(end if end >= 0 else off + maxlen, off + maxlen)
    return b[off:end].decode('cp949', 'replace')


# ---------------- unpack / pack ----------------
def cmd_unpack(gamedir, outdir):
    index = {}
    for f in FILES:
        ents = load(gamedir, f)
        os.makedirs(os.path.join(outdir, f), exist_ok=True)
        index[f] = []
        for i, e in enumerate(ents):
            if not e.strip(b'\0'): index[f].append(None); continue
            try: d = dec(e)
            except Exception as ex: index[f].append({'error': str(ex)}); continue
            ext = 'wav' if e[:4] == b'RIFF' else 'bin'
            open(os.path.join(outdir, f, f'{i:03d}.{ext}'), 'wb').write(d)
            index[f].append({'size': len(d), 'raw': ext == 'wav'})
        print(f, len([x for x in index[f] if x]), 'entries')
    json.dump(index, open(os.path.join(outdir, 'index.json'), 'w'), indent=1)


def cmd_pack(gamedir, moddir, outdir):
    os.makedirs(outdir, exist_ok=True)
    for f in FILES:
        ents = list(load(gamedir, f))
        changed = 0
        d = os.path.join(moddir, f)
        if os.path.isdir(d):
            for fn in sorted(os.listdir(d)):
                if not fn[:3].isdigit(): continue
                i = int(fn[:3]); data = open(os.path.join(d, fn), 'rb').read()
                ents[i] = data if fn.endswith('.wav') else lbdat.compress_store(data)
                if len(ents[i]) > 0xC0000: print(f'  WARNING {f}/{fn}: packed size {len(ents[i])} exceeds the game read buffer (786432)')
                changed += 1
        lbdat.write_archive(os.path.join(outdir, f + '.DAT'), ents)
        print(f, 'written,', changed, 'entries replaced')


# ---------------- maps ----------------
def map_header(d):
    ids = struct.unpack_from('<8I', d, 16)
    nums = struct.unpack_from('<18I', d, 48)
    desc = cstr(d, 120)
    # second text block: next 《 after the first text
    p = d.find(b'\xa1\xb6', 120 + len(desc.encode('cp949', 'replace')) + 1)
    desc2 = cstr(d, p) if p > 0 else ''
    return {'name': cstr(d, 0, 16), 'ids': [f'{v >> 16:02d}:{v & 0xffff}' for v in ids], 'nums': list(nums),
            'desc': desc, 'desc2': desc2, 'desc_off': 120, 'desc2_off': p}


def rid(s):
    f, e = s.split(':'); return int(f), int(e)


def cmd_maps(gamedir):
    ents = load(gamedir, 'DATA10')
    for i in range(MAP_COUNT):
        h = map_header(dec(ents[i]))
        print(f'{i:2d} {h["name"]:<14s} img={h["ids"][2]} pal={h["ids"][3]} defs={h["ids"][4]} grid={h["ids"][5]} bgm={h["ids"][6]}  {h["desc"].splitlines()[1] if len(h["desc"].splitlines()) > 1 else ""}')


def tiledefs(d):
    out = []
    for t in range(512):
        r = d[t * 100:(t + 1) * 100]
        out.append({'left': list(struct.unpack_from('<24H', r, 0)), 'right': list(struct.unpack_from('<24H', r, 48)),
                    'base': r[96], 'height': r[97], 'terrain': r[98], 'flags': r[99]})
    return out


def cmd_map_export(gamedir, n, out):
    n = int(n); ents = load(gamedir, 'DATA10'); hd = dec(ents[n]); h = map_header(hd)
    _, gi = rid(h['ids'][5]); _, di = rid(h['ids'][4])
    grid = list(struct.unpack('<1024H', dec(ents[gi])))
    defs = tiledefs(dec(ents[di]))
    used = sorted(set(grid))
    doc = {'map': n, 'name': h['name'], 'desc': h['desc'], 'desc2': h['desc2'], 'ids': h['ids'], 'nums': h['nums'],
           'tilemap_entry': gi, 'tiledef_entry': di,
           'grid': [grid[r * 32:(r + 1) * 32] for r in range(32)],
           'tiles_used': {t: {'height': defs[t]['height'], 'base': defs[t]['base'], 'terrain': defs[t]['terrain'], 'terrain_name': TERRAIN.get(defs[t]['terrain'], '?'), 'flags': defs[t]['flags']} for t in used}}
    json.dump(doc, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('wrote', out, '— tiles used:', used)


def write_text_into(buf, off, text, limit):
    enc = text.replace('\r\n', '\n').encode('cp949', 'replace')
    if len(enc) + 1 > limit: raise SystemExit(f'text too long: {len(enc)} > {limit - 1} bytes')
    buf[off:off + limit] = enc + b'\0' * (limit - len(enc))


def cmd_map_import(injson, moddir):
    doc = json.load(open(injson, encoding='utf-8'))
    gamedir = doc.get('gamedir')
    os.makedirs(os.path.join(moddir, 'DATA10'), exist_ok=True)
    grid = [v for row in doc['grid'] for v in row]
    assert len(grid) == 1024
    open(os.path.join(moddir, 'DATA10', f'{doc["tilemap_entry"]:03d}.bin'), 'wb').write(struct.pack('<1024H', *grid))
    print('tilemap ->', f'DATA10/{doc["tilemap_entry"]:03d}.bin')
    if doc.get('header_b64') and not doc.get('header_src'):
        import base64; doc['header_src'] = None; hd0 = base64.b64decode(doc['header_b64'])
    else: hd0 = open(doc['header_src'], 'rb').read() if doc.get('header_src') else None
    if hd0 is not None:
        hd = bytearray(hd0)
        h = map_header(bytes(hd))
        hd[0:16] = doc['name'].encode('cp949', 'replace')[:15].ljust(16, b'\0')
        limit = (h['desc2_off'] if h['desc2_off'] > 0 else len(hd)) - h['desc_off']
        write_text_into(hd, h['desc_off'], doc['desc'], limit)
        if h['desc2_off'] > 0: write_text_into(hd, h['desc2_off'], doc['desc2'], len(hd) - h['desc2_off'])
        if doc.get('target_tilemap_entry') is not None:  # copying into another slot: point the header at that slot's tilemap entry
            struct.pack_into('<I', hd, 16 + 5 * 4, (10 << 16) | doc['target_tilemap_entry'])
        open(os.path.join(moddir, 'DATA10', f'{doc["map"]:03d}.bin'), 'wb').write(hd)
        print('header ->', f'DATA10/{doc["map"]:03d}.bin')


def cmd_map_render(gamedir, n, out):
    from PIL import Image, ImageDraw
    n = int(n); ents = load(gamedir, 'DATA10'); h = map_header(dec(ents[n]))
    _, gi = rid(h['ids'][5]); _, di = rid(h['ids'][4])
    grid = struct.unpack('<1024H', dec(ents[gi])); defs = tiledefs(dec(ents[di]))
    W = 24; HX = 20  # hex half-width / row step
    img = Image.new('RGB', (32 * 2 * W + W + 8, 32 * HX + 40), (12, 12, 20)); dr = ImageDraw.Draw(img)
    for r in range(32):
        for c in range(32):
            t = defs[grid[r * 32 + c]]; col = TERRAIN_RGB.get(t['terrain'], (255, 0, 255))
            k = 0.75 + 0.05 * min(5, t['height']); col = tuple(min(255, int(v * k)) for v in col)
            cx = c * 2 * W + (r % 2) * W + W + 4; cy = r * HX + 16
            pts = [(cx, cy - 12), (cx + W, cy - 6), (cx + W, cy + 6), (cx, cy + 12), (cx - W, cy + 6), (cx - W, cy - 6)]
            dr.polygon(pts, fill=col, outline=(20, 20, 30))
            if t['height']: dr.text((cx - 3, cy - 5), str(t['height']), fill=(0, 0, 0))
    img.save(out); print('wrote', out)


# ---------------- real tile rendering ----------------
CHUNK_W, CHUNK_H = 24, 12          # atlas chunk (slab) size
HEX_W, ROW_STEP, ODD_OFF = 48, 18, 24


def tileset_of(ents, mapidx):
    h = map_header(dec(ents[mapidx]))
    _, img = rid(h['ids'][2]); _, pal = rid(h['ids'][3]); _, di = rid(h['ids'][4]); _, gi = rid(h['ids'][5])
    return h, dec(ents[img]), dec(ents[pal]), dec(ents[di]), gi


def palette_rgba(pal):
    cols = [(pal[i], pal[i + 1], pal[i + 2]) for i in range(0, len(pal), 4)]  # R,G,B,flag
    lut = [(0, 0, 0, 0)] * 256
    for v in range(17, 256):
        i = v - 17
        lut[v] = cols[i] + (255,) if i < len(cols) else (min(255, (v - 16) * 2 + 40),) * 3 + (255,)
    return lut


def atlas_image(atlas, pal):
    """whole atlas as one RGBA image, chunks stacked vertically (24 x 12*N)"""
    from PIL import Image
    lut = palette_rgba(pal); n = len(atlas) // (CHUNK_W * CHUNK_H)
    img = Image.new('RGBA', (CHUNK_W, CHUNK_H * n))
    img.putdata([lut[v] for v in atlas[:CHUNK_W * CHUNK_H * n]])
    return img, n


def render_tile(img, n, defs, idx, night=False):
    """48 x (12*24) RGBA tile image; slot k of each column is drawn at row (23-k) (bottom-up)."""
    from PIL import Image
    out = Image.new('RGBA', (HEX_W, CHUNK_H * 24), (0, 0, 0, 0))
    for half in (0, 1):
        ids = struct.unpack_from('<24H', defs, idx * 100 + half * 48)
        for k, i in enumerate(ids):
            if i == 0x7ff or i >= n: continue
            out.alpha_composite(img.crop((0, i * CHUNK_H, CHUNK_W, (i + 1) * CHUNK_H)), (half * CHUNK_W, (23 - k) * CHUNK_H))
    return out


def cmd_map_render_real(gamedir, n, out, scale=2):
    from PIL import Image
    n = int(n); ents = load(gamedir, 'DATA10'); h, atlas, pal, defs, gi = tileset_of(ents, n)
    grid = struct.unpack('<1024H', dec(ents[gi]))
    img, cnt = atlas_image(atlas, pal); cache = {}
    W = 32 * HEX_W + ODD_OFF + 16; H = 32 * ROW_STEP + 24 * CHUNK_H + 16
    canvas = Image.new('RGBA', (W, H), (12, 12, 20, 255))
    for r in range(32):
        for c in range(32):
            t = grid[r * 32 + c]
            if t not in cache: cache[t] = render_tile(img, cnt, defs, t)
            tile = cache[t]; base = r * ROW_STEP + 24 * CHUNK_H + 8
            canvas.alpha_composite(tile, (c * HEX_W + (r % 2) * ODD_OFF + 8, base - tile.height))
    # crop empty top
    bbox = canvas.getbbox()
    if scale != 1: canvas = canvas.resize((canvas.width * scale, canvas.height * scale), Image.NEAREST)
    canvas.save(out); print('wrote', out, canvas.size, h['name'])


def cmd_editor(gamedir, out):
    """Generate a self-contained HTML map editor with every tileset + map embedded."""
    import base64, io
    from PIL import Image
    ents = load(gamedir, 'DATA10')
    tilesets = {}; maps = []
    for n in range(MAP_COUNT):
        hd = dec(ents[n]); h = map_header(hd)
        _, img_i = rid(h['ids'][2]); _, pal_i = rid(h['ids'][3]); _, di = rid(h['ids'][4]); _, gi = rid(h['ids'][5])
        key = f'{img_i}'
        if key not in tilesets:
            img, cnt = atlas_image(dec(ents[img_i]), dec(ents[pal_i]))
            buf = io.BytesIO(); img.save(buf, 'PNG')
            defs = tiledefs(dec(ents[di]))
            tilesets[key] = {'atlas': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), 'chunks': cnt,
                             'defs': [[d['left'], d['right'], d['base'], d['height'], d['terrain'], d['flags']] for d in defs],
                             'img': img_i, 'pal': pal_i, 'defs_entry': di}
        maps.append({'map': n, 'name': h['name'], 'desc': h['desc'], 'desc2': h['desc2'], 'tileset': key, 'tilemap_entry': gi, 'tiledef_entry': di,
                     'grid': list(struct.unpack('<1024H', dec(ents[gi]))), 'header_b64': base64.b64encode(hd).decode()})
    data = json.dumps({'tilesets': tilesets, 'maps': maps, 'terrain': TERRAIN}, ensure_ascii=False)
    tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'editor.html'), encoding='utf-8').read()
    open(out, 'w', encoding='utf-8').write(tpl.replace('/*__DATA__*/null', data))
    print('wrote', out, f'({os.path.getsize(out) // 1024} KB)')


# ---------------- natial stats (EXE) ----------------
NAT_VA, NAT_COUNT, NAT_SIZE, IMG_BASE = 0x46DE80, 24, 0x58, 0x400000
STAT_NAMES = ['s1_atk', 's2_def', 's3_mag', 's4_mdef', 's5_spd']  # order guessed; values per level 1..3
ELEMENT = {1: '땅', 2: '물', 3: '불', 4: '하늘'}
MOVETYPE = {0: '걷기', 1: '걷기2', 2: '헤엄', 3: '헤엄2', 4: '날기'}


def exe_sections(exe):
    # [(va, size, raw_off)] from the PE section table
    b = open(exe, 'rb').read()
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    nsec = struct.unpack_from('<H', b, pe + 6)[0]; opt = struct.unpack_from('<H', b, pe + 20)[0]
    secs = []
    for i in range(nsec):
        o = pe + 24 + opt + i * 40
        vs, va, rs, ro = struct.unpack_from('<IIII', b, o + 8)
        secs.append((va, max(vs, rs), ro))
    return b, secs


def va_to_off(secs, va):
    rva = va - IMG_BASE
    for sva, size, ro in secs:
        if sva <= rva < sva + size: return rva - sva + ro
    raise SystemExit(f'va {va:#x} not in any section')


def exe_cstr(b, secs, va):
    o = va_to_off(secs, va); e = b.find(b'\0', o); return b[o:e].decode('cp949', 'replace')


def read_natials(exe):
    b, secs = exe_sections(exe); base = va_to_off(secs, NAT_VA); out = []
    for i in range(NAT_COUNT):
        r = b[base + i * NAT_SIZE: base + (i + 1) * NAT_SIZE]; v = struct.unpack('<22I', r)
        flags = r[0x44:0x48]
        out.append({'index': i, 'name': exe_cstr(b, secs, v[20]), 'attack': exe_cstr(b, secs, v[21]), 'hp': v[0],
                    **{STAT_NAMES[k]: list(v[1 + 3 * k:4 + 3 * k]) for k in range(5)},
                    'move': v[16], 'element': flags[0], 'element_name': ELEMENT.get(flags[0], '?'), 'flag1': flags[1], 'range': flags[2], 'spell': flags[3],
                    'move_type': v[18], 'move_type_name': MOVETYPE.get(v[18], '?'), 'cost': v[19]})
    return out


def cmd_natials(exe):
    for n in read_natials(exe):
        st = ' '.join(f'{"/".join(map(str, n[k])):>8s}' for k in STAT_NAMES)
        print(f'{n["index"]:2d} {n["name"]:<8s} {n["element_name"]:2s} HP{n["hp"]:3d} {st} 이동{n["move"]} {n["move_type_name"]:<4s} 사정{n["range"]} 마법{n["spell"]:#04x} MP{n["cost"]:5d}  ({n["attack"]})')


def cmd_natials_export(exe, out):
    json.dump(read_natials(exe), open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); print('wrote', out)


def cmd_natials_import(injson, exe, outexe):
    doc = json.load(open(injson, encoding='utf-8')); b, secs = exe_sections(exe); b = bytearray(b); base = va_to_off(secs, NAT_VA)
    for n in doc:
        i = n['index']; o = base + i * NAT_SIZE
        struct.pack_into('<I', b, o, n['hp'])
        for k, key in enumerate(STAT_NAMES): struct.pack_into('<3I', b, o + 4 + 12 * k, *n[key])
        struct.pack_into('<I', b, o + 0x40, n['move'])
        b[o + 0x44:o + 0x48] = bytes([n['element'], n['flag1'], n['range'], n['spell']])
        struct.pack_into('<II', b, o + 0x48, n['move_type'], n['cost'])
    open(outexe, 'wb').write(b); print('wrote', outexe, '(names are a string pool: not patched)')


# ---------------- masters / text ----------------
def natial_entry(d):
    return {'name': cstr(d, 0, 20), 'element': d[20], 'desc': cstr(d, 28), 'tail': list(struct.unpack_from('<3I', d, len(d) - 12))}


def cmd_masters(gamedir):
    ents = load(gamedir, 'DATA10')
    for i in range(NATIAL_FIRST, NATIAL_FIRST + NATIAL_COUNT):
        e = natial_entry(dec(ents[i]))
        print(f'{i:3d} {e["name"]:<12s} elem={e["element"]} tail={e["tail"]}  {e["desc"].splitlines()[1] if len(e["desc"].splitlines()) > 1 else ""}')


def cmd_text_export(gamedir, out):
    ents = load(gamedir, 'DATA10'); doc = {'maps': {}, 'natials': {}}
    for i in range(MAP_COUNT):
        h = map_header(dec(ents[i])); doc['maps'][i] = {'name': h['name'], 'desc': h['desc'], 'desc2': h['desc2']}
    for i in range(NATIAL_FIRST, NATIAL_FIRST + NATIAL_COUNT):
        e = natial_entry(dec(ents[i])); doc['natials'][i] = {'name': e['name'], 'desc': e['desc']}
    json.dump(doc, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); print('wrote', out)


def cmd_text_import(gamedir, injson, moddir):
    doc = json.load(open(injson, encoding='utf-8')); ents = load(gamedir, 'DATA10')
    os.makedirs(os.path.join(moddir, 'DATA10'), exist_ok=True)
    for k, v in doc['maps'].items():
        i = int(k); hd = bytearray(dec(ents[i])); h = map_header(bytes(hd))
        hd[0:16] = v['name'].encode('cp949', 'replace')[:15].ljust(16, b'\0')
        limit = (h['desc2_off'] if h['desc2_off'] > 0 else len(hd)) - h['desc_off']
        write_text_into(hd, h['desc_off'], v['desc'], limit)
        if h['desc2_off'] > 0 and 'desc2' in v: write_text_into(hd, h['desc2_off'], v['desc2'], len(hd) - h['desc2_off'])
        open(os.path.join(moddir, 'DATA10', f'{i:03d}.bin'), 'wb').write(hd)
    for k, v in doc['natials'].items():
        i = int(k); hd = bytearray(dec(ents[i]))
        hd[0:20] = v['name'].encode('cp949', 'replace')[:19].ljust(20, b'\0')
        write_text_into(hd, 28, v['desc'], len(hd) - 12 - 28)
        open(os.path.join(moddir, 'DATA10', f'{i:03d}.bin'), 'wb').write(hd)
    print('mod entries written to', moddir)


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: print(__doc__); sys.exit(1)
    c = a[0]
    try:
        if c == 'unpack': cmd_unpack(a[1], a[2])
        elif c == 'pack': cmd_pack(a[1], a[2], a[3])
        elif c == 'maps': cmd_maps(a[1])
        elif c == 'map-export': cmd_map_export(a[1], a[2], a[3])
        elif c == 'map-import': cmd_map_import(a[1], a[2])
        elif c == 'map-render': cmd_map_render(a[1], a[2], a[3])
        elif c == 'map-render-real': cmd_map_render_real(a[1], a[2], a[3], int(a[4]) if len(a) > 4 else 2)
        elif c == 'editor': cmd_editor(a[1], a[2])
        elif c == 'masters': cmd_masters(a[1])
        elif c == 'natials': cmd_natials(a[1])
        elif c == 'natials-export': cmd_natials_export(a[1], a[2])
        elif c == 'natials-import': cmd_natials_import(a[1], a[2], a[3])
        elif c == 'text-export': cmd_text_export(a[1], a[2])
        elif c == 'text-import': cmd_text_import(a[1], a[2], a[3])
        else: print(__doc__)
    except IndexError:
        print(__doc__)
