import { Course, Player, RoundFormat, Score } from '../types';
import {
  CourseLike,
  PolicyVersion,
  Rational,
  SCORING_POLICY_VERSION,
  courseHandicapFromRaw,
  courseHandicapRaw,
  groupStrokes,
  netScore,
  playingHandicapFromRaw,
  scrambleSideStrokes,
  strokesOnHole,
} from './handicapMath';

export {
  allocateStrokes,
  netDoubleBogey,
  netScore,
  stablefordPoints,
  strokesOnHole,
  SCORING_POLICY_VERSION,
} from './handicapMath';
export type { PolicyVersion, Rational } from './handicapMath';

function courseLike(course: Course): CourseLike {
  return { par: course.par, rating: course.rating, slope: course.slope, holeCount: course.holes.length };
}

/** Unrounded Course Handicap for a player on a course (exact). */
export function courseHandicapRawFor(
  handicapIndex: number,
  course: Course,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): Rational {
  return courseHandicapRaw(handicapIndex, courseLike(course), policy);
}

/** Course Handicap as displayed (Rule 6.1: unrounded CH rounded once). */
export function courseHandicap(
  handicapIndex: number,
  course: Course,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): number {
  return courseHandicapFromRaw(courseHandicapRawFor(handicapIndex, course, policy));
}

/** Playing Handicap after the round's allowance (Rule 6.2a). */
export function playingHandicap(
  handicapIndex: number,
  course: Course,
  allowance: number,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): number {
  return playingHandicapFromRaw(courseHandicapRawFor(handicapIndex, course, policy), allowance, policy);
}

// ── Score lookup ──────────────────────────────────────────────────────────

export type ScoreMap = Map<string, Score>;

export function scoreKey(entityType: string, entityId: string, hole: number): string {
  return `${entityType}|${entityId}|${hole}`;
}

export function buildScoreMap(scores: Score[], roundId: string): ScoreMap {
  const map: ScoreMap = new Map();
  for (const s of scores) {
    if (s.roundId === roundId) map.set(scoreKey(s.entityType, s.entityId, s.hole), s);
  }
  return map;
}

/**
 * What is recorded for an entity on a hole:
 *  - a number: a completed gross score
 *  - 'pickup': an explicit no-return (the ball does not count)
 *  - null: nothing entered yet (unresolved)
 */
export type GrossValue = number | 'pickup' | null;

export function grossFor(map: ScoreMap, entityType: string, entityId: string, hole: number): GrossValue {
  const s = map.get(scoreKey(entityType, entityId, hole));
  if (!s) return null;
  if (s.pickup || s.strokes == null) return 'pickup';
  return s.strokes;
}

// ── Per-player handicap info ──────────────────────────────────────────────

export interface PlayerHandicapInfo {
  playerId: string;
  name: string;
  handicapIndex: number;
  /** Exact unrounded Course Handicap. */
  courseHandicapRaw: Rational;
  courseHandicap: number;
  playingHandicap: number;
  /** Strokes actually received in this group/match. */
  effectiveHandicap: number;
}

/**
 * Strokes for a group of players under a format — the whole field for the
 * qualifier, the players in one match for Rounds 2/3/5. The format decides
 * the rule (see handicapMath.groupStrokes); the policy version decides which
 * generation of the rules, so a frozen round keeps reproducing its results.
 */
export function handicapInfoFor(
  players: Player[],
  format: RoundFormat,
  allowance: number,
  course: Course,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): PlayerHandicapInfo[] {
  const raws = players.map((p) => courseHandicapRawFor(p.handicapIndex, course, policy));
  const strokes = groupStrokes(format, raws, allowance, policy);
  return players.map((p, i) => ({
    playerId: p.id,
    name: p.name,
    handicapIndex: p.handicapIndex,
    courseHandicapRaw: raws[i],
    courseHandicap: strokes[i].courseHandicap,
    playingHandicap: strokes[i].playingHandicap,
    effectiveHandicap: strokes[i].strokes,
  }));
}

/** Scramble: team handicap per side and the strokes each side receives. */
export function scrambleSidesFor(
  sides: Player[][],
  course: Course,
  policy: PolicyVersion = SCORING_POLICY_VERSION,
): { team: number[]; strokes: number[] } {
  return scrambleSideStrokes(
    sides.map((side) => side.map((p) => courseHandicapRawFor(p.handicapIndex, course, policy))),
    policy,
  );
}

/**
 * Net score for a player on a hole, capped at net double bogey; 'pickup' or
 * null pass straight through.
 */
export function netFor(
  map: ScoreMap,
  info: PlayerHandicapInfo,
  hole: { number: number; strokeIndex: number; par: number },
  holeCount: number,
): GrossValue {
  const gross = grossFor(map, 'player', info.playerId, hole.number);
  if (gross == null || gross === 'pickup') return gross;
  return netScore(gross, hole.par, strokesOnHole(info.effectiveHandicap, hole.strokeIndex, holeCount));
}
