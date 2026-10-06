/**
 * "Match closed" alerts for everyone.
 *
 * The server stamps a match's `closedAt` the first time it is final. Every
 * phone polls the Cup board anyway; this compares each match's stamp against
 * the newest one this phone has already shown (kept in localStorage) and pops
 * a banner for anything newer. First run on a phone just records "now" so
 * nobody gets a flood of history when they first open the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Round, RyderBoard } from './api/types';
import { matchSentence, stateFromComputed } from './matchState';
import { showDeviceNotification } from './notify';
import { roundShort } from './rounds';

const KEY = 'yob.alerts.v1';
const SHOW_FOR_MS = 30_000;

export interface MatchAlert {
  id: string;
  title: string;
  body: string;
  color?: string;
  shownAt: number;
}

function readSeen(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number((JSON.parse(raw) as { seenAt?: unknown }).seenAt);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSeen(seenAt: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ seenAt }));
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
      r.matches.filter((m) => m.closedAt != null).map((m) => ({ m, roundId: r.roundId })),
    );
    const newest = closed.reduce((max, c) => Math.max(max, c.m.closedAt ?? 0), 0);
    const seen = readSeen();
    if (seen == null) {
      writeSeen(Math.max(Date.now(), newest));
      return;
    }
    const fresh = closed
      .filter((c) => (c.m.closedAt ?? 0) > seen)
      .sort((x, y) => (x.m.closedAt ?? 0) - (y.m.closedAt ?? 0));
    if (!fresh.length) return;
    writeSeen(newest);

    const allRounds = roundsRef.current;
    const next: MatchAlert[] = fresh.map(({ m, roundId }) => {
      const round = allRounds.find((r) => r.id === roundId);
      const names = { A: m.sideA.teamName, B: m.sideB.teamName };
      const who = `${m.sideA.players.map((p) => p.name).join(' & ')} vs ${m.sideB.players
        .map((p) => p.name)
        .join(' & ')}`;
      return {
        id: m.id,
        title: `Match closed${round ? ` · ${roundShort(allRounds, round)}` : ''}`,
        body: `${matchSentence(stateFromComputed(m), names)} — ${who}`,
        color: m.leader ? (m.leader === 'A' ? m.sideA.color : m.sideB.color) : undefined,
        shownAt: Date.now(),
      };
    });
    setAlerts((prev) => [...prev.filter((a) => !next.some((n) => n.id === a.id)), ...next]);
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
