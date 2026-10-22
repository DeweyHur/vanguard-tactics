#!/usr/bin/env python3
"""Vantage Master V2 (Vmtv2.exe, Korean release) modding toolchain.

  python3 vm2.py unpack  <gamedir> <outdir>            decompress every entry -> outdir/DATAxx/NNN.bin (+ index.json)
  python3 vm2.py pack    <gamedir> <moddir> <outdir>   rebuild DATAxx.DAT, replacing entries found in moddir/DATAxx/NNN.bin
  python3 vm2.py maps    <gamedir>                     list the 52 maps (name, tileset refs, description)
  python3 vm2.py map-export <gamedir> <map#> <out.json>   header + 32x32 tile grid + tile properties
  python3 vm2.py map-import <in.json> <moddir>            write edited tile grid / texts back as mod entries
  python3 vm2.py map-render <gamedir> <map#> <out.png>    schematic hex render (terrain colour + height)
  python3 vm2.py natials <gamedir>                     dump natial (unit) name/description entries
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
    if doc.get('header_src'):
        hd = bytearray(open(doc['header_src'], 'rb').read())
        h = map_header(bytes(hd))
        hd[0:16] = doc['name'].encode('cp949', 'replace')[:15].ljust(16, b'\0')
        limit = (h['desc2_off'] if h['desc2_off'] > 0 else len(hd)) - h['desc_off']
        write_text_into(hd, h['desc_off'], doc['desc'], limit)
        if h['desc2_off'] > 0: write_text_into(hd, h['desc2_off'], doc['desc2'], len(hd) - h['desc2_off'])
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


# ---------------- natials / text ----------------
def natial_entry(d):
    return {'name': cstr(d, 0, 20), 'element': d[20], 'desc': cstr(d, 28), 'tail': list(struct.unpack_from('<3I', d, len(d) - 12))}


def cmd_natials(gamedir):
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
        elif c == 'natials': cmd_natials(a[1])
        elif c == 'text-export': cmd_text_export(a[1], a[2])
        elif c == 'text-import': cmd_text_import(a[1], a[2], a[3])
        else: print(__doc__)
    except IndexError:
        print(__doc__)
