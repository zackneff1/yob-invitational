/**
 * In-memory fixtures for the scoring tests. No database, no network.
 */
import type { Trip } from '../../client/src/api/types';
import { buildGroups, liveMatchState, scoreboardSides } from '../../client/src/scorecard';
import { scoringBasis } from '../src/services/basis';
import { courseHandicapFromRaw, playingHandicapFromRaw } from '../src/services/handicapMath';
import { courseHandicapRawFor } from '../src/services/scoring';
import { courses2026 } from '../src/store/courses2026';
import { seedPlayers, seedRounds } from '../src/store/seed';
import type { Course, DB, Match, Pairing, Player, Round, Score } from '../src/types';

export const COURSES = courses2026();
export const ROUNDS = seedRounds();
export const PLAYERS = seedPlayers();

export const byName = (n: string): Player => {
  const p = PLAYERS.find((x) => x.name === n);
  if (!p) throw new Error(`no seeded player ${n}`);
  return p;
};
export const roundOf = (id: string): Round => ROUNDS.find((r) => r.id === id)!;
export const courseOf = (round: Round): Course => COURSES.find((c) => c.id === round.courseId)!;
export const pars = (course: Course) => course.holes.map((h) => h.par);
export const plus = (base: number[], delta: number) => base.map((v) => v + delta);

export interface Fixture {
  players?: Player[];
  rounds?: Round[];
  courses?: Course[];
  pairings?: Pairing[];
  matches?: Match[];
  scores?: Score[];
  settings?: Record<string, string>;
}

export function makeDb(f: Fixture = {}): DB {
  return {
    users: f.players ?? PLAYERS,
    courses: f.courses ?? COURSES,
    rounds: f.rounds ?? ROUNDS,
    pairings: f.pairings ?? [],
    ryderTeams: [
      { id: 'A', name: 'Team A', color: '#1d4ed8', captainId: null, playerIds: [] },
      { id: 'B', name: 'Team B', color: '#b91c1c', captainId: null, playerIds: [] },
    ],
    matches: f.matches ?? [],
    scores: f.scores ?? [],
    settings: f.settings ?? {},
  };
}

export function match(id: string, roundId: string, sideA: string[], sideB: string[], result: Match['result'] = null): Match {
  return { id, roundId, teeTime: null, sideA, sideB, result, closedAt: null, resultKey: null };
}

export type HoleEntry = number | null | 'P';

/** Scores for a player: a number, null (nothing entered) or 'P' (pickup) per hole. */
export function playerScores(roundId: string, playerId: string, holes: HoleEntry[]): Score[] {
  return holes.flatMap((g, i) =>
    g == null
      ? []
      : [
          {
            roundId,
            entityType: 'player' as const,
            entityId: playerId,
            hole: i + 1,
            strokes: g === 'P' ? null : g,
            pickup: g === 'P',
            updatedAt: 1,
            updatedBy: playerId,
          },
        ],
  );
}

export function sideScores(roundId: string, matchId: string, side: 'A' | 'B', holes: HoleEntry[]): Score[] {
  return holes.flatMap((g, i) =>
    g == null
      ? []
      : [
          {
            roundId,
            entityType: 'side' as const,
            entityId: `${matchId}:${side}`,
            hole: i + 1,
            strokes: g === 'P' ? null : g,
            pickup: g === 'P',
            updatedAt: 1,
            updatedBy: 'x',
          },
        ],
  );
}

/** The client's view of the same DB, as GET /api/trip would hand it over. */
export function tripOf(db: DB): Trip {
  return {
    minClientVersion: 2,
    players: db.users.map((p) => ({ id: p.id, name: p.name, isAdmin: p.isAdmin, handicapIndex: p.handicapIndex, claimed: true })),
    courses: db.courses,
    rounds: db.rounds.map((r) => {
      const basis = scoringBasis(db, r);
      const { scoringSnapshot: _s, ...round } = r;
      return {
        ...round,
        scoringCourse: basis.course,
        policyVersion: basis.policy,
        frozen: basis.frozen,
        snapshotMissing: basis.snapshotMissing,
        courseHandicaps: basis.players.map((p) => {
          const raw = courseHandicapRawFor(p.handicapIndex, basis.course, basis.policy);
          return {
            playerId: p.id,
            handicapIndex: p.handicapIndex,
            courseHandicapRaw: raw,
            courseHandicap: courseHandicapFromRaw(raw),
            playingHandicap: playingHandicapFromRaw(raw, basis.allowance, basis.policy),
          };
        }),
      };
    }),
    pairings: db.pairings,
    ryderTeams: db.ryderTeams,
    matches: db.matches,
    settings: db.settings,
  };
}

/** Client-side live state for a match, computed from the same scores. */
export function clientStateFor(db: DB, roundId: string, matchId: string) {
  const trip = tripOf(db);
  const groups = buildGroups(trip, roundId, (t) => t);
  const group = groups.find((g) => g.id === matchId)!;
  const round = trip.rounds.find((r) => r.id === roundId)!;
  const course = round.scoringCourse!;
  const valueFor = (col: { entityType: string; entityId: string }, hole: number): number | '' | 'pickup' => {
    const s = db.scores.find(
      (x) => x.roundId === roundId && x.entityType === col.entityType && x.entityId === col.entityId && x.hole === hole,
    );
    if (!s) return '';
    return s.pickup || s.strokes == null ? 'pickup' : s.strokes;
  };
  return { state: liveMatchState(course, round, group, valueFor), group, sides: scoreboardSides(group), trip };
}

// Deterministic PRNG so random fixtures are reproducible.
export function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
