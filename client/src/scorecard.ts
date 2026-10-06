// Shared scorecard logic used by both score-entry views: the hole-by-hole
// play view and the full-card grid.
import { Course, Hole, MatchReading, Round, Trip } from './api/types';
import {
  Rational,
  courseHandicapRaw,
  groupStrokes,
  scrambleSideStrokes,
  stablefordPoints,
  strokesOnHole,
} from './handicapMath';
import { MatchState, ScoreboardSide } from './matchState';

export { stablefordPoints, strokesOnHole } from './handicapMath';

export interface Column {
  entityType: 'player' | 'side';
  entityId: string;
  label: string;
  /** Strokes this player (or scramble side) receives over the round. */
  effectiveHandicap: number;
}

export interface MatchSides {
  /** Entity ids (player ids, or `${matchId}:A` for a scramble side) per side. */
  sideA: string[];
  sideB: string[];
  teamA: string;
  teamB: string;
  colorA: string;
  colorB: string;
  /** Player names per side — for scramble, where the columns are the sides. */
  namesA: string[];
  namesB: string[];
}

export interface Group {
  id: string;
  label: string;
  columns: Column[];
  /** Ryder Cup rounds: how this group's columns split into the two sides. */
  match?: MatchSides;
  /** Round 1 qualifier: the best-ball pairs inside this tee-time group. */
  pairs?: { name: string; entityIds: string[] }[];
}

/**
 * What the phone has for a column on a hole: a gross score, '' when nothing
 * is entered, or 'pickup' for an explicit no-return.
 */
export type CellValue = number | '' | 'pickup';
export type ValueFor = (col: Column, hole: number) => CellValue;

/** Strokes a column gets on one specific hole. */
export function strokesForHole(course: Course, col: Column, hole: Hole): number {
  return strokesOnHole(col.effectiveHandicap, hole.strokeIndex, course.holes.length);
}

/** Only meaningful once every hole has a yardage — a partial sum would read
 *  like a real course length and be wrong. */
export function totalYardsOf(course: Course): number | null {
  return course.holes.every((h) => typeof h.yards === 'number')
    ? course.holes.reduce((sum, h) => sum + (h.yards ?? 0), 0)
    : null;
}

export interface ColumnStats {
  /** Holes with a gross score. */
  thru: number;
  /** Holes picked up. */
  pickups: number;
  gross: number;
  net: number;
  points: number;
}

/** Running totals for one column across every hole scored so far. */
export function statsFor(course: Course, col: Column, valueFor: ValueFor): ColumnStats {
  const stats: ColumnStats = { thru: 0, pickups: 0, gross: 0, net: 0, points: 0 };
  for (const hole of course.holes) {
    const gross = valueFor(col, hole.number);
    if (gross === 'pickup') {
      stats.pickups += 1;
      continue;
    }
    if (typeof gross !== 'number') continue;
    const net = gross - strokesForHole(course, col, hole);
    stats.thru += 1;
    stats.gross += gross;
    stats.net += net;
    stats.points += stablefordPoints(net, hole.par);
  }
  return stats;
}

/** The card a round is scored on — the frozen copy once started, else the live course. */
export function scoringCourseOf(trip: Trip, round: Round): Course | undefined {
  return round.scoringCourse ?? trip.courses.find((c) => c.id === round.courseId);
}

/**
 * Build the score-entry groups for a round: tee-time groups for the qualifier,
 * one group per match for Ryder Cup rounds. `labelTeeTime` formats a tee time
 * for display (the caller owns timezone handling).
 *
 * Strokes are derived with the shared handicap module from the exact course
 * handicaps the server sends, under the round's policy version — the same
 * computation the server performs, so the stars on the card match the
 * leaderboard.
 */
