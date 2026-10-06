/**
 * Handicap arithmetic, exact.
 *
 * Every quantity here is kept as an integer or a rational (n/d with integer
 * parts) until the single final rounding, so that a value which is exactly
 * x.5 rounds the way the Rules of Handicapping say (upwards) instead of the
 * way IEEE floating point happens to land. The old code computed
 * `11.3 × 132/113 + (72.3 − 72)` in doubles and got 13.499999999999998.
 *
 * Inputs are validated for the precision the Rules allow — indexes and
 * ratings to one decimal, allowances to one percent — and anything else is
 * rejected rather than silently truncated.
 *
 * SHARED FILE. An identical copy lives at client/src/handicapMath.ts; the
 * phone uses it to show strokes with no signal. A test asserts the two files
 * are byte-for-byte identical, so edit both or the build's tests fail.
 *
 * Sources (USGA Rules of Handicapping, 2024):
 *  - Rule 6.1a / 6.1b  Course Handicap for 18 / 9 holes (9 holes: halve the
 *    Handicap Index and round to the nearest tenth first).
 *  - Rule 6.2a         Playing Handicap = unrounded Course Handicap × allowance,
 *                      rounded once, .5 upwards.
 *  - Appendix C        Allowances; in match play the lowest player plays off
 *                      zero; four-ball match play applies 90% to the difference
 *                      in unrounded Course Handicap (clarification C/2 Ex. 3);
 *                      plus handicaps "move up towards zero including rounding".
 */

/** Which rule set a round is scored under. Frozen into each round's snapshot. */
export type PolicyVersion = 1 | 2;

/** The policy new rounds are scored under. */
export const SCORING_POLICY_VERSION: PolicyVersion = 2;

export type HandicapFormat =
  | 'bestball-qualifier'
  | 'fourball'
  | 'stableford'
  | 'scramble'
  | 'singles';

/** An exact rational number n/d with d > 0. */
export interface Rational {
  n: number;
  d: number;
}

export class HandicapInputError extends Error {}

/** A number that must be a whole number of tenths (index, rating). */
export function toTenths(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new HandicapInputError(`${what} must be a number`);
  const t = Math.round(value * 10);
  if (Math.abs(value * 10 - t) > 1e-6) {
    throw new HandicapInputError(`${what} must have at most one decimal place (got ${value})`);
  }
  return t;
}

/** An allowance such as 0.85, as a whole percentage (85). */
export function toPercent(allowance: number, what = 'allowance'): number {
  if (!Number.isFinite(allowance)) throw new HandicapInputError(`${what} must be a number`);
  const p = Math.round(allowance * 100);
  if (Math.abs(allowance * 100 - p) > 1e-6) {
    throw new HandicapInputError(`${what} must be a whole percentage (got ${allowance})`);
  }
  if (p < 0 || p > 100) throw new HandicapInputError(`${what} must be between 0 and 1`);
  return p;
}

/**
 * Round a rational to the nearest whole number with .5 rounded upwards
 * (towards +∞). For plus handicaps (negative values) this is "up towards
 * zero", which is what Appendix C prescribes.
 */
export function roundHalfUp(r: Rational): number {
  if (!Number.isInteger(r.n) || !Number.isInteger(r.d) || r.d <= 0) {
    throw new HandicapInputError(`bad rational ${r.n}/${r.d}`);
  }
  // floor((2n + d) / 2d) computed on integers; the division is exact at every
  // whole-number boundary because both operands are integers.
  const num = 2 * r.n + r.d;
  const den = 2 * r.d;
  return Math.floor(num / den);
}

/** Decimal rendering of a rational for display/logging (no rounding surprises). */
export function rationalToFixed(r: Rational, decimals = 4): string {
  const sign = r.n < 0 ? '-' : '';
  const a = Math.abs(r.n);
  const whole = Math.floor(a / r.d);
  const rem = a - whole * r.d;
  const scale = 10 ** decimals;
  const dec = Math.floor((rem * scale) / r.d);
  return `${sign}${whole}.${String(dec).padStart(decimals, '0')}`;
}

export function rationalToNumber(r: Rational): number {
  return r.n / r.d;
}

export interface CourseLike {
  par: number;
  rating: number;
  slope: number;
  holeCount: number;
}

