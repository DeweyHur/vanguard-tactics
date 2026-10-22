"""LB DAT archive reader + Falcom chunked decompressor (Vantage Master V2, Vmtv2.exe @ 0x4484e0).

Entry = sequence of chunks. chunk: u16 size (incl. these 2 bytes), then data.
  data[0] == 0 -> bit-flag LZ (FALCOM2 style)
  data[0] != 0 -> byte-coded LZ/RLE (FALCOM1/C77 style)
After each chunk a continuation byte: nonzero -> another chunk follows.
"""
import struct


def read_archive(path):
    b = open(path, 'rb').read()
    assert b[:8] == b'LB DAT\x1a\x00', 'not an LB DAT archive'
    n = struct.unpack_from('<I', b, 8)[0]
    # the table has count+1 slots: the slot after the last entry holds the end offset; unused slots are 0
    offs = list(struct.unpack_from(f'<{n + 1}I', b, 0x10))
    out = []
    for i in range(n):
        if offs[i] == 0:
            out.append(b'')
            continue
        end = len(b)
        for j in range(i + 1, n + 1):
            if offs[j]:
                end = offs[j]
                break
        out.append(b[offs[i]:end])
    return out


class _Bits:
    def __init__(self, src, pos):
        self.src = src; self.pos = pos; self.flags = 0; self.n = 0

    def bit(self):
        if self.n == 0:
            self.flags = struct.unpack_from('<H', self.src, self.pos)[0]; self.pos += 2; self.n = 16
        v = self.flags & 1; self.flags >>= 1; self.n -= 1
        return v

    def bits(self, k):  # MSB first
        v = 0
        for _ in range(k): v = (v << 1) | self.bit()
        return v

    def byte(self):
        v = self.src[self.pos]; self.pos += 1
        return v


def _mode0(src, pos, out):
    """bit-flag LZ. returns new pos."""
    br = _Bits(src, pos)
    br.flags = src[pos + 1]; br.n = 8; br.pos = pos + 2
    while True:
        if not br.bit():
            out.append(br.byte()); continue
        if not br.bit():
            off = br.byte()
        else:
            off = (br.bits(5) << 8) | br.byte()
            if off == 0:
                return br.pos
            if off == 1:  # RLE
                if not br.bit():
                    run = br.bits(4)
                else:
                    run = (br.bits(4) << 8) | br.byte()
                val = br.byte()
                out.extend([val] * (run + 14))
                continue
        # match length
        if br.bit(): ln = 2
        elif br.bit(): ln = 3
        elif br.bit(): ln = 4
        elif br.bit(): ln = 5
        elif not br.bit(): ln = br.byte() + 14
        else: ln = br.bits(3) + 6
        start = len(out) - off
        for i in range(ln): out.append(out[start + i])


def _mode1(src, pos, size, out):
    """byte-coded LZ/RLE. `size` = chunk size incl. 2-byte header; counter starts at 2."""
    cnt = 2
    while cnt != size:
        c = src[pos]; pos += 1; cnt += 1
        if c & 0x80:
            off = ((c & 0x1f) << 8) | src[pos]; pos += 1; cnt += 1
            ln = ((c >> 5) & 3) + 4
            start = len(out) - off
            for i in range(ln): out.append(out[start + i])
            start += ln
            while cnt != size and (src[pos] & 0xe0) == 0x60:
                n = src[pos] & 0x1f; pos += 1; cnt += 1
                for i in range(n): out.append(out[start + i])
                start += n
        elif c & 0x40:
            if c & 0x10:
                ln = (((c & 0xf) << 8) | src[pos]) + 4; val = src[pos + 1]; pos += 2; cnt += 2
            else:
                val = src[pos]; pos += 1; cnt += 1; ln = (c & 0xf) + 4
            out.extend([val] * ln)
        elif c & 0x20:
            ln = ((c & 0x1f) << 8) | src[pos]; pos += 1; cnt += 1 + ln
            out.extend(src[pos:pos + ln]); pos += ln
        else:
            ln = c & 0x1f; cnt += ln
            out.extend(src[pos:pos + ln]); pos += ln
    return pos


def decompress(entry):
    out = bytearray(); pos = 0
    while True:
        size = struct.unpack_from('<H', entry, pos)[0]
        if entry[pos + 2] == 0:
            pos = _mode0(entry, pos + 2, out)
        else:
            pos = _mode1(entry, pos + 2, size, out)
        if pos >= len(entry) or entry[pos] == 0:
            break
        pos += 1
    return bytes(out)


# ---------------- packing (store-only encoding the game's decoder accepts) ----------------
def compress_store(data):
    """Encode `data` as byte-coded chunks using only literal-run tokens (0x20|hi, lo = run length).
    Each chunk <= 0xFFF0 bytes so the u16 chunk size never overflows."""
    out = bytearray(); pos = 0; n = len(data)
    first = True
    while pos < n or first:
        first = False
        chunk = bytearray()
        budget = 0xFF00
        while pos < n and len(chunk) < budget:
            run = min(0x1FFF, n - pos, budget - len(chunk))
            chunk += bytes([0x20 | (run >> 8), run & 0xff]) + data[pos:pos + run]
            pos += run
        if not chunk:
            chunk += bytes([0x20, 0x00])  # empty literal run (keeps first byte != 0 -> mode1)
        size = len(chunk) + 2
        out += struct.pack('<H', size) + chunk
        out.append(1 if pos < n else 0)  # continuation byte
    return bytes(out)


def write_archive(path, entries):
    """entries: list of raw (already compressed) entry blobs, len == original count. Offsets are recomputed."""
    n = len(entries)
    head = b'LB DAT\x1a\x00' + struct.pack('<I', n) + b'\x00' * 4
    table_end = 0x10 + 4 * (n + 1)
    last = max([i for i, e in enumerate(entries) if e] + [0])
    offs = []; pos = table_end
    for i, e in enumerate(entries):
        offs.append(pos if i <= last else 0); pos += len(e)
    offs.append(pos if last == n - 1 else 0)
    if last < n - 1: offs[last + 1] = pos  # end-of-data terminator
    with open(path, 'wb') as f:
        f.write(head); f.write(struct.pack(f'<{n + 1}I', *offs))
        for e in entries: f.write(e)
