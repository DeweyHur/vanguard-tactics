/**
 * Falcom "LB DAT" archive + the two-mode entry codec used by Vantage Master V2 (Vmtv2.exe @0x4484e0).
 * Port of tools/vm2/lbdat.py — see docs/vm2-formats.md.
 */

export function readArchive(buf: Uint8Array): Uint8Array[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(...buf.subarray(0, 6));
  if (magic !== 'LB DAT') throw new Error('not an LB DAT archive');
  const n = dv.getUint32(8, true);
  const offs: number[] = [];
  for (let i = 0; i <= n; i++) offs.push(dv.getUint32(0x10 + i * 4, true));
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    if (offs[i] === 0) { out.push(new Uint8Array(0)); continue; }
    let end = buf.length;
    for (let j = i + 1; j <= n; j++) if (offs[j]) { end = offs[j]; break; }
    out.push(buf.subarray(offs[i], end));
  }
  return out;
}

class Bits {
  flags = 0; n = 0;
  constructor(public src: Uint8Array, public pos: number) {}
  bit(): number {
    if (this.n === 0) { this.flags = this.src[this.pos] | (this.src[this.pos + 1] << 8); this.pos += 2; this.n = 16; }
    const v = this.flags & 1; this.flags >>= 1; this.n--; return v;
  }
  bits(k: number): number { let v = 0; for (let i = 0; i < k; i++) v = (v << 1) | this.bit(); return v; }
  byte(): number { return this.src[this.pos++]; }
}

class Out {
  buf = new Uint8Array(1 << 16); len = 0;
  push(v: number) { if (this.len === this.buf.length) this.grow(); this.buf[this.len++] = v; }
  grow() { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
  copy(off: number, ln: number) { const start = this.len - off; for (let i = 0; i < ln; i++) this.push(this.buf[start + i]); }
  fill(v: number, ln: number) { for (let i = 0; i < ln; i++) this.push(v); }
  bytes(): Uint8Array { return this.buf.subarray(0, this.len); }
}

function mode0(src: Uint8Array, pos: number, out: Out): number {
  const br = new Bits(src, pos + 2); br.flags = src[pos + 1]; br.n = 8;
  for (;;) {
    if (!br.bit()) { out.push(br.byte()); continue; }
    let off: number;
    if (!br.bit()) off = br.byte();
    else {
      off = (br.bits(5) << 8) | br.byte();
      if (off === 0) return br.pos;
      if (off === 1) {
        const run = !br.bit() ? br.bits(4) : ((br.bits(4) << 8) | br.byte());
        out.fill(br.byte(), run + 14); continue;
      }
    }
    let ln: number;
    if (br.bit()) ln = 2; else if (br.bit()) ln = 3; else if (br.bit()) ln = 4; else if (br.bit()) ln = 5;
    else if (!br.bit()) ln = br.byte() + 14; else ln = br.bits(3) + 6;
    out.copy(off, ln);
  }
}

function mode1(src: Uint8Array, pos: number, size: number, out: Out): number {
  let cnt = 2;
  while (cnt !== size) {
    const c = src[pos++]; cnt++;
    if (c & 0x80) {
      const off = ((c & 0x1f) << 8) | src[pos++]; cnt++;
      const ln = ((c >> 5) & 3) + 4;
      let start = out.len - off;
      for (let i = 0; i < ln; i++) out.push(out.buf[start + i]);
      start += ln;
      while (cnt !== size && (src[pos] & 0xe0) === 0x60) {
        const n = src[pos++] & 0x1f; cnt++;
        for (let i = 0; i < n; i++) out.push(out.buf[start + i]);
        start += n;
      }
    } else if (c & 0x40) {
      let ln: number, val: number;
      if (c & 0x10) { ln = (((c & 0xf) << 8) | src[pos]) + 4; val = src[pos + 1]; pos += 2; cnt += 2; }
      else { val = src[pos++]; cnt++; ln = (c & 0xf) + 4; }
      out.fill(val, ln);
    } else if (c & 0x20) {
      const ln = ((c & 0x1f) << 8) | src[pos++]; cnt += 1 + ln;
      for (let i = 0; i < ln; i++) out.push(src[pos + i]);
      pos += ln;
    } else {
      const ln = c & 0x1f; cnt += ln;
      for (let i = 0; i < ln; i++) out.push(src[pos + i]);
      pos += ln;
    }
  }
  return pos;
}

export function decompress(entry: Uint8Array): Uint8Array {
  if (entry.length >= 4 && String.fromCharCode(...entry.subarray(0, 4)) === 'RIFF') return entry;
  const out = new Out(); let pos = 0;
  for (;;) {
    const size = entry[pos] | (entry[pos + 1] << 8);
    pos = entry[pos + 2] === 0 ? mode0(entry, pos + 2, out) : mode1(entry, pos + 2, size, out);
    if (pos >= entry.length || entry[pos] === 0) break;
    pos++;
  }
  return out.bytes().slice();
}

/** store-only encoding (literal runs) the game's decoder accepts */
export function compressStore(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []; let pos = 0; const n = data.length; let first = true;
  while (pos < n || first) {
    first = false;
    const parts: Uint8Array[] = []; let clen = 0;
    while (pos < n && clen < 0xff00) {
      const run = Math.min(0x1fff, n - pos, 0xff00 - clen);
      parts.push(new Uint8Array([0x20 | (run >> 8), run & 0xff]), data.subarray(pos, pos + run));
      clen += 2 + run; pos += run;
    }
    if (clen === 0) { parts.push(new Uint8Array([0x20, 0])); clen = 2; }
    const size = clen + 2;
    chunks.push(new Uint8Array([size & 0xff, size >> 8]), ...parts, new Uint8Array([pos < n ? 1 : 0]));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0); const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function writeArchive(entries: Uint8Array[]): Uint8Array {
  const n = entries.length; const tableEnd = 0x10 + 4 * (n + 1);
  let last = 0; entries.forEach((e, i) => { if (e.length) last = i; });
  const offs: number[] = []; let pos = tableEnd;
  entries.forEach((e, i) => { offs.push(i <= last ? pos : 0); pos += e.length; });
  offs.push(last === n - 1 ? pos : 0);
  if (last < n - 1) offs[last + 1] = pos;
  const out = new Uint8Array(pos); const dv = new DataView(out.buffer);
  out.set([0x4c, 0x42, 0x20, 0x44, 0x41, 0x54, 0x1a, 0]); dv.setUint32(8, n, true);
  offs.forEach((v, i) => dv.setUint32(0x10 + i * 4, v, true));
  let o = tableEnd; for (const e of entries) { out.set(e, o); o += e.length; }
  return out;
}
