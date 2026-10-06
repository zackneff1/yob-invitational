import { Course, DB, Player, Round, ScoringSnapshot } from '../types';
import { allocateStrokes, PolicyVersion, SCORING_POLICY_VERSION } from './handicapMath';
import { handicapInfoFor, scrambleSidesFor } from './scoring';

/**
 * The scoring basis for a round: the course card, the players' indexes, the
 * allowance and the policy version that results are computed from.
 *
 * A round that has been started carries a snapshot, and the basis comes from
 * it — so editing an index, a stroke index or an allowance in Admin cannot
 * change a round that is under way or finished. A round without a snapshot
 * is scored from the live rows (and flagged, because it should have one once
 * it has started).
 */
export interface ScoringBasis {
  course: Course;
  players: Player[];
  allowance: number;
  policy: PolicyVersion;
  frozen: boolean;
  /** Started/finished without a snapshot (data predating snapshots). */
  snapshotMissing: boolean;
  snapshotCapturedAt: number | null;
}

export function scoringBasis(db: DB, round: Round): ScoringBasis {
  const snap = round.scoringSnapshot;
  if (snap) {
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    return {
      course: snap.course,
      players: db.users.map((u) => {
        const s = byId.get(u.id);
        // A player unknown to the snapshot (added afterwards) keeps the live index.
        return s ? { ...u, name: s.name, handicapIndex: s.handicapIndex } : u;
      }),
      allowance: snap.allowance,
      policy: snap.policyVersion,
      frozen: true,
      snapshotMissing: false,
      snapshotCapturedAt: snap.capturedAt,
    };
  }
  const course = db.courses.find((c) => c.id === round.courseId)!;
  return {
    course,
    players: db.users,
    allowance: round.allowance,
    policy: SCORING_POLICY_VERSION,
    frozen: false,
    snapshotMissing: round.status !== 'upcoming',
    snapshotCapturedAt: null,
  };
}

/**
 * Build the snapshot for a round from the live rows, including the strokes
 * each player/side receives in the groups that exist at capture time.
 */
export function buildSnapshot(db: DB, round: Round, now = Date.now()): ScoringSnapshot {
  const course = db.courses.find((c) => c.id === round.courseId)!;
  const policy = SCORING_POLICY_VERSION;
  const strokeIndexes = course.holes.map((h) => h.strokeIndex);
  const strokes: ScoringSnapshot['strokes'] = {};
  const playersOf = (ids: string[]) =>
    ids.map((id) => db.users.find((u) => u.id === id)).filter((p): p is Player => Boolean(p));

  const pairings = db.pairings.filter((p) => p.roundId === round.id);
  const matches = db.matches.filter((m) => m.roundId === round.id);

  if (round.format === 'bestball-qualifier') {
    const field = playersOf([...new Set(pairings.flatMap((p) => p.playerIds))]);
    for (const info of handicapInfoFor(field, round.format, round.allowance, course, policy)) {
      strokes[info.playerId] = {
        strokes: info.effectiveHandicap,
        allocation: allocateStrokes(info.effectiveHandicap, strokeIndexes),
      };
    }
  } else {
    for (const m of matches) {
      const a = playersOf(m.sideA);
      const b = playersOf(m.sideB);
      if (round.format === 'scramble') {
        const sides = scrambleSidesFor([a, b], course, policy);
        strokes[`${m.id}:A`] = { strokes: sides.strokes[0], allocation: allocateStrokes(sides.strokes[0], strokeIndexes) };
        strokes[`${m.id}:B`] = { strokes: sides.strokes[1], allocation: allocateStrokes(sides.strokes[1], strokeIndexes) };
      } else {
        for (const info of handicapInfoFor([...a, ...b], round.format, round.allowance, course, policy)) {
          strokes[`${m.id}:${info.playerId}`] = {
            strokes: info.effectiveHandicap,
            allocation: allocateStrokes(info.effectiveHandicap, strokeIndexes),
          };
        }
      }
    }
  }

  return {
    version: 1,
    policyVersion: policy,
    capturedAt: now,
    roundId: round.id,
    format: round.format,
    allowance: round.allowance,
    course: JSON.parse(JSON.stringify(course)) as Course,
    players: db.users.map((u) => ({ id: u.id, name: u.name, handicapIndex: u.handicapIndex })),
    teams: db.ryderTeams.map((t) => ({ id: t.id, name: t.name, captainId: t.captainId, playerIds: [...t.playerIds] })),
    pairings: pairings.map((p) => ({ id: p.id, name: p.name, playerIds: [...p.playerIds], teeTime: p.teeTime })),
    matches: matches.map((m) => ({ id: m.id, sideA: [...m.sideA], sideB: [...m.sideB], teeTime: m.teeTime })),
    strokes,
  };
}
