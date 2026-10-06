import { DB, Match, MatchResult, Pairing, Player, Round } from '../types';
import { ScoringBasis, scoringBasis } from './basis';
import { PolicyVersion } from './handicapMath';
import {
  GrossValue,
  PlayerHandicapInfo,
  buildScoreMap,
  grossFor,
  handicapInfoFor,
  netFor,
  netScore,
  scrambleSidesFor,
  stablefordPoints,
  strokesOnHole,
} from './scoring';

// ── Round 1 qualifier (two-man best ball, net stroke play) ────────────────

export interface QualifierRow {
  pairingId: string;
  name: string;
  teeTime: string | null;
  players: PlayerHandicapInfo[];
  /** Holes with a counting team score. */
  thru: number;
  net: number;
  toPar: number;
  /** Shared ("T") positions; null for a team with no return. */
  position: number | null;
  tied: boolean;
  /** Both partners picked up on a hole: the team has no score for the round. */
  noReturn: boolean;
  /** Every hole has a counting team score. */
  complete: boolean;
}

export interface TieResolution {
  pairingId: string;
  reason: string;
  by: string;
  at: number;
}

export interface QualifierBoard {
  rows: QualifierRow[];
  /** A tie for first among completed teams needs a decision before captains are named. */
  tieForFirst: { pairingIds: string[]; resolution: TieResolution | null } | null;
  policyVersion: PolicyVersion;
  frozen: boolean;
  snapshotMissing: boolean;
}

export const TIE_SETTING_PREFIX = 'tie.';

export function qualifierLeaderboard(db: DB, round: Round): QualifierBoard {
  const basis = scoringBasis(db, round);
  const course = basis.course;
  const map = buildScoreMap(db.scores, round.id);
  const n = course.holes.length;

  const pairings = db.pairings.filter((p) => p.roundId === round.id);
  const playerOf = (id: string) => basis.players.find((u) => u.id === id);

  // The whole field is one handicap group: under policy 2 everyone plays the
  // full Playing Handicap (stroke play); under policy 1 strokes came off the
  // field's low man.
  const fieldPlayers = [...new Set(pairings.flatMap((p) => p.playerIds))]
    .map(playerOf)
    .filter((p): p is Player => Boolean(p));
  const fieldInfos = handicapInfoFor(fieldPlayers, round.format, basis.allowance, course, basis.policy);
  const infoFor = new Map(fieldInfos.map((i) => [i.playerId, i]));

  const rows: QualifierRow[] = pairings.map((pairing: Pairing) => {
    const players = pairing.playerIds.map(playerOf).filter((p): p is Player => Boolean(p));
    const infos = players.map((p) => infoFor.get(p.id)).filter((i): i is PlayerHandicapInfo => Boolean(i));
    let net = 0;
    let par = 0;
    let thru = 0;
    let noReturn = false;
    for (const hole of course.holes) {
      const values = infos.map((info) => netFor(map, info, hole, n));
      const numeric = values.filter((v): v is number => typeof v === 'number');
      if (numeric.length) {
        thru += 1;
        par += hole.par;
        net += Math.min(...numeric);
      } else if (values.length && values.every((v) => v === 'pickup')) {
        // Every partner picked up: no team score exists for this hole.
        noReturn = true;
      }
    }
    return {
      pairingId: pairing.id,
      name: pairing.name || players.map((p) => p.name).join(' / '),
      teeTime: pairing.teeTime,
      players: infos,
      thru,
      net,
      toPar: net - par,
      position: null,
      tied: false,
      noReturn,
      complete: !noReturn && thru === n,
    };
  });

  rows.sort((a, b) => {
    if (a.noReturn !== b.noReturn) return a.noReturn ? 1 : -1;
    if (a.thru === 0 && b.thru === 0) return 0;
    if (a.thru === 0) return 1;
    if (b.thru === 0) return -1;
    return a.toPar - b.toPar || b.thru - a.thru;
  });
  // Standard competition ranking: equal to-par and holes played share a position.
  const ranked = rows.filter((r) => !r.noReturn && r.thru > 0);
  ranked.forEach((r, i) => {
    const same = ranked.filter((o) => o.toPar === r.toPar && o.thru === r.thru);
    r.position = ranked.findIndex((o) => o.toPar === r.toPar && o.thru === r.thru) + 1;
    r.tied = same.length > 1;
    void i;
  });

  const completedLeaders = ranked.filter((r) => r.position === 1 && r.complete);
  let tieForFirst: QualifierBoard['tieForFirst'] = null;
  if (completedLeaders.length > 1 && ranked.every((r) => r.complete || r.toPar > completedLeaders[0].toPar)) {
    const raw = db.settings[`${TIE_SETTING_PREFIX}${round.id}`];
    let resolution: TieResolution | null = null;
    if (raw) {
      try {
        resolution = JSON.parse(raw) as TieResolution;
      } catch {
        resolution = null;
      }
    }
    tieForFirst = { pairingIds: completedLeaders.map((r) => r.pairingId), resolution };
  }

  return {
    rows,
    tieForFirst,
    policyVersion: basis.policy,
    frozen: basis.frozen,
    snapshotMissing: basis.snapshotMissing,
  };
}

