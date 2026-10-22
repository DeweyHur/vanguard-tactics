import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readArchive, decompress, compressStore, writeArchive } from '../src/lbdat';
const S = '/tmp/claude-0/-home-claude/503f5e27-697f-52aa-99a9-65c2d71bb6cc/scratchpad';
const have = existsSync(`${S}/vantage/DATA10.DAT`);
describe.skipIf(!have)('lbdat (against python reference output)', () => {
  it('decompresses every DATA10 entry identically', () => {
    const ents = readArchive(new Uint8Array(readFileSync(`${S}/vantage/DATA10.DAT`)));
    let checked = 0;
    ents.forEach((e, i) => {
      if (!e.length) return;
      const ref = `${S}/vmout/DATA10/${String(i).padStart(3, '0')}.bin`;
      if (!existsSync(ref)) return;
      const d = decompress(e); const r = new Uint8Array(readFileSync(ref));
      expect(d.length).toBe(r.length); expect(Buffer.compare(Buffer.from(d), Buffer.from(r))).toBe(0); checked++;
    });
    expect(checked).toBeGreaterThan(200);
  });
  it('round-trips an archive byte-identically and store-packs correctly', () => {
    const raw = new Uint8Array(readFileSync(`${S}/vantage/DATA08.DAT`));
    const ents = readArchive(raw);
    expect(Buffer.compare(Buffer.from(writeArchive(ents)), Buffer.from(raw))).toBe(0);
    const d = decompress(ents[12]); const re = decompress(compressStore(d));
    expect(Buffer.compare(Buffer.from(re), Buffer.from(d))).toBe(0);
  });
});
