/**
 * "Match closed" alerts for everyone.
 *
 * The server stamps a match's `closedAt` when its *confirmed* result is
 * established, and stamps it again if a correction changes a final result to
 * a different final result. Every phone polls the Cup board anyway; this
 * compares each match's stamp against the newest one this phone has already
 * shown (kept in localStorage) and pops a banner for anything newer. First
 * run on a phone just records "now" so nobody gets a flood of history when
 * they first open the app.
 *
 * Idempotent by construction: the identity of an alert is (match, closedAt),
 * so a routine poll that returns the same stamp never repeats it, and a
 * corrected final gets a fresh stamp — and a "Result corrected" title.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Round, RyderBoard } from './api/types';
import { matchSentence, stateFromComputed } from './matchState';
import { showDeviceNotification } from './notify';
import { roundShort } from './rounds';

const KEY = 'yob.alerts.v2';
const SHOW_FOR_MS = 30_000;

export interface MatchAlert {
  /** `${matchId}:${closedAt}` */
  id: string;
  matchId: string;
  title: string;
  body: string;
  color?: string;
  shownAt: number;
}

interface Seen {
  seenAt: number;
  /** Last closedAt alerted per match, to tell a correction from a first close. */
  alerted: Record<string, number>;
}

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Seen>;
    const seenAt = Number(parsed.seenAt);
    if (!Number.isFinite(seenAt)) return null;
    return { seenAt, alerted: parsed.alerted ?? {} };
  } catch {
    return null;
  }
}

function writeSeen(seen: Seen): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* private mode — alerts just repeat next open */
  }
}

export function useMatchAlerts(board: RyderBoard | undefined, rounds: Round[] | undefined) {
  const [alerts, setAlerts] = useState<MatchAlert[]>([]);
  // Rounds are only used for labels; keep them out of the effect deps so a
  // fresh array each render doesn't re-run the comparison.
  const roundsRef = useRef<Round[]>([]);
  roundsRef.current = rounds ?? [];

  useEffect(() => {
    if (!board) return;
    const closed = board.rounds.flatMap((r) =>
      r.matches.filter((m) => m.closedAt != null && m.final).map((m) => ({ m, roundId: r.roundId })),
    );
    const newest = closed.reduce((max, c) => Math.max(max, c.m.closedAt ?? 0), 0);
    const seen = readSeen();
    if (seen == null) {
      writeSeen({
        seenAt: Math.max(Date.now(), newest),
        alerted: Object.fromEntries(closed.map((c) => [c.m.id, c.m.closedAt ?? 0])),
      });
      return;
    }
    const fresh = closed
      .filter((c) => (c.m.closedAt ?? 0) > seen.seenAt)
      .sort((x, y) => (x.m.closedAt ?? 0) - (y.m.closedAt ?? 0));
    if (!fresh.length) return;

    const allRounds = roundsRef.current;
    const next: MatchAlert[] = fresh.map(({ m, roundId }) => {
      const round = allRounds.find((r) => r.id === roundId);
      const names = { A: m.sideA.teamName, B: m.sideB.teamName };
      const who = `${m.sideA.players.map((p) => p.name).join(' & ')} vs ${m.sideB.players
        .map((p) => p.name)
        .join(' & ')}`;
      const corrected = seen.alerted[m.id] != null && seen.alerted[m.id] < (m.closedAt ?? 0);
      return {
        id: `${m.id}:${m.closedAt}`,
        matchId: m.id,
        title: `${corrected ? 'Result corrected' : 'Match closed'}${round ? ` · ${roundShort(allRounds, round)}` : ''}`,
        body: `${matchSentence(stateFromComputed(m), names)} — ${who}`,
        color: m.leader ? (m.leader === 'A' ? m.sideA.color : m.sideB.color) : undefined,
        shownAt: Date.now(),
      };
    });
    writeSeen({
      seenAt: newest,
      alerted: { ...seen.alerted, ...Object.fromEntries(fresh.map((c) => [c.m.id, c.m.closedAt ?? 0])) },
    });
    setAlerts((prev) => [...prev.filter((a) => !next.some((n) => n.matchId === a.matchId)), ...next]);
    for (const a of next) void showDeviceNotification(a.title, a.body, a.id);
  }, [board]);

  // Banners fade out on their own after a while.
  useEffect(() => {
    if (!alerts.length) return;
    const t = setInterval(
      () => setAlerts((prev) => prev.filter((a) => Date.now() - a.shownAt < SHOW_FOR_MS)),
      2_000,
    );
    return () => clearInterval(t);
  }, [alerts.length]);

  const dismiss = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, dismiss };
}
