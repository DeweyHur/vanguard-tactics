/**
 * Which sprite frames show which direction. Directions are named by clock hours (9 = west, 12 = north, 3 = east …).
 * The sheets' order is not documented anywhere, so the defaults are a visual guess and both tables are editable in the
 * sprites tab (saved with the other edits).
 */
export const CLOCKS = [9, 11, 12, 1, 3, 5, 6, 7];
export const CLOCK_NAME: Record<number, string> = { 9: '9시 ←', 11: '11시 ↖', 12: '12시 ↑', 1: '1시 ↗', 3: '3시 →', 5: '5시 ↘', 6: '6시 ↓', 7: '7시 ↙' };
/** engine facing (0 W, 1 NW, 2 NE, 3 E, 4 SE, 5 SW) -> clock */
export const HEX_CLOCK = [9, 11, 1, 3, 5, 7];
/** DATA01: clock of each of the 16 walking frames */
export const DEFAULT_WALK_CLOCK = [9, 9, 9, 11, 12, 12, 12, 1, 1, 3, 3, 3, 5, 5, 6, 6];
/** DATA02: clock of each of the 6 three-frame pose groups (frames 0-2, 3-5, …) */
export const DEFAULT_POSE_CLOCK = [9, 11, 1, 3, 5, 7];

const hourDist = (a: number, b: number) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };

export class Facing {
  walkClock: number[] = [...DEFAULT_WALK_CLOCK];
  poseClock: number[] = [...DEFAULT_POSE_CLOCK];
  load(e: { walkClock?: number[]; poseClock?: number[] }) {
    this.walkClock = [...DEFAULT_WALK_CLOCK]; this.poseClock = [...DEFAULT_POSE_CLOCK];
    if (e.walkClock?.length === 16) this.walkClock = [...e.walkClock];
    if (e.poseClock?.length === 6) this.poseClock = [...e.poseClock];
  }
  /** walking frames (DATA01 indices) for a clock direction; falls back to the nearest direction that has frames */
  walkFrames(clock: number): number[] {
    const have = new Set(this.walkClock);
    let best = clock, bd = 99;
    for (const c of have) { const d = hourDist(c, clock); if (d < bd) { bd = d; best = c; } }
    const out: number[] = []; this.walkClock.forEach((c, i) => { if (c === best) out.push(i); });
    return out.length ? out : [0];
  }
  /** DATA02 pose group (0..5) for a clock direction, nearest if that exact direction has none */
  poseGroup(clock: number): number {
    let best = 0, bd = 99;
    this.poseClock.forEach((c, i) => { const d = hourDist(c, clock); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  /** by engine facing */
  walkFramesFor(dir: number) { return this.walkFrames(HEX_CLOCK[dir] ?? 9); }
  poseGroupFor(dir: number) { return this.poseGroup(HEX_CLOCK[dir] ?? 9); }
}
