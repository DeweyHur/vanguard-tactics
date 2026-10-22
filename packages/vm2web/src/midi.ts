/**
 * Minimal Standard MIDI File player on WebAudio with a tiny chip-style synth (no soundfont).
 * Oscillator waveform follows the GM program family; channel 10 is noise percussion.
 */
interface Ev { t: number; ch: number; type: 'on' | 'off' | 'prog' | 'tempo' | 'ctl'; a: number; b: number }

export function parseMidi(buf: Uint8Array): { events: Ev[]; division: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
  const ntr = dv.getUint16(10), division = dv.getUint16(12); let pos = 8 + dv.getUint32(4);
  const events: Ev[] = [];
  for (let tr = 0; tr < ntr; tr++) {
    if (String.fromCharCode(...buf.subarray(pos, pos + 4)) !== 'MTrk') break;
    const len = dv.getUint32(pos + 4); let p = pos + 8; const end = p + len; let t = 0, status = 0;
    const vlq = () => { let v = 0; for (;;) { const b = buf[p++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } };
    while (p < end) {
      t += vlq(); let b = buf[p];
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) { const meta = buf[p++]; const l = vlq(); if (meta === 0x51) events.push({ t, ch: 0, type: 'tempo', a: (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2], b: 0 }); p += l; }
      else if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; }
      else if (type === 0x90) { const n = buf[p++], v = buf[p++]; events.push({ t, ch, type: v ? 'on' : 'off', a: n, b: v }); }
      else if (type === 0x80) { const n = buf[p++]; p++; events.push({ t, ch, type: 'off', a: n, b: 0 }); }
      else if (type === 0xc0) { events.push({ t, ch, type: 'prog', a: buf[p++], b: 0 }); }
      else if (type === 0xb0) { const c = buf[p++], v = buf[p++]; events.push({ t, ch, type: 'ctl', a: c, b: v }); }
      else if (type === 0xa0 || type === 0xe0) p += 2; else if (type === 0xd0) p += 1; else p++;
    }
    pos = end;
  }
  events.sort((x, y) => x.t - y.t); return { events, division };
}

const waveFor = (prog: number): OscillatorType => (prog < 8 ? 'triangle' : prog < 16 ? 'square' : prog < 24 ? 'sawtooth' : prog < 32 ? 'sawtooth' : prog < 40 ? 'triangle' : prog < 56 ? 'sawtooth' : prog < 72 ? 'square' : prog < 80 ? 'sine' : prog < 96 ? 'square' : 'triangle');

export class MidiPlayer {
  ctx: AudioContext | null = null; master: GainNode | null = null; timer = 0; playing = false; volume = 0.35; loop = true;
  private stops: (() => void)[] = [];
  play(buf: Uint8Array) {
    this.stop(); const { events, division } = parseMidi(buf);
    const ctx = this.ctx ?? (this.ctx = new AudioContext()); if (ctx.state === 'suspended') ctx.resume();
    const master = ctx.createGain(); master.gain.value = this.volume; master.connect(ctx.destination); this.master = master;
    // ticks -> seconds with tempo map
    let usPerBeat = 500000, lastT = 0, lastS = 0; const sec: number[] = [];
    for (const e of events) { const s = lastS + ((e.t - lastT) / division) * (usPerBeat / 1e6); sec.push(s); if (e.type === 'tempo') usPerBeat = e.a; lastT = e.t; lastS = s; }
    const total = (sec[sec.length - 1] ?? 0) + 1;
    const prog = new Array(16).fill(0), vol = new Array(16).fill(1), noteStart: Record<string, number> = {};
    const t0 = ctx.currentTime + 0.1; let noteCount = 0;
    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const schedule = (i: number, e: Ev, at: number) => {
      if (e.type === 'prog') prog[e.ch] = e.a; else if (e.type === 'ctl' && e.a === 7) vol[e.ch] = e.b / 127;
      else if (e.type === 'on') { noteStart[`${e.ch}:${e.a}`] = at; }
      else if (e.type === 'off') {
        const st = noteStart[`${e.ch}:${e.a}`]; if (st === undefined) return; delete noteStart[`${e.ch}:${e.a}`];
        const dur = Math.max(0.03, Math.min(at - st, 6)); if (noteCount++ > 6000) return;
        const g = ctx.createGain(); const v = (e.b || 80) / 127; const amp = (e.ch === 9 ? 0.5 : 0.18) * v * vol[e.ch];
        g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(amp, st + 0.01); g.gain.setTargetAtTime(amp * 0.6, st + 0.05, 0.1); g.gain.setTargetAtTime(0, st + dur, 0.03);
        g.connect(master);
        if (e.ch === 9) { const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(); f.type = e.a < 40 ? 'lowpass' : 'highpass'; f.frequency.value = e.a < 40 ? 200 : 4000; s.connect(f); f.connect(g); s.start(st); s.stop(st + Math.min(dur, 0.25) + 0.1); this.stops.push(() => { try { s.stop(); } catch { /* done */ } }); }
        else { const o = ctx.createOscillator(); o.type = waveFor(prog[e.ch]); o.frequency.value = 440 * Math.pow(2, (e.a - 69) / 12); o.connect(g); o.start(st); o.stop(st + dur + 0.3); this.stops.push(() => { try { o.stop(); } catch { /* done */ } }); }
      }
    };
    // schedule in windows to keep the graph small
    let idx = 0; this.playing = true;
    const pump = () => {
      if (!this.playing) return; const horizon = ctx.currentTime - t0 + 4;
      while (idx < events.length && sec[idx] <= horizon) { schedule(idx, events[idx], t0 + sec[idx]); idx++; }
      if (idx >= events.length) { if (this.loop) { this.timer = window.setTimeout(() => { if (this.playing) this.play(buf); }, Math.max(0, (t0 + total - ctx.currentTime) * 1000)); return; } this.playing = false; return; }
      this.timer = window.setTimeout(pump, 1000);
    };
    pump();
  }
  stop() { this.playing = false; clearTimeout(this.timer); for (const s of this.stops) s(); this.stops = []; if (this.master) { this.master.disconnect(); this.master = null; } }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
}
