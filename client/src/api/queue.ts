// Offline score queue. Every score edit lands here first (localStorage), then
// flushes to POST /api/scores/batch whenever the network cooperates. Entries
// carry updatedAt so replays are last-write-wins on the server.
//
// The server answers each entry individually (accepted / superseded /
// rejected). Rejected entries move to a separate "rejected drafts" store with
// the server's reason, so one bad entry can never block the rest and the
// person can see what was refused instead of a badge that never clears.
import { ApiError, api } from './client';
import { CLIENT_VERSION } from '../version';

export interface ScoreInput {
  roundId: string;
  entityType: 'player' | 'side';
  entityId: string;
  hole: number;
  /** Gross strokes; null clears the score (or, with pickup, records a no-return). */
  strokes: number | null;
  /** Explicit pickup / no return on the hole. */
  pickup?: boolean;
  updatedAt: number;
}

export interface RejectedDraft extends ScoreInput {
  reason: string;
  rejectedAt: number;
}

interface BatchResult {
  ok: boolean;
  applied: number;
  results?: { key: string; status: 'accepted' | 'superseded' | 'rejected'; reason?: string }[];
}

const QUEUE_KEY = 'yob.scoreQueue.v1';
const REJECTED_KEY = 'yob.scoreRejected.v1';
const CHANGED_EVENT = 'yob-queue-changed';
/** Fired after a batch of scores has actually reached the server. */
const SYNCED_EVENT = 'yob-scores-synced';

export function onScoresSynced(listener: () => void): () => void {
  window.addEventListener(SYNCED_EVENT, listener);
  return () => window.removeEventListener(SYNCED_EVENT, listener);
}

export function keyOf(e: Pick<ScoreInput, 'roundId' | 'entityType' | 'entityId' | 'hole'>): string {
  return `${e.roundId}|${e.entityType}|${e.entityId}|${e.hole}`;
}

function readStore<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore<T>(key: string, value: Record<string, T>): void {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

const read = () => readStore<ScoreInput>(QUEUE_KEY);
const write = (q: Record<string, ScoreInput>) => writeStore(QUEUE_KEY, q);

export function enqueueScores(entries: ScoreInput[]): void {
  const queue = read();
  const rejected = readStore<RejectedDraft>(REJECTED_KEY);
  let rejectedChanged = false;
  for (const entry of entries) {
    const key = keyOf(entry);
    queue[key] = entry;
    // A fresh edit of a cell replaces its rejected draft.
    if (rejected[key]) {
      delete rejected[key];
      rejectedChanged = true;
    }
  }
  if (rejectedChanged) writeStore(REJECTED_KEY, rejected);
  write(queue);
}

export function pendingScores(): ScoreInput[] {
  return Object.values(read());
}

export function pendingCount(): number {
  return Object.keys(read()).length;
}

// useSyncExternalStore needs a snapshot that is referentially stable while the
// store is unchanged, or React re-renders forever (error #185). Cache the
// parsed list against the raw stored string.
let rejectedCacheRaw: string | null | undefined;
let rejectedCacheValue: RejectedDraft[] = [];

export function rejectedDrafts(): RejectedDraft[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(REJECTED_KEY);
  } catch {
    raw = null;
  }
  if (raw !== rejectedCacheRaw) {
    rejectedCacheRaw = raw;
    rejectedCacheValue = Object.values(readStore<RejectedDraft>(REJECTED_KEY)).sort(
      (a, b) => b.rejectedAt - a.rejectedAt,
    );
  }
  return rejectedCacheValue;
}

export function rejectedCount(): number {
  return Object.keys(readStore<RejectedDraft>(REJECTED_KEY)).length;
}

export function discardRejected(key: string): void {
  const rejected = readStore<RejectedDraft>(REJECTED_KEY);
  delete rejected[key];
  writeStore(REJECTED_KEY, rejected);
}

export function onQueueChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

function moveToRejected(entries: ScoreInput[], reasonFor: (key: string) => string): void {
  const rejected = readStore<RejectedDraft>(REJECTED_KEY);
  const queue = read();
  for (const entry of entries) {
    const key = keyOf(entry);
    rejected[key] = { ...entry, reason: reasonFor(key), rejectedAt: Date.now() };
    // Only drop the queued copy if it is still the one we sent.
    if (queue[key] && queue[key].updatedAt <= entry.updatedAt) delete queue[key];
  }
  writeStore(REJECTED_KEY, rejected);
  write(queue);
}

let flushing = false;

/** Push pending scores to the server. Returns true if the queue is empty after. */
export async function flushQueue(): Promise<boolean> {
  if (flushing) return false;
  const entries = pendingScores();
  if (!entries.length) return true;
  if (!navigator.onLine) return false;
  flushing = true;
  try {
    const result = await api<BatchResult>('/api/scores/batch', {
      method: 'POST',
      body: JSON.stringify({ scores: entries, clientVersion: CLIENT_VERSION }),
    });
    const outcomes = new Map((result.results ?? []).map((r) => [r.key, r]));
    const accepted: ScoreInput[] = [];
    const rejected: ScoreInput[] = [];
    for (const entry of entries) {
      const o = outcomes.get(keyOf(entry));
      // No per-entry answer (older server): the whole batch was accepted.
      if (!o || o.status !== 'rejected') accepted.push(entry);
      else rejected.push(entry);
    }
    // Only remove entries that weren't re-edited while the request was in flight.
    const queue = read();
    for (const entry of accepted) {
      const key = keyOf(entry);
      if (queue[key] && queue[key].updatedAt <= entry.updatedAt) delete queue[key];
    }
    write(queue);
    if (rejected.length) {
      moveToRejected(rejected, (key) => outcomes.get(key)?.reason ?? 'rejected by the server');
    }
    // Whoever is listening (the app shell) refetches leaderboards now.
    window.dispatchEvent(new Event(SYNCED_EVENT));
    return Object.keys(read()).length === 0;
  } catch (err) {
    // A 4xx on the whole request means the batch itself is malformed, which a
    // per-entry server only does for a corrupt queue: park everything with the
    // reason rather than retry forever. Network errors and 5xx stay queued.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401) {
      moveToRejected(entries, () => err.message);
    }
    return false;
  } finally {
    flushing = false;
  }
}

let started = false;

/** Background flushing: on reconnect, on tab focus, and every 20s. */
export function startQueueSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void flushQueue());
  window.addEventListener('focus', () => void flushQueue());
  setInterval(() => void flushQueue(), 20_000);
  void flushQueue();
}
