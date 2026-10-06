import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { syncMatchClosures } from '../services/matchClosures';
import {
  BatchBodySchema,
  EntryOutcome,
  PER_ENTRY_CLIENT_VERSION,
  ScoreEntryIn,
  ScoreEntrySchema,
  actionFor,
  entryKey,
  validateEntry,
} from '../services/scoreBatch';
import { prisma } from '../store/prisma';

export const scoresRouter = Router();

scoresRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roundId = String(req.query.roundId ?? '');
    if (!roundId) throw new HttpError(400, 'roundId is required');
    const scores = await prisma.score.findMany({ where: { roundId } });
    // Pickups come back with strokes: null. A phone on the previous build reads
    // that as "nothing entered" (unresolved), which is the safe reading.
    res.json(
      scores.map((s) => ({
        ...s,
        strokes: s.strokes ?? null,
        pickup: s.pickup,
        updatedAt: s.updatedAt.getTime(),
      })),
    );
  }),
);

/**
 * Idempotent batch upsert — the offline queue on the client replays through
 * here. Last write wins by updatedAt, so a stale offline entry never
 * clobbers a newer edit made from another phone.
 *
 * Request shape is unchanged from the first release (`{ scores: [...] }`);
 * `clientVersion` and per-entry `pickup` are additive. See scoreBatch.ts for
 * the two validation modes.
 */
scoresRouter.post(
  '/batch',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = BatchBodySchema.parse(req.body);
    const perEntry = (body.clientVersion ?? 1) >= PER_ENTRY_CLIENT_VERSION;
    const roundIds = new Set(
      (await prisma.round.findMany({ select: { id: true } })).map((r) => r.id),
    );
    const now = Date.now();

    // Classify first, write second.
    const outcomes: EntryOutcome[] = [];
    const toWrite: { entry: ScoreEntryIn; clockAdjusted: boolean }[] = [];
    if (perEntry) {
      for (const raw of body.scores) {
        const v = validateEntry(raw, roundIds, now);
        if (!v.ok) {
          outcomes.push({ key: v.key ?? `invalid:${outcomes.length}`, status: 'rejected', reason: v.reason });
          continue;
        }
        toWrite.push(v);
      }
    } else {
      // Legacy contract: the whole batch must parse, unknown rounds are skipped.
      const legacy = z.array(ScoreEntrySchema).parse(body.scores);
      for (const entry of legacy) {
        if (!roundIds.has(entry.roundId)) continue;
        toWrite.push({ entry, clockAdjusted: false });
      }
    }

    let applied = 0;
    await prisma.$transaction(async (tx) => {
      for (const { entry, clockAdjusted } of toWrite) {
        const key = {
          roundId: entry.roundId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          hole: entry.hole,
        };
        const updatedAt = new Date(entry.updatedAt);
        const action = actionFor(entry);
        if (action.kind === 'delete') {
          const deleted = await tx.score.deleteMany({
            where: { ...key, updatedAt: { lte: updatedAt } },
          });
          applied += deleted.count;
          // A delete that found nothing newer is still "done" from the phone's
          // point of view; one that lost to a newer edit is superseded.
          const existing = deleted.count === 0 ? await tx.score.findUnique({ where: { roundId_entityType_entityId_hole: key } }) : null;
          outcomes.push({
            key: entryKey(entry),
            status: existing && existing.updatedAt > updatedAt ? 'superseded' : 'accepted',
            clockAdjusted: clockAdjusted || undefined,
          });
          continue;
        }
        const existing = await tx.score.findUnique({
          where: { roundId_entityType_entityId_hole: key },
        });
        if (existing && existing.updatedAt > updatedAt) {
          outcomes.push({ key: entryKey(entry), status: 'superseded', clockAdjusted: clockAdjusted || undefined });
          continue; // newer edit already stored
        }
        await tx.score.upsert({
          where: { roundId_entityType_entityId_hole: key },
          update: { strokes: action.strokes, pickup: action.pickup, updatedAt, updatedBy: req.user!.id },
          create: { ...key, strokes: action.strokes, pickup: action.pickup, updatedAt, updatedBy: req.user!.id },
        });
        applied += 1;
        outcomes.push({ key: entryKey(entry), status: 'accepted', clockAdjusted: clockAdjusted || undefined });
      }
    });

    // Stamp any match these scores just finished (or re-opened). Done after the
    // write, and the response doesn't wait on it — a failure here must never
    // make a phone think its scores didn't land.
    const touched = toWrite.map((w) => w.entry.roundId);
    void syncMatchClosures(touched).catch((err) =>
      req.log.error({ err }, 'failed to sync match closures'),
    );

    // `ok` and `applied` are the original response; `results` is additive and
    // only meaningful to per-entry clients.
    res.json({ ok: true, applied, results: perEntry ? outcomes : undefined });
  }),
);
