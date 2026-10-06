import { Round, RoundStatus } from './api/types';

/**
 * Which rounds people can see and score, driven by the status admins set.
 *
 * - Scoring is scoped to the one live round (admins can reach every round).
 * - The Leaderboard shows rounds that have started, plus the next one up so
 *   people can look at the lineups before they tee off.
 */

export function liveRound(rounds: Round[]): Round | undefined {
  return rounds.find((r) => r.status === 'live');
}

/** "R1", "R2" … by position in the schedule. */
export function roundShort(rounds: Round[], round: Round): string {
  return `R${rounds.indexOf(round) + 1}`;
}

/** The part of a round's name after the dash: "Coral Canyon", "The Qualifier". */
export function roundNickname(round: Round): string {
  return round.name.split('—')[1]?.trim() ?? round.name;
}

export function statusLabel(status: RoundStatus): string {
  return status === 'live' ? 'Live' : status === 'final' ? 'Final' : 'Upcoming';
}

/** Rounds shown on the Leaderboard: everything started, plus the next one up. */
export function leaderboardRounds(rounds: Round[]): Round[] {
  const started = rounds.filter((r) => r.status !== 'upcoming');
  if (!started.length) return rounds.slice(0, 1);
  const lastStarted = rounds.indexOf(started[started.length - 1]);
  const next = rounds.slice(lastStarted + 1).find((r) => r.status === 'upcoming');
  return next ? [...started, next] : started;
}

/** Where the Leaderboard lands by default: the live round, else the latest started. */
export function defaultLeaderboardRound(rounds: Round[]): Round | undefined {
  const live = liveRound(rounds);
  if (live) return live;
  const started = rounds.filter((r) => r.status !== 'upcoming');
  return started[started.length - 1] ?? rounds[0];
}