// ── Ryder Cup matches ──────────────────────────────────────────────────────

export interface MatchReading {
  /** Holes counted. */
  thru: number;
  /** Which side leads (null = all square / tied / nothing yet). */
  leader: 'A' | 'B' | null;
  margin: number;
  /** Match play: the lead exceeds the holes left. */
  decided: boolean;
  /** Match play: holes left when closed out early. */
  closeoutRemaining: number;
  /** Decided, or every hole counted. */
  complete: boolean;
  /** Stableford points / scramble net, when the format has totals. */
  totals?: { A: number; B: number; unit: string };
}

export interface ComputedMatch {
  id: string;
  roundId: string;
  format: Round['format'];
  teeTime: string | null;
  sideA: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  sideB: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  holeCount: number;
  /** Confirmed reading — only holes where every ball is resolved (score or pickup). */
  thru: number;
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  final: boolean;
  closeoutRemaining: number;
  /**
   * Provisional reading — every ball that has arrived, including holes where a
   * partner's score is still missing. Never produces a final result or a point.
   */
  provisional: MatchReading;
  /** Holes inside the provisional reading that are not yet fully resolved. */
  unresolvedHoles: number[];
  /** Players (or sides) with a missing score inside the provisional reading. */
  missing: { entityId: string; name: string; holes: number[] }[];
  overridden: boolean;
  /** Epoch ms the current final result was established, or null. */
  closedAt: number | null;
  /** Identity of the final result ("A:3&2", "HALVED", "B:24-21", "OVR:A"); null until final. */
  resultKey: string | null;
  statusText: string;
  /** Confirmed points only. */
  points: { A: number; B: number };
  /** Points if every match ended as it provisionally stands. */
  provisionalPoints: { A: number; B: number };
  detail?: { totalA: number; totalB: number; unit: string };
  /** Scramble only: strokes each side receives (team handicap, off the lower side). */
  sideStrokes?: { A: number; B: number };
  policyVersion: PolicyVersion;
  frozen: boolean;
  snapshotMissing: boolean;
}

function resultToPoints(result: Exclude<MatchResult, null>): { A: number; B: number } {
  if (result === 'A') return { A: 1, B: 0 };
  if (result === 'B') return { A: 0, B: 1 };
  return { A: 0.5, B: 0.5 };
}

type SideValues = GrossValue[];

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
  // One side has only pickups: the other side wins the hole with any score.
  if (numA.length && !numB.length) return 1;
  if (numB.length && !numA.length) return -1;
  // Both sides picked up every ball: halved.
  return 0;
}