/**
 * Unrounded Course Handicap as an exact rational.
 *
 *   18 holes:  CH = index × slope/113 + (rating − par)
 *              = (indexTenths × slope + 113 × (ratingTenths − 10 × par)) / 1130
 *   9 holes:   same, with the index first halved and rounded to a tenth
 *              (Rule 6.1b) and the 9-hole rating, slope and par.
 *
 * Policy 1 (the app before this change) halved the index exactly, without
 * the rounding to a tenth; that variant is kept so frozen rounds reproduce.
 */
export function courseHandicapRaw(
  index: number,
  course: CourseLike,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): Rational {
  const idxT = toTenths(index, 'handicap index');
  const ratT = toTenths(course.rating, 'course rating');
  if (!Number.isInteger(course.slope) || course.slope < 55 || course.slope > 155) {
    throw new HandicapInputError(`slope must be a whole number 55–155 (got ${course.slope})`);
  }
  if (!Number.isInteger(course.par)) throw new HandicapInputError(`par must be a whole number`);
  const ratingMinusPar = ratT - 10 * course.par; // in tenths
  if (course.holeCount === 9) {
    if (policy === 1) {
      // exact half: index/2 → tenths/20
      return { n: idxT * course.slope + 226 * ratingMinusPar, d: 2260 };
    }
    const halfT = roundHalfUp({ n: idxT, d: 2 }); // half index rounded to a tenth
    return { n: halfT * course.slope + 113 * ratingMinusPar, d: 1130 };
  }
  return { n: idxT * course.slope + 113 * ratingMinusPar, d: 1130 };
}

/** The Course Handicap as displayed: unrounded CH rounded once (Rule 6.1). */
export function courseHandicapFromRaw(raw: Rational): number {
  return roundHalfUp(raw);
}

/**
 * Playing Handicap.
 *  Policy 2: round(unrounded CH × allowance)                  (Rule 6.2a)
 *  Policy 1: round(round(CH) × allowance)   — the previous double rounding.
 */
export function playingHandicapFromRaw(
  raw: Rational,
  allowance: number,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): number {
  const pct = toPercent(allowance);
  if (policy === 1) return roundHalfUp({ n: roundHalfUp(raw) * pct, d: 100 });
  return roundHalfUp({ n: raw.n * pct, d: raw.d * 100 });
}

function assertSameDenominator(raws: Rational[]): number {
  const d = raws[0]?.d ?? 1130;
  for (const r of raws) {
    if (r.d !== d) throw new HandicapInputError('all players in a group must be on the same course');
  }
  return d;
}

/**
 * Four-ball match play (Appendix C, clarification C/2 Example 3): the lowest
 * unrounded Course Handicap plays off zero and the others receive the
 * allowance (90%) of the *difference* in unrounded Course Handicap, rounded
 * once at the end.
 */
export function differenceFirstStrokes(raws: Rational[], allowance: number): number[] {
  if (!raws.length) return [];
  const pct = toPercent(allowance);
  const d = assertSameDenominator(raws);
  const minN = Math.min(...raws.map((r) => r.n));
  return raws.map((r) => roundHalfUp({ n: (r.n - minN) * pct, d: d * 100 }));
}

/**
 * Two-player scramble team handicap (Appendix C: 35% of the lower + 15% of the
 * higher Course Handicap), computed from the unrounded Course Handicaps and
 * rounded once. Policy 1 weighted the already-rounded Course Handicaps.
 */
export function scrambleTeamHandicapFromRaw(
  raws: Rational[],
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): number {
  if (!raws.length) return 0;
  const sorted = [...raws].sort((a, b) => rationalToNumber(a) - rationalToNumber(b));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (policy === 1) {
    return roundHalfUp({ n: 35 * roundHalfUp(low) + 15 * roundHalfUp(high), d: 100 });
  }
  const d = assertSameDenominator([low, high]);
  return roundHalfUp({ n: 35 * low.n + 15 * high.n, d: d * 100 });
}

export interface StrokeResult {
  /** Rounded Course Handicap, for display. */
  courseHandicap: number;
  /** Rounded Playing Handicap after the round's allowance, for display. */
  playingHandicap: number;
  /** Strokes the player actually receives in this group/match. */
  strokes: number;
}

