/**
 * "I'm out on the course right now" state: which hole you're on in a round
 * you've started. Deliberately local to the phone rather than on the server —
 * it's this player's place in the round, not trip data, and it has to work
 * with no signal. Survives closing the app so you come back to the same hole.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'yob.play.v1';

export interface PlaySession {
  /** 1-based hole number the player is currently on. */
  hole: number;
  startedAt: number;
}

type Sessions = Record<string, PlaySession>;

function read(): Sessions {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Sessions) : {};
  } catch {
    return {};
  }
}

function write(sessions: Sessions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* private mode / full disk — the round still plays, it just won't resume */
  }
}

/**
 * The round this phone is currently playing (most recently started), so
 * reopening the app mid-round comes back to it rather than to Round 1.
 */
export function activeSessionRoundId(): string {
  const sessions = read();
  const ids = Object.keys(sessions);
  if (ids.length === 0) return '';
  return ids.sort((a, b) => sessions[b].startedAt - sessions[a].startedAt)[0];
}

export function usePlaySession(roundId: string, holeCount: number) {
  const [sessions, setSessions] = useState<Sessions>(read);

  useEffect(() => write(sessions), [sessions]);

  const session = roundId ? (sessions[roundId] ?? null) : null;

  const start = useCallback(() => {
    if (!roundId) return;
    setSessions((prev) => ({ ...prev, [roundId]: { hole: 1, startedAt: Date.now() } }));
  }, [roundId]);

  const end = useCallback(() => {
    if (!roundId) return;
    setSessions((prev) => {
      const next = { ...prev };
      delete next[roundId];
      return next;
    });
  }, [roundId]);

  const goToHole = useCallback(
    (hole: number) => {
      if (!roundId) return;
      const clamped = Math.max(1, Math.min(holeCount, hole));
      setSessions((prev) =>
        prev[roundId] ? { ...prev, [roundId]: { ...prev[roundId], hole: clamped } } : prev,
      );
    },
    [roundId, holeCount],
  );

  return { session, start, end, goToHole };
}
