// Mirrors of the server's API payload shapes.

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
  /** Unused — strokes always come off the low man; see the server's Round type. */
  playOffLow: boolean;
  matchCount: number;
  description: string;
  status: RoundStatus;
  startedAt: number | null;
  endedAt: number | null;
  courseHandicaps: { playerId: string; courseHandicap: number; playingHandicap: number }[];
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
}

export interface Trip {
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
  strokes: number;
  updatedAt: number;
  updatedBy: string;
}

export interface PlayerHandicapInfo {
  playerId: string;
  name: string;
  handicapIndex: number;
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
  position: number;
}

export interface ComputedMatch {
  id: string;
  roundId: string;
  format: RoundFormat;
  teeTime: string | null;
  sideA: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  sideB: { teamName: string; color: string; players: PlayerHandicapInfo[] };
  thru: number;
  holeCount: number;
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  final: boolean;
  closeoutRemaining: number;
  overridden: boolean;
  closedAt: number | null;
  statusText: string;
  points: { A: number; B: number };
  provisionalPoints: { A: number; B: number };
  detail?: { totalA: number; totalB: number; unit: string };
  /** Scramble only: strokes each side receives (team handicap, off the lower side). */
  sideStrokes?: { A: number; B: number };
}

export type RoundLeaderboard =
  | { type: 'qualifier'; round: Round; rows: QualifierRow[] }
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
