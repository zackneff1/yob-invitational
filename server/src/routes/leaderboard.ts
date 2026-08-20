import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { computeMatch, qualifierLeaderboard, ryderBoard } from '../services/leaderboard';
import { getDb } from '../store/db';

export const leaderboardRouter = Router();

leaderboardRouter.get('/ryder', requireAuth, (_req, res) => {
  res.json(ryderBoard(getDb()));
});

leaderboardRouter.get('/round/:roundId', requireAuth, (req, res) => {
  const db = getDb();
  const round = db.rounds.find((r) => r.id === req.params.roundId);
  if (!round) throw new HttpError(404, 'Round not found');
  if (round.format === 'bestball-qualifier') {
    res.json({ type: 'qualifier', round, rows: qualifierLeaderboard(db, round) });
    return;
  }
  const matches = db.matches
    .filter((m) => m.roundId === round.id)
    .map((m) => computeMatch(db, round, m));
  res.json({ type: 'matches', round, matches });
});