export function computeMatch(db: DB, round: Round, match: Match): ComputedMatch {
  const basis: ScoringBasis = scoringBasis(db, round);
  const course = basis.course;
  const map = buildScoreMap(db.scores, round.id);
  const n = course.holes.length;

  const playersOf = (ids: string[]) =>
    ids.map((id) => basis.players.find((u) => u.id === id)).filter((p): p is Player => Boolean(p));
  const playersA = playersOf(match.sideA);
  const playersB = playersOf(match.sideB);

  const teamA = db.ryderTeams.find((t) => t.id === 'A')!;
  const teamB = db.ryderTeams.find((t) => t.id === 'B')!;

  // Strokes are worked out across the whole match (all players in it).
  const allInfos = handicapInfoFor([...playersA, ...playersB], round.format, basis.allowance, course, basis.policy);
  const infosA = allInfos.slice(0, playersA.length);
  const infosB = allInfos.slice(playersA.length);

  const confirmed: MatchReading = { thru: 0, leader: null, margin: 0, decided: false, closeoutRemaining: 0, complete: false };
  const provisional: MatchReading = { thru: 0, leader: null, margin: 0, decided: false, closeoutRemaining: 0, complete: false };
  const unresolvedHoles: number[] = [];
  const missingMap = new Map<string, { name: string; holes: number[] }>();
  let detail: ComputedMatch['detail'];
  let sideStrokes: ComputedMatch['sideStrokes'];
  let statusText = 'Not started';

  const noteMissing = (entityId: string, name: string, hole: number) => {
    const m = missingMap.get(entityId) ?? { name, holes: [] };
    m.holes.push(hole);
    missingMap.set(entityId, m);
  };

  const isMatchPlay =
    round.format === 'fourball' || round.format === 'singles' || round.format === 'scramble';
  if (round.format === 'scramble') {
    const sides = scrambleSidesFor([playersA, playersB], course, basis.policy);
    sideStrokes = { A: sides.strokes[0], B: sides.strokes[1] };
  }
  /** Each side's balls on a hole: player nets, or the single team net in a scramble. */
  const sideValues = (hole: (typeof course.holes)[number]): { valsA: GrossValue[]; valsB: GrossValue[] } => {
    if (round.format !== 'scramble') {
      return { valsA: infosA.map((i) => netFor(map, i, hole, n)), valsB: infosB.map((i) => netFor(map, i, hole, n)) };
    }
    const side = (which: 'A' | 'B'): GrossValue => {
      const gross = grossFor(map, 'side', `${match.id}:${which}`, hole.number);
      // A side must return a team score; a stray pickup row counts as missing.
      if (typeof gross !== 'number') return null;
      return netScore(gross, hole.par, strokesOnHole(sideStrokes![which], hole.strokeIndex, n));
    };
    return { valsA: [side('A')], valsB: [side('B')] };
  };

  if (isMatchPlay) {
    // Two passes over the same holes: confirmed stops at the first hole with
    // any ball missing; provisional continues while each side has at least one.
    let diffC = 0;
    let diffP = 0;
    let confirmedOpen = true;
    for (const hole of course.holes) {
      const { valsA, valsB } = sideValues(hole);
      const resolved = [...valsA, ...valsB].every((v) => v != null);
      const outcome = holeOutcome(valsA, valsB);
      if (outcome == null) break; // a whole side is missing: nothing further can be read
      if (!resolved) {
        unresolvedHoles.push(hole.number);
        if (round.format === 'scramble') {
          if (valsA[0] == null) noteMissing(`${match.id}:A`, teamA.name, hole.number);
          if (valsB[0] == null) noteMissing(`${match.id}:B`, teamB.name, hole.number);
        } else {
          infosA.forEach((i, k) => valsA[k] == null && noteMissing(i.playerId, i.name, hole.number));
          infosB.forEach((i, k) => valsB[k] == null && noteMissing(i.playerId, i.name, hole.number));
        }
      }
      // provisional
      if (!provisional.decided) {
        diffP += outcome;
        provisional.thru += 1;
        if (Math.abs(diffP) > n - provisional.thru) {
          provisional.decided = true;
          provisional.closeoutRemaining = n - provisional.thru;
        }
      }
      // confirmed
      if (confirmedOpen && resolved && !confirmed.decided) {
        diffC += outcome;
        confirmed.thru += 1;
        if (Math.abs(diffC) > n - confirmed.thru) {
          confirmed.decided = true;
          confirmed.closeoutRemaining = n - confirmed.thru;
        }
      } else if (!resolved) {
        confirmedOpen = false; // an unresolved hole blocks everything after it
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
    let cA = 0, cB = 0, pA = 0, pB = 0;
    let resolvedHoles = 0;
    let anyHole = 0;
    for (const hole of course.holes) {
      const valsA = infosA.map((i) => netFor(map, i, hole, n));
      const valsB = infosB.map((i) => netFor(map, i, hole, n));
      const all = [...valsA, ...valsB];
      if (all.every((v) => v == null)) continue;
      anyHole += 1;
      const pts = (vals: GrossValue[]) =>
        vals.reduce<number>((s, v) => s + (typeof v === 'number' ? stablefordPoints(v, hole.par) : 0), 0);
      pA += pts(valsA);
      pB += pts(valsB);
      if (all.every((v) => v != null)) {
        resolvedHoles += 1;
        cA += pts(valsA);
        cB += pts(valsB);
      } else {
        unresolvedHoles.push(hole.number);
        infosA.forEach((i, k) => valsA[k] == null && noteMissing(i.playerId, i.name, hole.number));
        infosB.forEach((i, k) => valsB[k] == null && noteMissing(i.playerId, i.name, hole.number));
      }
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
    detail = confirmed.complete ? { totalA: cA, totalB: cB, unit: 'pts' } : { totalA: pA, totalB: pB, unit: 'pts' };
  }

  // ── Final result, points, identity ──
  let final = confirmed.complete && confirmed.thru > 0;
  const overridden = match.result != null;
  let points = { A: 0, B: 0 };
  let provisionalPoints = { A: 0, B: 0 };
  let resultKey: string | null = null;
  const nameOf = (s: 'A' | 'B' | null) => (s === 'A' ? teamA.name : s === 'B' ? teamB.name : null);

  const describe = (r: MatchReading): string => {
    if (isMatchPlay) {
      if (r.complete) {
        if (!r.leader) return 'Halved';
        return r.closeoutRemaining > 0
          ? `${nameOf(r.leader)} wins ${r.margin}&${r.closeoutRemaining}`
          : `${nameOf(r.leader)} wins ${r.margin} UP`;
      }
      return r.leader ? `${nameOf(r.leader)} ${r.margin} UP thru ${r.thru}` : `All square thru ${r.thru}`;
    }
    const t = r.totals ?? { A: 0, B: 0, unit: '' };
    if (r.complete) {
      return r.leader ? `${nameOf(r.leader)} wins ${t.A}–${t.B}` : `Halved ${t.A}–${t.B}`;
    }
    return r.leader
      ? `${nameOf(r.leader)} by ${r.margin} (${t.A}–${t.B}) thru ${r.thru}`
      : `Tied ${t.A}–${t.B} thru ${r.thru}`;
  };

  if (overridden) {
    points = resultToPoints(match.result!);
    provisionalPoints = points;
    final = true;
    resultKey = `OVR:${match.result}`;
    statusText = `${describe(provisional)} (admin: ${match.result === 'HALVED' ? 'halved' : `${nameOf(match.result)} wins`})`;
    // The override is the result: make the confirmed reading say so.
    confirmed.leader = match.result === 'HALVED' ? null : match.result;
    confirmed.complete = true;
  } else if (final) {
    const result: Exclude<MatchResult, null> = confirmed.leader ?? 'HALVED';
    points = resultToPoints(result);
    provisionalPoints = points;
    const t = confirmed.totals;
    resultKey = isMatchPlay
      ? confirmed.leader
        ? `${confirmed.leader}:${confirmed.closeoutRemaining > 0 ? `${confirmed.margin}&${confirmed.closeoutRemaining}` : `${confirmed.margin}UP`}`
        : 'HALVED'
      : `${confirmed.leader ?? 'H'}:${t?.A ?? 0}-${t?.B ?? 0}`;
    statusText = describe(confirmed);
  } else {
    if (provisional.thru > 0) {
      provisionalPoints = provisional.leader ? resultToPoints(provisional.leader) : { A: 0.5, B: 0.5 };
      statusText = describe(provisional);
      if (unresolvedHoles.length) {
        statusText += provisional.complete ? ' — pending' : ' (prov.)';
        statusText += ` · ${unresolvedHoles.length} hole${unresolvedHoles.length > 1 ? 's' : ''} awaiting scores`;
      }
    } else {
      statusText = 'Not started';
    }
  }

  return {
    id: match.id,
    roundId: round.id,
    format: round.format,
    teeTime: match.teeTime,
    sideA: { teamName: teamA.name, color: teamA.color, players: infosA },
    sideB: { teamName: teamB.name, color: teamB.color, players: infosB },
    holeCount: n,
    thru: confirmed.thru,
    leader: confirmed.leader,
    margin: confirmed.margin,
    decided: confirmed.decided,
    final,
    closeoutRemaining: confirmed.closeoutRemaining,
    provisional,
    unresolvedHoles,
    missing: [...missingMap.entries()].map(([entityId, m]) => ({ entityId, name: m.name, holes: m.holes })),
    overridden,
    closedAt: match.closedAt,
    resultKey,
    statusText,
    points,
    provisionalPoints,
    detail,
    sideStrokes,
    policyVersion: basis.policy,
    frozen: basis.frozen,
    snapshotMissing: basis.snapshotMissing,
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
  matchesTotal: number;
  matchesFinal: number;
  /**
   * 'A' / 'B' once a side has reached the winning total; 'TIE' when every
   * match is final and the points are level (a completed tie — what happens
   * next is an organizer decision, not something the app invents); otherwise
   * 'in-progress'.
   */
  outcome: 'in-progress' | 'A' | 'B' | 'TIE';
  rounds: {
    roundId: string;
    roundName: string;
    roundStatus: Round['status'];
    matches: ComputedMatch[];
  }[];
}

export function ryderBoard(db: DB): RyderBoard {
  const matchRounds = db.rounds.filter((r) => r.matchCount > 0);
  let ptsA = 0;
  let ptsB = 0;
  let provA = 0;
  let provB = 0;
  let matchesTotal = 0;
  let matchesFinal = 0;
  const rounds = matchRounds.map((round) => {
    const matches = db.matches.filter((m) => m.roundId === round.id).map((m) => computeMatch(db, round, m));
    for (const m of matches) {
      ptsA += m.points.A;
      ptsB += m.points.B;
      provA += m.provisionalPoints.A;
      provB += m.provisionalPoints.B;
      matchesTotal += 1;
      if (m.final) matchesFinal += 1;
    }
    return { roundId: round.id, roundName: round.name, roundStatus: round.status, matches };
  });
  const totalPoints = matchRounds.reduce((sum, r) => sum + r.matchCount, 0);
  const pointsToWin = totalPoints / 2 + 0.5;
  // Only matches that exist can be final; the Cup is complete when all the
  // scheduled matches exist and are final.
  const allScheduledFinal = matchesTotal === totalPoints && matchesFinal === matchesTotal && matchesTotal > 0;
  let outcome: RyderBoard['outcome'] = 'in-progress';
  if (ptsA >= pointsToWin) outcome = 'A';
  else if (ptsB >= pointsToWin) outcome = 'B';
  else if (allScheduledFinal && ptsA === ptsB) outcome = 'TIE';
  const teams = db.ryderTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    captainId: t.captainId,
    playerIds: t.playerIds,
    points: t.id === 'A' ? ptsA : ptsB,
    provisional: t.id === 'A' ? provA : provB,
  }));
  return { teams, totalPoints, pointsToWin, matchesTotal, matchesFinal, outcome, rounds };
}
