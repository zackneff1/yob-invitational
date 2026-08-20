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
  date: string;
  dayLabel: string;
  teeTimes: string[];
  format: RoundFormat;
  formatLabel: string;
  allowance: number;
  playOffLow: boolean;
  matchCount: number;
  description: string;
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
}

export interface Trip {
  players: PublicPlayer[];
  courses: Course[];
  rounds: Round[];
  pairings: Pairing[];
  ryderTeams: RyderTeam[];
  matches: Match[];
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
  leader: 'A' | 'B' | null;
  margin: number;
  decided: boolean;
  final: boolean;
  overridden: boolean;
  statusText: string;
  points: { A: number; B: number };
  provisionalPoints: { A: number; B: number };
  detail?: { totalA: number; totalB: number; unit: string };
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
  rounds: { roundId: string; roundName: string; matches: ComputedMatch[] }[];
}

export interface AuthResponse {
  token: string;
  player: PublicPlayer;
}
