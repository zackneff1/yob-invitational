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
  /** Match-play style formats play off the low handicap in the match. */
  playOffLow: boolean;
  /** Number of Ryder Cup matches in this round (0 for the qualifier). */
  matchCount: number;
  description: string;
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
}