/**
 * Strokes received by each player in a group for a given format.
 *
 * Policy 2:
 *  - bestball-qualifier, stableford (stroke-play forms): full Playing Handicap.
 *  - fourball: 90% of the difference in unrounded CH from the lowest in the match.
 *  - singles: Playing Handicap (100%), lowest plays off zero, others the difference.
 *  - scramble: not per player — see scrambleSideStrokes.
 * Policy 1 (previous app behaviour): double-rounded PH minus the lowest PH in
 * the group, for every format.
 */
export function groupStrokes(
  format: HandicapFormat,
  raws: Rational[],
  allowance: number,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): StrokeResult[] {
  const chs = raws.map(courseHandicapFromRaw);
  const phs = raws.map((r) => playingHandicapFromRaw(r, allowance, policy));
  if (policy === 1) {
    const low = phs.length > 1 ? Math.min(...phs) : 0;
    return raws.map((_, i) => ({ courseHandicap: chs[i], playingHandicap: phs[i], strokes: phs[i] - low }));
  }
  switch (format) {
    case 'fourball': {
      const strokes = differenceFirstStrokes(raws, allowance);
      return raws.map((_, i) => ({ courseHandicap: chs[i], playingHandicap: phs[i], strokes: strokes[i] }));
    }
    case 'singles': {
      const low = phs.length > 1 ? Math.min(...phs) : 0;
      return raws.map((_, i) => ({ courseHandicap: chs[i], playingHandicap: phs[i], strokes: phs[i] - low }));
    }
    case 'bestball-qualifier':
    case 'stableford':
      return raws.map((_, i) => ({ courseHandicap: chs[i], playingHandicap: phs[i], strokes: phs[i] }));
    case 'scramble':
      // Players carry no individual strokes in a scramble; sides do.
      return raws.map((_, i) => ({ courseHandicap: chs[i], playingHandicap: phs[i], strokes: 0 }));
  }
}

/**
 * Scramble sides: each side's team handicap, and the strokes each side gets
 * relative to the lower side. Over a complete round the subtraction is
 * neutral (both sides lose the same constant), so the completed result is the
 * same as playing full team handicaps; it only changes the mid-round read-out.
 */
export function scrambleSideStrokes(
  sides: Rational[][],
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): { team: number[]; strokes: number[] } {
  const team = sides.map((s) => scrambleTeamHandicapFromRaw(s, policy));
  const low = team.length ? Math.min(...team) : 0;
  return { team, strokes: team.map((t) => t - low) };
}

/**
 * Strokes received on a hole for a given number of strokes, allocated by
 * stroke index (1 = hardest hole gets the first stroke). Handles more strokes
 * than holes (second lap from SI 1) and plus handicaps (strokes given back
 * starting at the highest stroke index, per Appendix C).
 */
export function strokesOnHole(strokes: number, strokeIndex: number, holeCount: number): number {
  if (strokes === 0) return 0;
  const abs = Math.abs(strokes);
  const base = Math.floor(abs / holeCount);
  const rem = abs % holeCount;
  const extra = strokes > 0 ? strokeIndex <= rem : strokeIndex > holeCount - rem;
  const total = base + (extra ? 1 : 0);
  if (total === 0) return 0; // never −0
  return total * Math.sign(strokes);
}

/** Per-hole allocation for a whole card, in hole order. */
export function allocateStrokes(strokes: number, strokeIndexes: number[]): number[] {
  const n = strokeIndexes.length;
  return strokeIndexes.map((si) => strokesOnHole(strokes, si, n));
}

/** Stableford points for a net score: par 2, birdie 3, bogey 1, double+ 0. */
export function stablefordPoints(net: number, par: number): number {
  return Math.max(0, 2 + par - net);
}

/**
 * Maximum hole score, applied to every format: net double bogey — par + 2 +
 * the strokes received on the hole (the event's rule; it is also the WHS
 * adjustment for handicap posting). A gross score above it counts as this.
 */
export function netDoubleBogey(par: number, strokesOnThisHole: number): number {
  return par + 2 + strokesOnThisHole;
}

/** Net score on a hole after the maximum-score cap: never worse than net double bogey. */
export function netScore(gross: number, par: number, strokesOnThisHole: number): number {
  return Math.min(gross, netDoubleBogey(par, strokesOnThisHole)) - strokesOnThisHole;
}
