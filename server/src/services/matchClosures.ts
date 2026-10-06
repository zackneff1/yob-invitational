import { logger } from '../logger';
import { loadDb } from '../store/loadDb';
import { prisma } from '../store/prisma';
import { computeMatch } from './leaderboard';

/**
 * Keep each match's (closedAt, resultKey) in step with its *confirmed* result.
 *
 * A match closes when the scoring says it is final on fully resolved holes —
 * closed out early, all holes in, or an admin override. Provisional readings
 * (a partner's score still missing) never close a match, so a half-synced
 * four-ball cannot announce a winner.
 *
 * The stamp carries the identity of the result it refers to. If a correction
 * changes a final result to a different final result (a different winner or
 * margin), the stamp is refreshed so everyone is told again; if the result is
 * unchanged nothing happens, so a routine sync never repeats an alert. If a
 * correction re-opens the match, both are cleared and the eventual real close
 * alerts afresh. Admin overrides are results like any other.
 *
 * Called after every score batch and result override, for the rounds touched.
 */
export type ClosureChange = 'stamp' | 'clear' | 'none';

/**
 * What the stored (closedAt, resultKey) needs given the computed match.
 * Pure, so the rules above can be tested without a database.
 */
export function closureChange(
  stored: { closedAt: number | null; resultKey: string | null },
  computed: { final: boolean; resultKey: string | null },
): ClosureChange {
  if (computed.final && computed.resultKey) {
    return stored.resultKey !== computed.resultKey || stored.closedAt == null ? 'stamp' : 'none';
  }
  return stored.closedAt != null || stored.resultKey != null ? 'clear' : 'none';
}

export async function syncMatchClosures(roundIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(roundIds)];
  if (!ids.length) return;
  const db = await loadDb();
  const now = new Date();
  const updates: Promise<unknown>[] = [];
  for (const roundId of ids) {
    const round = db.rounds.find((r) => r.id === roundId);
    if (!round || round.matchCount === 0) continue;
    for (const match of db.matches.filter((m) => m.roundId === roundId)) {
      const computed = computeMatch(db, round, match);
      const change = closureChange(match, computed);
      if (change === 'stamp') {
        updates.push(
          prisma.match.update({
            where: { id: match.id },
            data: { closedAt: now, resultKey: computed.resultKey },
          }),
        );
        logger.info(
          { matchId: match.id, roundId, from: match.resultKey, to: computed.resultKey },
          match.resultKey ? 'match result corrected' : 'match closed',
        );
      } else if (change === 'clear') {
        updates.push(
          prisma.match.update({ where: { id: match.id }, data: { closedAt: null, resultKey: null } }),
        );
        logger.info({ matchId: match.id, roundId }, 'match re-opened by a score change');
      }
    }
  }
  await Promise.all(updates);
}
