import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { getDb, saveDb } from '../store/db';
import { scoreKey } from '../services/scoring';

export const scoresRouter = Router();

scoresRouter.get('/', requireAuth, (req, res) => {
  const roundId = String(req.query.roundId ?? '');
  if (!roundId) throw new HttpError(400, 'roundId is required');
  const db = getDb();
  res.json(db.scores.filter((s) => s.roundId === roundId));
});

const ScoreEntry = z.object({
  roundId: z.string(),
  entityType: z.enum(['player', 'side']),
  entityId: z.string(),
  hole: z.number().int().min(1).max(18),
  /** null clears a previously entered score */
  strokes: z.number().int().min(1).max(20).nullable(),
  updatedAt: z.number(),
});

const BatchSchema = z.object({ scores: z.array(ScoreEntry).min(1).max(500) });

/**
 * Idempotent batch upsert — the offline queue on the client replays through
 * here. Last write wins by updatedAt, so a stale offline entry never
 * clobbers a newer edit made from another phone.
 */
scoresRouter.post('/batch', requireAuth, (req: AuthedRequest, res) => {
  const body = BatchSchema.parse(req.body);
  const db = getDb();
  let applied = 0;
  for (const entry of body.scores) {
    if (!db.rounds.some((r) => r.id === entry.roundId)) continue;
    const idx = db.scores.findIndex(
      (s) =>
        s.roundId === entry.roundId &&
        scoreKey(s.entityType, s.entityId, s.hole) ===
          scoreKey(entry.entityType, entry.entityId, entry.hole),
    );
    const existing = idx >= 0 ? db.scores[idx] : null;
    if (existing && existing.updatedAt > entry.updatedAt) continue; // newer edit already stored
    if (entry.strokes == null) {
      if (idx >= 0) {
        db.scores.splice(idx, 1);
        applied += 1;
      }
      continue;
    }
    const record = {
      roundId: entry.roundId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      hole: entry.hole,
      strokes: entry.strokes,
      updatedAt: entry.updatedAt,
      updatedBy: req.user!.id,
    };
    if (idx >= 0) db.scores[idx] = record;
    else db.scores.push(record);
    applied += 1;
  }
  saveDb();
  res.json({ ok: true, applied });
});
