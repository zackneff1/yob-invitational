import type { PolicyVersion } from './services/handicapMath';

export interface Player {
  id: string;
  name: string;
  email: string | null;
  passwordHash: string | null;
  isAdmin: boolean;
  handicapIndex: number;
}

export interface Hole {
  number: number;
  par: number;
  /** Stroke index (handicap ranking) of the hole, 1 = hardest. */
  strokeIndex: number;
  /** Hole length in yards from the tees being played. Optional — the seeded
   *  placeholder cards have no yardages until an admin enters them. */
  yards?: number;
}

export interface Course {
  id: string;
  name: string;
  location: string;
  tee: string;
  par: number;
  rating: number;
  slope: number;
  holes: Hole[];
  notes?: string;
}

export type RoundFormat = 'bestball-qualifier' | 'fourball' | 'stableford' | 'scramble' | 'singles';

/**
 * Where a round is in its life. Admins move rounds through these from the
 * Admin tab; only one round is 'live' at a time, and that is the round
 * everyone else scores.
 */
export type RoundStatus = 'upcoming' | 'live' | 'final';

/**
 * Everything a round's results depend on, frozen when an admin starts it.
 * While a snapshot exists, scoring reads from it — not from the live Course,
 * Player or Round rows — so later Admin edits cannot rewrite a played round.
 */
export interface ScoringSnapshot {
  version: 1;
  policyVersion: PolicyVersion;
  capturedAt: number;
  roundId: string;
  format: RoundFormat;
  allowance: number;
  course: Course;
  players: { id: string; name: string; handicapIndex: number }[];
  teams: { id: 'A' | 'B'; name: string; captainId: string | null; playerIds: string[] }[];
  pairings: { id: string; name: string; playerIds: string[]; teeTime: string | null }[];
  matches: { id: string; sideA: string[]; sideB: string[]; teeTime: string | null }[];
  /**
   * Strokes at capture time, for the record: per player (R1/R2/R3/R5) keyed by
   * player id within a group, or per scramble side keyed `${matchId}:A`.
   * Results are recomputed deterministically from the inputs above, so this is
   * documentation of what the players were told, not an input.
   */
  strokes: Record<string, { strokes: number; allocation: number[] }>;
  /** Lineup edits made after the round started (live rounds only), newest last. */
  lineupHistory?: { at: number; by: string; matches: { id: string; sideA: string[]; sideB: string[] }[] }[];
}

export interface Round {
  id: string;
  name: string;
  courseId: string;
  /** ISO date, e.g. 2026-10-10 */
  date: string;
  dayLabel: string;
  teeTimes: string[];
  format: RoundFormat;
  formatLabel: string;
  /** Handicap allowance applied to each player's course handicap (e.g. 0.85). */
  allowance: number;
  /**
   * Retained for schema compatibility but no longer consulted. Which players
   * are reduced, and how, is decided by the format (see handicapMath.groupStrokes).
   */
  playOffLow: boolean;
  /** Number of Ryder Cup matches in this round (0 for the qualifier). */
  matchCount: number;
  description: string;
  status: RoundStatus;
  /** Epoch ms when an admin started / ended the round, or null. */
  startedAt: number | null;
  endedAt: number | null;
  scoringSnapshot: ScoringSnapshot | null;
}

/** Round 1 two-man best-ball team (randomly drawn). */
export interface Pairing {
  id: string;
  roundId: string;
  name: string;
  playerIds: string[];
  teeTime: string | null;
}

export interface RyderTeam {
  id: 'A' | 'B';
  name: string;
  color: string;
  captainId: string | null;
  playerIds: string[];
}

export type MatchResult = 'A' | 'B' | 'HALVED' | null;

export interface Match {
  id: string;
  roundId: string;
  teeTime: string | null;
  sideA: string[];
  sideB: string[];
  /** Admin override; when null the result is computed from scores. */
  result: MatchResult;
  /** Epoch ms when the current final result was established (null while open). */
  closedAt: number | null;
  /** Identity of the final result closedAt refers to. */
  resultKey: string | null;
}

export type ScoreEntityType = 'player' | 'side';

export interface Score {
  roundId: string;
  /** 'player' for individual gross scores; 'side' for scramble team scores. */
  entityType: ScoreEntityType;
  /** playerId, or `${matchId}:A` / `${matchId}:B` for scramble sides. */
  entityId: string;
  hole: number;
  /** Gross strokes; null only for a pickup. */
  strokes: number | null;
  /** Explicit pickup / no return on this hole. */
  pickup: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface DB {
  users: Player[];
  courses: Course[];
  rounds: Round[];
  pairings: Pairing[];
  ryderTeams: RyderTeam[];
  matches: Match[];
  scores: Score[];
  /** Key/value trip settings (see the Setting model). */
  settings: Record<string, string>;
}