export function buildGroups(
  trip: Trip,
  roundId: string,
  labelTeeTime: (t: string) => string,
): Group[] {
  const round = trip.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const course = scoringCourseOf(trip, round);
  if (!course) return [];
  const policy = round.policyVersion ?? 2;
  const nameOf = (id: string) => trip.players.find((p) => p.id === id)?.name ?? id;
  const rawOf = (id: string): Rational => {
    const entry = round.courseHandicaps.find((c) => c.playerId === id);
    if (entry?.courseHandicapRaw) return entry.courseHandicapRaw;
    // Older cached payloads carry no raw value: rebuild it from the index.
    const index = entry?.handicapIndex ?? trip.players.find((p) => p.id === id)?.handicapIndex ?? 0;
    return courseHandicapRaw(index, { par: course.par, rating: course.rating, slope: course.slope, holeCount: course.holes.length }, policy);
  };
  /** Strokes each player gets in a group under the round's format and policy. */
  const strokesOf = (playerIds: string[]): Map<string, number> => {
    const res = groupStrokes(round.format, playerIds.map(rawOf), round.allowance, policy);
    return new Map(playerIds.map((id, i) => [id, res[i].strokes]));
  };

  if (round.format === 'bestball-qualifier') {
    const pairings = trip.pairings.filter((p) => p.roundId === roundId);
    const byTime = new Map<string, typeof pairings>();
    for (const p of pairings) {
      const key = p.teeTime ?? 'Unassigned';
      byTime.set(key, [...(byTime.get(key) ?? []), p]);
    }
    // The whole field is one handicap group (full PH under policy 2).
    const fieldStrokes = strokesOf([...new Set(pairings.flatMap((p) => p.playerIds))]);
    return [...byTime.entries()].map(([teeTime, group]) => ({
      id: `tee-${teeTime}`,
      label: `${labelTeeTime(teeTime)} — ${group.map((g) => g.name).join(' & ')}`,
      columns: group.flatMap((g) =>
        g.playerIds.map((pid) => ({
          entityType: 'player' as const,
          entityId: pid,
          label: nameOf(pid),
          effectiveHandicap: fieldStrokes.get(pid) ?? 0,
        })),
      ),
      pairs: group.map((g) => ({
        name: g.name || g.playerIds.map(nameOf).join(' / '),
        entityIds: g.playerIds,
      })),
    }));
  }

  const matches = trip.matches.filter((m) => m.roundId === roundId);
  const teamOf = (side: 'A' | 'B') => trip.ryderTeams.find((t) => t.id === side);
  const teamName = (side: 'A' | 'B') => teamOf(side)?.name ?? side;
  const teamColor = (side: 'A' | 'B') => teamOf(side)?.color ?? '#94a3b8';

  return matches.map((m, i) => {
    const label = `Match ${i + 1}: ${m.sideA.map(nameOf).join('/')} vs ${m.sideB.map(nameOf).join('/')}`;
    const common = {
      teamA: teamName('A'),
      teamB: teamName('B'),
      colorA: teamColor('A'),
      colorB: teamColor('B'),
      namesA: m.sideA.map(nameOf),
      namesB: m.sideB.map(nameOf),
    };
    if (round.format === 'scramble') {
      const sides = scrambleSideStrokes([m.sideA.map(rawOf), m.sideB.map(rawOf)], policy);
      return {
        id: m.id,
        label,
        columns: [
          { entityType: 'side' as const, entityId: `${m.id}:A`, label: teamName('A'), effectiveHandicap: sides.strokes[0] },
          { entityType: 'side' as const, entityId: `${m.id}:B`, label: teamName('B'), effectiveHandicap: sides.strokes[1] },
        ],
        match: { ...common, sideA: [`${m.id}:A`], sideB: [`${m.id}:B`] },
      };
    }
    // Four-ball, Stableford and singles: strokes are worked out across the
    // whole match, under the format's rule.
    const playerIds = [...m.sideA, ...m.sideB];
    const eff = strokesOf(playerIds);
    return {
      id: m.id,
      label,
      columns: playerIds.map((pid) => ({
        entityType: 'player' as const,
        entityId: pid,
        label: nameOf(pid),
        effectiveHandicap: eff.get(pid) ?? 0,
      })),
      match: { ...common, sideA: m.sideA, sideB: m.sideB },
    };
  });
}

