import { logger } from '../logger';
import { loadDb } from '../store/loadDb';
import { prisma } from '../store/prisma';
import { computeMatch } from './leaderboard';

/**
 * Keep each match's `closedAt` in step with its computed result.
 *
 * A match "closes" the first time the scoring says it is final — closed out
 * early (3&2), all holes played, or an admin override. The timestamp is what
 * the phones compare against to pop a "match closed" alert for everyone, so it
 * has to be set exactly once, from the server, rather than guessed at by each
 * client from whatever scores it happens to have.
 *
 * If a score correction re-opens a match (someone fixes a hole and it's no
 * longer final), the stamp is cleared so the eventual real close alerts again.
 * Admin overrides never un-close.
 *
 * Called after every score batch and result override, for the rounds touched.
 */
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
      if (computed.final && match.closedAt == null) {
        updates.push(prisma.match.update({ where: { id: match.id }, data: { closedAt: now } }));
        logger.info({ matchId: match.id, roundId, status: computed.statusText }, 'match closed');
      } else if (!computed.final && match.closedAt != null && !computed.overridden) {
        updates.push(prisma.match.update({ where: { id: match.id }, data: { closedAt: null } }));
        logger.info({ matchId: match.id, roundId }, 'match re-opened by a score change');
      }
    }
  }
  await Promise.all(updates);
}
