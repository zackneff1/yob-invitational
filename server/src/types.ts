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
   * Retained for schema compatibility but no longer consulted: every format now
   * plays off the low man. The scope is what varies — the full 12-man field for
   * the qualifier, the players in a match for Rounds 2-5 — and that is decided
   * by which players the leaderboard hands to handicapInfoFor.
   */
  playOffLow: boolean;
  /** Number of Ryder Cup matches in this round (0 for the qualifier). */
  matchCount: number;
  description: string;
  status: RoundStatus;
  /** Epoch ms when an admin started / ended the round, or null. */
  startedAt: number | null;
  endedAt: number | null;
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
  /** Epoch ms when the match was first seen final (null while still going). */
  closedAt: number | null;
}

export type ScoreEntityType = 'player' | 'side';

export interface Score {
  roundId: string;
  /** 'player' for individual gross scores; 'side' for scramble team scores. */
  entityType: ScoreEntityType;
  /** playerId, or `${matchId}:A` / `${matchId}:B` for scramble sides. */
  entityId: string;
  hole: number;
  strokes: number;
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
