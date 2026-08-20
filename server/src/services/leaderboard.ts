import { DB, Match, MatchResult, Round } from '../types';
import {
  buildScoreMap,
  grossFor,
  handicapInfoFor,
  netFor,
  PlayerHandicapInfo,
  ScoreMap,
  scrambleTeamHandicap,
  stablefordPoints,
  strokesOnHole,
} from './scoring';

// ── Round 1 qualifier (two-man best ball, net stroke play) ────────────────

export interface QualifierRow {
  pairingId: string;
  name: string;
  teeTime: string | null;
  players: PlayerHandicapInfo[];
  thru: number;
  net: number;
  toPar: number;
  position: number;
}

export function qualifierLeaderboard(db: DB, round: Round): QualifierRow[] {
  const course = db.courses.find((c) => c.id === round.courseId)!;
  const map = buildScoreMap(db.scores, round.id);
  const n = course.holes.length;

  const pairings = db.pairings.filter((p) => p.roundId === round.id);

  // Strokes come off the low man across the WHOLE field, not each pair: every
  // player in the qualifier is reduced by the lowest playing handicap among all
  // twelve, so the low man plays off scratch and everyone else gets the
  // difference. Computed once here and shared by every pairing below.
  const fieldPlayers = [...new Set(pairings.flatMap((p) => p.playerIds))]
    .map((id) => db.users.find((u) => u.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const fieldInfos = handicapInfoFor(fieldPlayers, round, course);
  const infoFor = new Map(fieldInfos.map((i) => [i.playerId, i]));

  const rows = pairings
    .map((pairing) => {
      const players = pairing.playerIds
        .map((id) => db.users.find((u) => u.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      const infos = players
        .map((p) => infoFor.get(p.id))
        .filter((i): i is NonNullable<typeof i> => Boolean(i));
      let net = 0;
      let par = 0;
      let thru = 0;
      for (const hole of course.holes) {
        const nets = infos
          .map((info) => netFor(map, info, hole, n))
          .filter((v): v is number => v != null);
        if (!nets.length) continue;
        thru += 1;
        par += hole.par;
        net += Math.min(...nets);
      }
      return {
        pairingId: pairing.id,
        name: pairing.name || players.map((p) => p.name).join(' / '),
        teeTime: pairing.teeTime,
        players: infos,
        thru,
        net,
        toPar: net - par,
        position: 0,
      };
    });

  rows.sort((a, b) => {
    if (a.thru === 0 && b.thru === 0) return 0;
    if (a.thru === 0) return 1;
    if (b.thru === 0) return -1;
    return a.toPar - b.toPar || b.thru - a.thru;
  });
  rows.forEach((r, i) => (r.position = i + 1));
  return rows;
}

// ── Ryder Cup matches ──────────────────────────────────────────────────────

export interface ComputedMatch {
  id: string;
  roundId: string;
  format: Round['format'];
  teeTime: string | null;
  sideA: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  sideB: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  thru: number;
  /** Which side leads right now (null = all square / no scores). */
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  final: boolean;
  overridden: boolean;
  statusText: string;
  points: { A: number; B: number };
  /** Points if every unfinished match ended right now. */
  provisionalPoints: { A: number; B: number };
  detail?: { totalA: number; totalB: number; unit: string };
}

function resultToPoints(result: Exclude<MatchResult, null>): { A: number; B: number } {
  if (result === 'A') return { A: 1, B: 0 };
  if (result === 'B') return { A: 0, B: 1 };
  return { A: 0.5, B: 0.5 };
}

export function computeMatch(db: DB, round: Round, match: Match): ComputedMatch {
  const course = db.courses.find((c) => c.id === round.courseId)!;
  const map = buildScoreMap(db.scores, round.id);
  const n = course.holes.length;

  const playersOf = (ids: string[]) =>
    ids.map((id) => db.users.find((u) => u.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const playersA = playersOf(match.sideA);
  const playersB = playersOf(match.sideB);

  const teamA = db.ryderTeams.find((t) => t.id === 'A')!;
  const teamB = db.ryderTeams.find((t) => t.id === 'B')!;

  // Handicaps: for play-off-low formats the reduction is computed across the
  // whole match (all players in it), not per side.
  const allInfos = handicapInfoFor([...playersA, ...playersB], round, course);
  const infosA = allInfos.slice(0, playersA.length);
  const infosB = allInfos.slice(playersA.length);

  let thru = 0;
  let leader: 'A' | 'B' | null = null;
  let margin = 0;
  let decided = false;
  let final = false;
  let statusText = 'Not started';
  let detail: ComputedMatch['detail'];

  if (round.format === 'fourball' || round.format === 'singles') {
    // Hole-by-hole match play on best net ball. Holes are processed in order
    // and we stop at the first hole either side hasn't scored.
    let diff = 0; // positive = A up
    let closeoutRemaining = 0;
    for (const hole of course.holes) {
      const netsA = infosA.map((i) => netFor(map, i, hole, n)).filter((v): v is number => v != null);
      const netsB = infosB.map((i) => netFor(map, i, hole, n)).filter((v): v is number => v != null);
      if (!netsA.length || !netsB.length) break;
      const bestA = Math.min(...netsA);
      const bestB = Math.min(...netsB);
      if (bestA < bestB) diff += 1;
      else if (bestB < bestA) diff -= 1;
      thru += 1;
      const remaining = n - thru;
      if (Math.abs(diff) > remaining) {
        decided = true;
        closeoutRemaining = remaining;
        break;
      }
    }
    margin = Math.abs(diff);
    leader = diff > 0 ? 'A' : diff < 0 ? 'B' : null;
    final = decided || thru === n;
    if (thru === 0) statusText = 'Not started';
    else if (final) {
      if (!leader) statusText = 'Halved';
      else {
        const winnerName = leader === 'A' ? teamA.name : teamB.name;
        statusText =
          closeoutRemaining > 0 ? `${winnerName} wins ${margin}&${closeoutRemaining}` : `${winnerName} wins ${margin} UP`;
      }
    } else if (!leader) statusText = `All square thru ${thru}`;
    else statusText = `${leader === 'A' ? teamA.name : teamB.name} ${margin} UP thru ${thru}`;
  } else if (round.format === 'stableford') {
    // Two-man aggregate Stableford: a hole counts once all four players have scored it.
    let ptsA = 0;
    let ptsB = 0;
    for (const hole of course.holes) {
      const netsA = infosA.map((i) => netFor(map, i, hole, n));
      const netsB = infosB.map((i) => netFor(map, i, hole, n));
      if ([...netsA, ...netsB].some((v) => v == null)) continue;
      thru += 1;
      ptsA += (netsA as number[]).reduce((sum, v) => sum + stablefordPoints(v, hole.par), 0);
      ptsB += (netsB as number[]).reduce((sum, v) => sum + stablefordPoints(v, hole.par), 0);
    }
    margin = Math.abs(ptsA - ptsB);
    leader = ptsA > ptsB ? 'A' : ptsB > ptsA ? 'B' : null;
    final = thru === n;
    decided = final;
    detail = { totalA: ptsA, totalB: ptsB, unit: 'pts' };
    if (thru === 0) statusText = 'Not started';
    else if (final)
      statusText = leader
        ? `${leader === 'A' ? teamA.name : teamB.name} wins ${ptsA}–${ptsB}`
        : `Halved ${ptsA}–${ptsB}`;
    else statusText = `${ptsA}–${ptsB} thru ${thru}`;
  } else if (round.format === 'scramble') {
    // Head-to-head net scramble. One gross score per side per hole; the
    // higher-handicap side gets the difference in team handicaps, allocated by SI.
    const phA = scrambleTeamHandicap(playersA, course);
    const phB = scrambleTeamHandicap(playersB, course);
    const low = Math.min(phA, phB);
    const effA = phA - low;
    const effB = phB - low;
    let netA = 0;
    let netB = 0;
    for (const hole of course.holes) {
      const grossA = grossFor(map, 'side', `${match.id}:A`, hole.number);
      const grossB = grossFor(map, 'side', `${match.id}:B`, hole.number);
      if (grossA == null || grossB == null) continue;
      thru += 1;
      netA += grossA - strokesOnHole(effA, hole.strokeIndex, n);
      netB += grossB - strokesOnHole(effB, hole.strokeIndex, n);
    }
    margin = Math.abs(netA - netB);
    leader = netA < netB ? 'A' : netB < netA ? 'B' : null;
    final = thru === n;
    decided = final;
    detail = { totalA: netA, totalB: netB, unit: 'net' };
    if (thru === 0) statusText = 'Not started';
    else if (final)
      statusText = leader
        ? `${leader === 'A' ? teamA.name : teamB.name} wins by ${margin}`
        : `Halved at ${netA}`;
    else
      statusText = leader
        ? `${leader === 'A' ? teamA.name : teamB.name} by ${margin} thru ${thru}`
        : `Tied thru ${thru}`;
  }

  // Points: admin override wins; otherwise use the computed result once final.
  let points = { A: 0, B: 0 };
  let provisionalPoints = { A: 0, B: 0 };
  const overridden = match.result != null;
  if (overridden) {
    points = resultToPoints(match.result!);
    provisionalPoints = points;
    final = true;
    statusText = `${statusText} (admin: ${match.result === 'HALVED' ? 'halved' : `${match.result === 'A' ? teamA.name : teamB.name} wins`})`;
  } else if (final && thru > 0) {
    const result: Exclude<MatchResult, null> = leader ?? 'HALVED';
    points = resultToPoints(result);
    provisionalPoints = points;
  } else if (thru > 0) {
    provisionalPoints = leader ? resultToPoints(leader) : { A: 0.5, B: 0.5 };
  }

  return {
    id: match.id,
    roundId: round.id,
    format: round.format,
    teeTime: match.teeTime,
    sideA: { teamName: teamA.name, color: teamA.color, players: infosA },
    sideB: { teamName: teamB.name, color: teamB.color, players: infosB },
    thru,
    leader,
    margin,
    decided,
    final,
    overridden,
    statusText,
    points,
    provisionalPoints,
    detail,
  };
}

export interface RyderBoard {
  teams: {
    id: 'A' | 'B';
    name: string;
    color: string;
    captainId: string | null;
    playerIds: string[];
    points: number;
    provisional: number;
  }[];
  totalPoints: number;
  pointsToWin: number;
  rounds: { roundId: string; roundName: string; matches: ComputedMatch[] }[];
}

export function ryderBoard(db: DB): RyderBoard {
  const matchRounds = db.rounds.filter((r) => r.matchCount > 0);
  let ptsA = 0;
  let ptsB = 0;
  let provA = 0;
  let provB = 0;
  const rounds = matchRounds.map((round) => {
    const matches = db.matches.filter((m) => m.roundId === round.id).map((m) => computeMatch(db, round, m));
    for (const m of matches) {
      ptsA += m.points.A;
      ptsB += m.points.B;
      provA += m.provisionalPoints.A;
      provB += m.provisionalPoints.B;
    }
    return { roundId: round.id, roundName: round.name, matches };
  });
  const totalPoints = matchRounds.reduce((sum, r) => sum + r.matchCount, 0);
  const teams = db.ryderTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    captainId: t.captainId,
    playerIds: t.playerIds,
    points: t.id === 'A' ? ptsA : ptsB,
    provisional: t.id === 'A' ? provA : provB,
  }));
  return { teams, totalPoints, pointsToWin: totalPoints / 2 + 0.5, rounds };
}
