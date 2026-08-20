import { Course, Player, Round, Score } from '../types';

/**
 * WHS course handicap: HI × (slope / 113) + (rating − par).
 * For 9-hole courses, half the handicap index is used.
 */
export function courseHandicap(handicapIndex: number, course: Course): number {
  const isNineHoles = course.holes.length === 9;
  const index = isNineHoles ? handicapIndex / 2 : handicapIndex;
  return Math.round(index * (course.slope / 113) + (course.rating - course.par));
}

/** Course handicap after the round's allowance (85%, 90%, etc.). */
export function playingHandicap(handicapIndex: number, course: Course, allowance: number): number {
  return Math.round(courseHandicap(handicapIndex, course) * allowance);
}

/**
 * Strokes received on a hole for a given playing handicap, allocated by
 * stroke index (1 = hardest hole gets the first stroke). Handles handicaps
 * above the number of holes (second stroke lap) and plus handicaps.
 */
export function strokesOnHole(ph: number, strokeIndex: number, holeCount: number): number {
  if (ph === 0) return 0;
  const abs = Math.abs(ph);
  const base = Math.floor(abs / holeCount);
  const rem = abs % holeCount;
  const extra = ph > 0 ? strokeIndex <= rem : strokeIndex > holeCount - rem;
  return (base + (extra ? 1 : 0)) * Math.sign(ph);
}

/** Stableford points for a net score: par 2, birdie 3, bogey 1, double+ 0. */
export function stablefordPoints(net: number, par: number): number {
  return Math.max(0, 2 + par - net);
}

/** Scramble team handicap: 35% of low course handicap + 15% of high. */
export function scrambleTeamHandicap(players: Player[], course: Course): number {
  const chs = players.map((p) => courseHandicap(p.handicapIndex, course)).sort((a, b) => a - b);
  const low = chs[0] ?? 0;
  const high = chs[chs.length - 1] ?? 0;
  return Math.round(0.35 * low + 0.15 * high);
}

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

export function grossFor(map: ScoreMap, entityType: string, entityId: string, hole: number): number | null {
  return map.get(scoreKey(entityType, entityId, hole))?.strokes ?? null;
}

export interface PlayerHandicapInfo {
  playerId: string;
  name: string;
  handicapIndex: number;
  courseHandicap: number;
  playingHandicap: number;
  /** Strokes actually allocated in this context (after play-off-low reduction). */
  effectiveHandicap: number;
}

/**
 * Per-player handicap info for a group of players in a round.
 *
 * Every format plays off the low man: each player's effective strokes are
 * reduced by the lowest playing handicap in the group passed in. The *scope*
 * of that group is what differs by round, and it is the caller's job to pass
 * the right one — the whole 12-man field for the Round 1 qualifier, and the
 * players in a single match for Rounds 2-5.
 *
 * (`round.playOffLow` is no longer consulted; see the note on the Round type.)
 */
export function handicapInfoFor(players: Player[], round: Round, course: Course): PlayerHandicapInfo[] {
  const infos = players.map((p) => {
    const ch = courseHandicap(p.handicapIndex, course);
    const ph = playingHandicap(p.handicapIndex, course, round.allowance);
    return {
      playerId: p.id,
      name: p.name,
      handicapIndex: p.handicapIndex,
      courseHandicap: ch,
      playingHandicap: ph,
      effectiveHandicap: ph,
    };
  });
  if (infos.length > 1) {
    const low = Math.min(...infos.map((i) => i.playingHandicap));
    for (const i of infos) i.effectiveHandicap = i.playingHandicap - low;
  }
  return infos;
}

/** Net score for a player on a hole, or null if no gross score entered. */
export function netFor(
  map: ScoreMap,
  info: PlayerHandicapInfo,
  hole: { number: number; strokeIndex: number },
  holeCount: number,
): number | null {
  const gross = grossFor(map, 'player', info.playerId, hole.number);
  if (gross == null) return null;
  return gross - strokesOnHole(info.effectiveHandicap, hole.strokeIndex, holeCount);
}
