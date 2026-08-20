// Offline score queue. Every score edit lands here first (localStorage), then
// flushes to POST /api/scores/batch whenever the network cooperates. Entries
// carry updatedAt so replays are last-write-wins on the server.
import { api } from './client';

export interface ScoreInput {
  roundId: string;
  entityType: 'player' | 'side';
  entityId: string;
  hole: number;
  strokes: number | null;
  updatedAt: number;
}

const QUEUE_KEY = 'yob.scoreQueue.v1';
const CHANGED_EVENT = 'yob-queue-changed';

function keyOf(e: ScoreInput): string {
  return `${e.roundId}|${e.entityType}|${e.entityId}|${e.hole}`;
}

function read(): Record<string, ScoreInput> {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(queue: Record<string, ScoreInput>): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function enqueueScores(entries: ScoreInput[]): void {
  const queue = read();
  for (const entry of entries) queue[keyOf(entry)] = entry;
  write(queue);
}

export function pendingScores(): ScoreInput[] {
  return Object.values(read());
}

export function pendingCount(): number {
  return Object.keys(read()).length;
}

export function onQueueChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
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
    await api('/api/scores/batch', { method: 'POST', body: JSON.stringify({ scores: entries }) });
    // Only remove entries that weren't re-edited while the request was in flight.
    const queue = read();
    for (const entry of entries) {
      const key = keyOf(entry);
      if (queue[key] && queue[key].updatedAt <= entry.updatedAt) delete queue[key];
    }
    write(queue);
    return Object.keys(queue).length === 0;
  } catch {
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
