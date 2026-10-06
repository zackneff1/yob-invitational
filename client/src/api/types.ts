// Mirrors of the server's API payload shapes.
import type { PolicyVersion, Rational } from '../handicapMath';

export interface PublicPlayer {
  id: string;
  name: string;
  email?: string | null;
  isAdmin: boolean;
  handicapIndex: number;
  claimed: boolean;
}

export interface Hole {
  number: number;
  par: number;
  strokeIndex: number;
  /** Hole length in yards; undefined until an admin fills it in. */
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

/** Admins move rounds upcoming → live → final; only one round is live at a time. */
export type RoundStatus = 'upcoming' | 'live' | 'final';

export interface RoundHandicap {
  playerId: string;
  /** Index the round is scored with (frozen once the round has started). */
  handicapIndex?: number;
  /** Exact unrounded Course Handicap; the phone derives match strokes from it. */
  courseHandicapRaw?: Rational;
  courseHandicap: number;
  playingHandicap: number;
}

export interface Round {
  id: string;
  name: string;
  courseId: string;
  date: string;
  dayLabel: string;
  teeTimes: string[];
  format: RoundFormat;
  formatLabel: string;
  allowance: number;
  /** Unused — the format decides the stroke rule; see handicapMath.groupStrokes. */
  playOffLow: boolean;
  matchCount: number;
  description: string;
  status: RoundStatus;
  startedAt: number | null;
  endedAt: number | null;
  /** The card the round is scored on: the frozen copy once started, else the live course. */
  scoringCourse?: Course;
  policyVersion?: PolicyVersion;
  /** Scoring basis is frozen in a snapshot. */
  frozen?: boolean;
  /** Started/finished before snapshots existed — scored from live settings. */
  snapshotMissing?: boolean;
  snapshotCapturedAt?: number | null;
  lineupHistory?: { at: number; by: string; matches: { id: string; sideA: string[]; sideB: string[] }[] }[];
  courseHandicaps: RoundHandicap[];
}

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

export interface Match {
  id: string;
  roundId: string;
  teeTime: string | null;
  sideA: string[];
  sideB: string[];
  result: 'A' | 'B' | 'HALVED' | null;
  closedAt: number | null;
  resultKey?: string | null;
}

export interface Trip {
  /** Server build identifier (non-secret), for verifying the deployed version. */
  build?: string;
  /** Oldest client generation the server treats as current. */
  minClientVersion?: number;
  policyVersion?: PolicyVersion;
  players: PublicPlayer[];
  courses: Course[];
  rounds: Round[];
  pairings: Pairing[];
  ryderTeams: RyderTeam[];
  matches: Match[];
  /** Key/value trip settings set in Admin (lodging door codes etc.). */
  settings: Record<string, string>;
}

export interface Score {
  roundId: string;
  entityType: 'player' | 'side';
  entityId: string;
  hole: number;
  /** Gross strokes; null for a pickup. */
  strokes: number | null;
  /** Explicit pickup / no return. */
  pickup?: boolean;
  updatedAt: number;
  updatedBy: string;
}

export interface PlayerHandicapInfo {
  playerId: string;
  name: string;
  handicapIndex: number;
  courseHandicapRaw?: Rational;
  courseHandicap: number;
  playingHandicap: number;
  effectiveHandicap: number;
}

export interface QualifierRow {
  pairingId: string;
  name: string;
  teeTime: string | null;
  players: PlayerHandicapInfo[];
  thru: number;
  net: number;
  toPar: number;
  /** Shared position; null for a team with no return. */
  position: number | null;
  tied: boolean;
  noReturn: boolean;
  complete: boolean;
}

export interface TieResolution {
  pairingId: string;
  reason: string;
  by: string;
  at: number;
}

export interface MatchReading {
  thru: number;
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  closeoutRemaining: number;
  complete: boolean;
  totals?: { A: number; B: number; unit: string };
}

export interface ComputedMatch {
  id: string;
  roundId: string;
  format: RoundFormat;
  teeTime: string | null;
  sideA: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  sideB: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  holeCount: number;
  /** Confirmed reading (fully resolved holes only). */
  thru: number;
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  final: boolean;
  closeoutRemaining: number;
  /** Everything that has arrived, including holes with a partner's score missing. */
  provisional?: MatchReading;
  unresolvedHoles?: number[];
  missing?: { entityId: string; name: string; holes: number[] }[];
  overridden: boolean;
  closedAt: number | null;
  resultKey?: string | null;
  statusText: string;
  points: { A: number; B: number };
  provisionalPoints: { A: number; B: number };
  detail?: { totalA: number; totalB: number; unit: string };
  /** Scramble only: strokes each side receives (team handicap, off the lower side). */
  sideStrokes?: { A: number; B: number };
  policyVersion?: PolicyVersion;
  frozen?: boolean;
  snapshotMissing?: boolean;
}

export type RoundLeaderboard =
  | {
      type: 'qualifier';
      round: Round;
      rows: QualifierRow[];
      tieForFirst?: { pairingIds: string[]; resolution: TieResolution | null } | null;
      policyVersion?: PolicyVersion;
      frozen?: boolean;
      snapshotMissing?: boolean;
    }
  | { type: 'matches'; round: Round; matches: ComputedMatch[] };

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
  matchesTotal?: number;
  matchesFinal?: number;
  /** 'A' | 'B' once won; 'TIE' when every match is final and level; else 'in-progress'. */
  outcome?: 'in-progress' | 'A' | 'B' | 'TIE';
  rounds: {
    roundId: string;
    roundName: string;
    roundStatus: RoundStatus;
    matches: ComputedMatch[];
  }[];
}

export interface AuthResponse {
  token: string;
  player: PublicPlayer;
}
