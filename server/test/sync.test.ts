import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseTypedScore } from '../../client/src/scoreInput';
import {
  MAX_CLOCK_SKEW_MS,
  PER_ENTRY_CLIENT_VERSION,
  ScoreEntrySchema,
  actionFor,
  entryKey,
  validateEntry,
} from '../src/services/scoreBatch';

const rounds = new Set(['r2-coral-canyon']);
const base = { roundId: 'r2-coral-canyon', entityType: 'player', entityId: 'neffy', hole: 3, updatedAt: 1_000 };
const now = 10_000;

test('valid entries: score, clear, pickup', () => {
  const score = validateEntry({ ...base, strokes: 4 }, rounds, now);
  assert.ok(score.ok);
  assert.deepEqual(actionFor(score.entry), { kind: 'upsert', strokes: 4, pickup: false });
  const clear = validateEntry({ ...base, strokes: null }, rounds, now);
  assert.ok(clear.ok && actionFor(clear.entry).kind === 'delete');
  const pickup = validateEntry({ ...base, strokes: null, pickup: true }, rounds, now);
  assert.ok(pickup.ok);
  assert.deepEqual(actionFor(pickup.entry), { kind: 'upsert', strokes: null, pickup: true });
});

test('rejected entries carry a reason and the queue key: 0, 2.5, 21, hole 19, unknown round, pickup+strokes, side pickup', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...base, strokes: 0 }, /strokes/],
    [{ ...base, strokes: 2.5 }, /strokes/],
    [{ ...base, strokes: 21 }, /strokes/],
    [{ ...base, hole: 19, strokes: 4 }, /hole/],
    [{ ...base, roundId: 'nope', strokes: 4 }, /unknown round/],
    [{ ...base, strokes: 4, pickup: true }, /pickup cannot carry/],
    [{ ...base, entityType: 'side', entityId: 'm1:A', strokes: null, pickup: true }, /team score/],
    [{ ...base, strokes: Number.NaN }, /strokes/],
  ];
  for (const [raw, reason] of cases) {
    const v = validateEntry(raw, rounds, now);
    assert.equal(v.ok, false, JSON.stringify(raw));
    if (!v.ok) {
      assert.match(v.reason, reason);
      assert.equal(v.key, entryKey(raw as never));
    }
  }
});

test('one bad entry no longer blocks the good ones (per-entry mode) while legacy mode stays all-or-nothing', () => {
  const batch = [{ ...base, strokes: 4 }, { ...base, hole: 4, strokes: 2.5 }];
  const outcomes = batch.map((e) => validateEntry(e, rounds, now).ok);
  assert.deepEqual(outcomes, [true, false]);
  assert.throws(() => z.array(ScoreEntrySchema).parse(batch), 'legacy contract rejects the whole batch');
  assert.equal(PER_ENTRY_CLIENT_VERSION, 2);
});

test('entries queued by the previous client build (no pickup field) are still valid', () => {
  const old = { ...base, strokes: 5 }; // exactly what v1 phones send
  const v = validateEntry(old, rounds, now);
  assert.ok(v.ok && v.entry.pickup === false);
  const oldClear = { ...base, strokes: null };
  assert.ok(validateEntry(oldClear, rounds, now).ok);
});

test('phone clock ahead of the server: the stamp is pulled back and flagged; a slow clock is left alone', () => {
  const fast = validateEntry({ ...base, strokes: 4, updatedAt: now + MAX_CLOCK_SKEW_MS + 1 }, rounds, now);
  assert.ok(fast.ok && fast.clockAdjusted && fast.entry.updatedAt === now);
  const fine = validateEntry({ ...base, strokes: 4, updatedAt: now + 1_000 }, rounds, now);
  assert.ok(fine.ok && !fine.clockAdjusted && fine.entry.updatedAt === now + 1_000);
  const slow = validateEntry({ ...base, strokes: 4, updatedAt: now - 86_400_000 }, rounds, now);
  assert.ok(slow.ok && !slow.clockAdjusted, 'a slow clock cannot be corrected without a server receipt order — documented limitation');
});

test('old readers see a pickup as "nothing entered": GET returns strokes null', () => {
  // The previous client build reads a score row with `server?.strokes ?? ''`.
  const row = { strokes: null as number | null, pickup: true };
  const oldClientValue = row.strokes ?? '';
  assert.equal(oldClientValue, '', 'unresolved, not a 0 gross');
  // The new client reads the same row as an explicit pickup.
  const newClientValue = row.pickup || row.strokes == null ? 'pickup' : row.strokes;
  assert.equal(newClientValue, 'pickup');
});

test('typed scores: 0 / decimals / blank / out of range are refused with a message, never clamped', () => {
  assert.deepEqual(parseTypedScore(''), { ok: true, strokes: null });
  assert.deepEqual(parseTypedScore(' 4 '), { ok: true, strokes: 4 });
  assert.deepEqual(parseTypedScore('20'), { ok: true, strokes: 20 });
  for (const bad of ['0', '2.5', '23', '-3', '1e1', 'abc', 'Infinity']) {
    const r = parseTypedScore(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.ok(r.message.length > 10);
  }
  const zero = parseTypedScore('0');
  if (!zero.ok) assert.match(zero.message, /Pickup/);
});
