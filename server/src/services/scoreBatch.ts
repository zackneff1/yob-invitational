import { z } from 'zod';

/**
 * Validation and classification for POST /api/scores/batch, kept free of the
 * database so it can be tested directly.
 *
 * Two client generations talk to this endpoint:
 *
 *  - Legacy (no `clientVersion` in the body): the original all-or-nothing
 *    contract. Any invalid entry fails the whole request with 400; unknown
 *    round ids are skipped. Unchanged, so phones still running the old build
 *    replay their queues exactly as before.
 *
 *  - Per-entry (`clientVersion` ≥ 2): every entry gets its own outcome in the
 *    response so one bad draft can never block the good ones behind it, and
 *    the phone can show the person *why* something was refused instead of
 *    retrying it forever.
 */

export const PER_ENTRY_CLIENT_VERSION = 2;

/** How far ahead of the server a phone's clock may be before we distrust it. */
export const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

export const ScoreEntrySchema = z.object({
  roundId: z.string().min(1),
  entityType: z.enum(['player', 'side']),
  entityId: z.string().min(1),
  hole: z.number().int().min(1).max(18),
  /** Gross strokes; null clears the score (or, with pickup, records a no-return). */
  strokes: z.number().int().min(1).max(20).nullable(),
  /** Explicit pickup / no return on this hole. */
  pickup: z.boolean().optional().default(false),
  updatedAt: z.number().finite(),
});

export type ScoreEntryIn = z.infer<typeof ScoreEntrySchema>;

export const BatchBodySchema = z.object({
  scores: z.array(z.unknown()).min(1).max(500),
  clientVersion: z.number().int().optional(),
});

export type EntryStatus = 'accepted' | 'superseded' | 'rejected';

export interface EntryOutcome {
  /** `${roundId}|${entityType}|${entityId}|${hole}` — the queue's own key. */
  key: string;
  status: EntryStatus;
  reason?: string;
  /** The phone's clock was ahead of the server; the stamp was pulled back. */
  clockAdjusted?: boolean;
}

export function entryKey(e: Pick<ScoreEntryIn, 'roundId' | 'entityType' | 'entityId' | 'hole'>): string {
  return `${e.roundId}|${e.entityType}|${e.entityId}|${e.hole}`;
}

export type Validated =
  | { ok: true; entry: ScoreEntryIn; clockAdjusted: boolean }
  | { ok: false; key: string | null; reason: string };

/**
 * Validate one raw entry. Pure.
 *
 * Rules beyond the shape: a pickup carries no strokes; a scramble side cannot
 * pick up (the team must return a score or an admin records the result);
 * the round must exist; a timestamp from the future is pulled back to `now`
 * so a phone with a fast clock cannot make its edits un-overwritable.
 */
export function validateEntry(raw: unknown, knownRounds: Set<string>, now: number): Validated {
  const parsed = ScoreEntrySchema.safeParse(raw);
  if (!parsed.success) {
    const maybe = raw as Partial<ScoreEntryIn> | null;
    const key =
      maybe && typeof maybe === 'object' && maybe.roundId && maybe.entityType && maybe.entityId && maybe.hole != null
        ? `${maybe.roundId}|${maybe.entityType}|${maybe.entityId}|${maybe.hole}`
        : null;
    const issue = parsed.error.issues[0];
    return { ok: false, key, reason: `${issue.path.join('.') || 'entry'}: ${issue.message}` };
  }
  const entry = parsed.data;
  const key = entryKey(entry);
  if (!knownRounds.has(entry.roundId)) return { ok: false, key, reason: 'unknown round' };
  if (entry.pickup && entry.strokes != null) return { ok: false, key, reason: 'a pickup cannot carry a stroke count' };
  if (entry.pickup && entry.entityType === 'side') {
    return { ok: false, key, reason: 'a scramble side must return a team score (admins can record a result)' };
  }
  let clockAdjusted = false;
  if (entry.updatedAt > now + MAX_CLOCK_SKEW_MS) {
    entry.updatedAt = now;
    clockAdjusted = true;
  }
  return { ok: true, entry, clockAdjusted };
}

/** What a validated entry means for storage. */
export type EntryAction =
  | { kind: 'delete' }
  | { kind: 'upsert'; strokes: number | null; pickup: boolean };

export function actionFor(entry: ScoreEntryIn): EntryAction {
  if (entry.pickup) return { kind: 'upsert', strokes: null, pickup: true };
  if (entry.strokes == null) return { kind: 'delete' };
  return { kind: 'upsert', strokes: entry.strokes, pickup: false };
}
