import type { VM2Data } from './vm2data';

export type SfxRole = 'summon' | 'attack' | 'kill' | 'turn' | 'select';
export const SFX_ROLES: [SfxRole, string][] = [['select', '유닛 선택'], ['summon', '소환'], ['attack', '공격'], ['kill', '격파'], ['turn', '턴 종료']];
/** vmv2.exe system SE table (0x47446c) maps UI sounds to DATA13 entries 137..153; 0..136 are unit attack sounds */
export const DEFAULT_SFX: Record<SfxRole, number> = { select: 138, summon: 149, attack: 0, kill: 152, turn: 141 };

/** plays DATA13 wave entries through <audio> (blob URLs, created lazily) */
export class Sfx {
  urls = new Map<number, string>(); enabled = true; volume = 0.6;
  constructor(public data: () => VM2Data | null, public roles: () => Record<SfxRole, number>) {}
  url(i: number): string | null {
    let u = this.urls.get(i); if (u) return u;
    const d = this.data(); const w = d?.sfx(i); if (!w) return null;
    u = URL.createObjectURL(new Blob([w as BlobPart], { type: 'audio/wav' })); this.urls.set(i, u); return u;
  }
  play(i: number) {
    if (!this.enabled) return; const u = this.url(i); if (!u) return;
    const a = new Audio(u); a.volume = this.volume; a.play().catch(() => { /* autoplay blocked until first gesture */ });
  }
  role(r: SfxRole) { const i = this.roles()[r]; if (i >= 0) this.play(i); }
  reset() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
}