function fmtToPar(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

/** Net on a hole: a number, 'pickup', or null when nothing is entered. */
function netOnHole(course: Course, col: Column, hole: Hole, valueFor: ValueFor): number | 'pickup' | null {
  const gross = valueFor(col, hole.number);
  if (gross === 'pickup') return 'pickup';
  return typeof gross === 'number' ? gross - strokesForHole(course, col, hole) : null;
}

/**
 * Round 1 read-out: net best ball against par, one per pair in the group.
 * Mirrors `qualifierLeaderboard` on the server.
 */
export function qualifierStatus(course: Course, group: Group, valueFor: ValueFor): string | null {
  if (!group.pairs?.length) return null;
  const colOf = (id: string) => group.columns.find((c) => c.entityId === id);
  const parts = group.pairs
    .map((pair) => {
      const cols = pair.entityIds.map(colOf).filter((c): c is Column => Boolean(c));
      let net = 0;
      let par = 0;
      let thru = 0;
      let noReturn = false;
      for (const hole of course.holes) {
        const values = cols.map((c) => netOnHole(course, c, hole, valueFor));
        const nums = values.filter((v): v is number => typeof v === 'number');
        if (nums.length) {
          thru += 1;
          par += hole.par;
          net += Math.min(...nums);
        } else if (values.length && values.every((v) => v === 'pickup')) noReturn = true;
      }
      return { name: pair.name, toPar: net - par, thru, noReturn };
    })
    .filter((p) => p.thru > 0 || p.noReturn);
  if (!parts.length) return null;
  return parts
    .map((p) => (p.noReturn ? `${p.name} no return` : `${p.name} ${fmtToPar(p.toPar)} thru ${p.thru}`))
    .join('  ·  ');
}

type SideValues = (number | 'pickup' | null)[];

/** Outcome of one hole from the balls present: +1 A, −1 B, 0 halved, null undecidable. */
function holeOutcome(a: SideValues, b: SideValues): 1 | -1 | 0 | null {
  const numA = a.filter((v): v is number => typeof v === 'number');
  const numB = b.filter((v): v is number => typeof v === 'number');
  const presentA = a.some((v) => v != null);
  const presentB = b.some((v) => v != null);
  if (!presentA || !presentB) return null;
  if (numA.length && numB.length) {
    const bestA = Math.min(...numA);
    const bestB = Math.min(...numB);
    return bestA < bestB ? 1 : bestB < bestA ? -1 : 0;
  }
  if (numA.length && !numB.length) return 1;
  if (numB.length && !numA.length) return -1;
  return 0;
}

const emptyReading = (): MatchReading => ({ thru: 0, leader: null, margin: 0, decided: false, closeoutRemaining: 0, complete: false });

/**
 * Where a Ryder Cup match stands right now, from the scores on this phone.
 *
 * Hand-mirrored from `computeMatch` in server/src/services/leaderboard.ts, for
 * the same reason the stroke maths is shared: out on the course there may be
 * no signal, and a status fetched from the server would be stale the moment
 * someone holes a putt. The server remains the authority for actual Cup
 * points — this is the live read-out only, so if the scoring rules change on
 * the server, change this with them. A parity test compares the two.
 */
export function liveMatchState(
  course: Course,
  round: Round,
  group: Group,
  valueFor: ValueFor,
): MatchState | null {
  const n = course.holes.length;
  const m = group.match;
  if (!m) return null;
  const colOf = (id: string) => group.columns.find((c) => c.entityId === id);
  const colsA = m.sideA.map(colOf).filter((c): c is Column => Boolean(c));
  const colsB = m.sideB.map(colOf).filter((c): c is Column => Boolean(c));
  if (!colsA.length || !colsB.length) return null;
  const netOn = (col: Column, hole: Hole) => netOnHole(course, col, hole, valueFor);

  const confirmed = emptyReading();
  const provisional = emptyReading();
  const unresolvedHoles: number[] = [];

  if (round.format === 'fourball' || round.format === 'singles') {
    let diffC = 0;
    let diffP = 0;
    let confirmedOpen = true;
    for (const hole of course.holes) {
      const valsA = colsA.map((c) => netOn(c, hole));
      const valsB = colsB.map((c) => netOn(c, hole));
      const resolved = [...valsA, ...valsB].every((v) => v != null);
      const outcome = holeOutcome(valsA, valsB);
      if (outcome == null) break;
      if (!resolved) unresolvedHoles.push(hole.number);
      if (!provisional.decided) {
        diffP += outcome;
        provisional.thru += 1;
        if (Math.abs(diffP) > n - provisional.thru) {
          provisional.decided = true;
          provisional.closeoutRemaining = n - provisional.thru;
        }
      }
      if (confirmedOpen && resolved && !confirmed.decided) {
        diffC += outcome;
        confirmed.thru += 1;
        if (Math.abs(diffC) > n - confirmed.thru) {
          confirmed.decided = true;
          confirmed.closeoutRemaining = n - confirmed.thru;
        }
      } else if (!resolved) {
        confirmedOpen = false;
      }
      if (provisional.decided && (confirmed.decided || !confirmedOpen)) break;
    }
    confirmed.margin = Math.abs(diffC);
    confirmed.leader = diffC > 0 ? 'A' : diffC < 0 ? 'B' : null;
    confirmed.complete = confirmed.decided || confirmed.thru === n;
    provisional.margin = Math.abs(diffP);
    provisional.leader = diffP > 0 ? 'A' : diffP < 0 ? 'B' : null;
    provisional.complete = provisional.decided || provisional.thru === n;
  } else if (round.format === 'stableford') {
    let cA = 0, cB = 0, pA = 0, pB = 0, resolvedHoles = 0, anyHole = 0;
    for (const hole of course.holes) {
      const valsA = colsA.map((c) => netOn(c, hole));
      const valsB = colsB.map((c) => netOn(c, hole));
      const all = [...valsA, ...valsB];
      if (all.every((v) => v == null)) continue;
      anyHole += 1;
      const pts = (vals: SideValues) =>
        vals.reduce<number>((s, v) => s + (typeof v === 'number' ? stablefordPoints(v, hole.par) : 0), 0);
      pA += pts(valsA);
      pB += pts(valsB);
      if (all.every((v) => v != null)) {
        resolvedHoles += 1;
        cA += pts(valsA);
        cB += pts(valsB);
      } else unresolvedHoles.push(hole.number);
    }
    confirmed.thru = resolvedHoles;
    confirmed.totals = { A: cA, B: cB, unit: 'pts' };
    confirmed.margin = Math.abs(cA - cB);
    confirmed.leader = cA > cB ? 'A' : cB > cA ? 'B' : null;
    confirmed.complete = resolvedHoles === n;
    confirmed.decided = confirmed.complete;
    provisional.thru = anyHole;
    provisional.totals = { A: pA, B: pB, unit: 'pts' };
    provisional.margin = Math.abs(pA - pB);
    provisional.leader = pA > pB ? 'A' : pB > pA ? 'B' : null;
    provisional.complete = resolvedHoles === n;
  } else if (round.format === 'scramble') {
    let netA = 0, netB = 0;
    for (const hole of course.holes) {
      const a = netOn(colsA[0], hole);
      const b = netOn(colsB[0], hole);
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      confirmed.thru += 1;
      netA += a;
      netB += b;
    }
    confirmed.totals = { A: netA, B: netB, unit: 'net' };
    confirmed.margin = Math.abs(netA - netB);
    confirmed.leader = netA < netB ? 'A' : netB < netA ? 'B' : null;
    confirmed.complete = confirmed.thru === n;
    confirmed.decided = confirmed.complete;
    Object.assign(provisional, confirmed);
  } else {
    return null;
  }

  const final = confirmed.complete && confirmed.thru > 0;
  return {
    format: round.format,
    holeCount: n,
    thru: confirmed.thru,
    leader: confirmed.leader,
    margin: confirmed.margin,
    final,
    closeoutRemaining: confirmed.closeoutRemaining,
    totals: final ? confirmed.totals : provisional.totals ?? confirmed.totals,
    provisional,
    unresolvedHoles,
  };
}

/** The two sides of a match group, shaped for the scoreboard. */
export function scoreboardSides(group: Group): { A: ScoreboardSide; B: ScoreboardSide } | null {
  const m = group.match;
  if (!m) return null;
  const isScramble = m.sideA.length === 1 && m.sideA[0].endsWith(':A');
  const side = (ids: string[], names: string[], name: string, color: string): ScoreboardSide => {
    if (isScramble) {
      const col = group.columns.find((c) => c.entityId === ids[0]);
      return {
        name,
        color,
        players: names.map((label) => ({ label, strokes: 0 })),
        strokes: col?.effectiveHandicap ?? 0,
      };
    }
    return {
      name,
      color,
      players: ids.map((id) => {
        const col = group.columns.find((c) => c.entityId === id);
        return { label: col?.label ?? id, strokes: col?.effectiveHandicap ?? 0 };
      }),
    };
  };
  return {
    A: side(m.sideA, m.namesA, m.teamA, m.colorA),
    B: side(m.sideB, m.namesB, m.teamB, m.colorB),
  };
}
