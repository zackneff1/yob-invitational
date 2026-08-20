import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { enqueueScores, flushQueue, pendingScores } from '../api/queue';
import { Trip } from '../api/types';
import { useAuth } from '../auth';
import { useScores, useTrip } from '../hooks';

interface Column {
  entityType: 'player' | 'side';
  entityId: string;
  label: string;
}

interface Group {
  id: string;
  label: string;
  columns: Column[];
}

/** Build the score-entry groups for a round: tee-time groups for the
 *  qualifier, one group per match for Ryder Cup rounds. */
function buildGroups(trip: Trip, roundId: string): Group[] {
  const round = trip.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const nameOf = (id: string) => trip.players.find((p) => p.id === id)?.name ?? id;

  if (round.format === 'bestball-qualifier') {
    const pairings = trip.pairings.filter((p) => p.roundId === roundId);
    const byTime = new Map<string, typeof pairings>();
    for (const p of pairings) {
      const key = p.teeTime ?? 'Unassigned';
      byTime.set(key, [...(byTime.get(key) ?? []), p]);
    }
    return [...byTime.entries()].map(([teeTime, group]) => ({
      id: `tee-${teeTime}`,
      label: `${teeTime} — ${group.map((g) => g.name).join(' & ')}`,
      columns: group.flatMap((g) =>
        g.playerIds.map((pid) => ({
          entityType: 'player' as const,
          entityId: pid,
          label: nameOf(pid),
        })),
      ),
    }));
  }

  const matches = trip.matches.filter((m) => m.roundId === roundId);
  const teamName = (side: 'A' | 'B') => trip.ryderTeams.find((t) => t.id === side)?.name ?? side;

  return matches.map((m, i) => {
    const label = `Match ${i + 1}: ${m.sideA.map(nameOf).join('/')} vs ${m.sideB.map(nameOf).join('/')}`;
    if (round.format === 'scramble') {
      return {
        id: m.id,
        label,
        columns: [
          { entityType: 'side' as const, entityId: `${m.id}:A`, label: teamName('A') },
          { entityType: 'side' as const, entityId: `${m.id}:B`, label: teamName('B') },
        ],
      };
    }
    return {
      id: m.id,
      label,
      columns: [...m.sideA, ...m.sideB].map((pid) => ({
        entityType: 'player' as const,
        entityId: pid,
        label: nameOf(pid),
      })),
    };
  });
}

export function ScoreEntryPage() {
  const { auth } = useAuth();
  const trip = useTrip();
  const queryClient = useQueryClient();
  const [roundId, setRoundId] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');
  // Session-local edits, keyed entityType|entityId|hole — shown immediately,
  // synced through the offline queue.
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rounds = trip.data?.rounds ?? [];
  const activeRoundId = roundId || rounds[0]?.id || '';
  const scores = useScores(activeRoundId || undefined);
  const round = rounds.find((r) => r.id === activeRoundId);
  const course = trip.data?.courses.find((c) => c.id === round?.courseId);

  const groups = useMemo(
    () => (trip.data && activeRoundId ? buildGroups(trip.data, activeRoundId) : []),
    [trip.data, activeRoundId],
  );

  // Default to the group the signed-in player is in.
  useEffect(() => {
    if (!groups.length) return;
    if (groups.some((g) => g.id === groupId)) return;
    const mine = groups.find((g) =>
      g.columns.some(
        (c) =>
          (c.entityType === 'player' && c.entityId === auth?.player.id) || c.entityType === 'side',
      ),
    );
    setGroupId((mine ?? groups[0]).id);
  }, [groups, groupId, auth?.player.id]);

  const group = groups.find((g) => g.id === groupId);

  const valueFor = (col: Column, hole: number): number | '' => {
    const key = `${col.entityType}|${col.entityId}|${hole}`;
    if (key in local) return local[key] ?? '';
    const queued = pendingScores().find(
      (q) =>
        q.roundId === activeRoundId &&
        q.entityType === col.entityType &&
        q.entityId === col.entityId &&
        q.hole === hole,
    );
    if (queued) return queued.strokes ?? '';
    const server = scores.data?.find(
      (s) => s.entityType === col.entityType && s.entityId === col.entityId && s.hole === hole,
    );
    return server?.strokes ?? '';
  };

  const setScore = (col: Column, hole: number, raw: string) => {
    const strokes = raw === '' ? null : Math.max(1, Math.min(20, Number(raw)));
    if (raw !== '' && Number.isNaN(strokes)) return;
    const key = `${col.entityType}|${col.entityId}|${hole}`;
    setLocal((prev) => ({ ...prev, [key]: strokes }));
    enqueueScores([
      {
        roundId: activeRoundId,
        entityType: col.entityType,
        entityId: col.entityId,
        hole,
        strokes,
        updatedAt: Date.now(),
      },
    ]);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      void flushQueue().then((emptied) => {
        if (emptied) {
          void queryClient.invalidateQueries({ queryKey: ['scores'] });
          void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
          void queryClient.invalidateQueries({ queryKey: ['ryder'] });
        }
      });
    }, 1500);
  };

  if (trip.isLoading) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      <h1>Enter Scores</h1>
      <div className="chip-row">
        {rounds.map((r, i) => (
          <button
            key={r.id}
            className={`chip ${r.id === activeRoundId ? 'active' : ''}`}
            onClick={() => {
              setRoundId(r.id);
              setGroupId('');
              setLocal({});
            }}
          >
            R{i + 1}
          </button>
        ))}
      </div>
      <p className="muted">
        {round?.name} · {round?.formatLabel}
      </p>

      {groups.length === 0 && (
        <p className="muted">
          No groups yet for this round — pairings/matches get set up by the admins first.
        </p>
      )}

      {groups.length > 1 && (
        <select className="group-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      )}

      {group && course && (
        <div className="score-grid-wrap">
          <table className="score-grid">
            <thead>
              <tr>
                <th>Hole</th>
                <th>Par</th>
                {group.columns.map((c) => (
                  <th key={c.entityId}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {course.holes.map((hole) => (
                <tr key={hole.number}>
                  <td>
                    <strong>{hole.number}</strong>
                    <span className="muted small"> si{hole.strokeIndex}</span>
                  </td>
                  <td>{hole.par}</td>
                  {group.columns.map((c) => (
                    <td key={c.entityId}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={20}
                        value={valueFor(c, hole.number)}
                        onChange={(e) => setScore(c, hole.number, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="totals-row">
                <td colSpan={2}>
                  <strong>Total</strong>
                </td>
                {group.columns.map((c) => {
                  const total = course.holes.reduce((sum, h) => {
                    const v = valueFor(c, h.number);
                    return sum + (typeof v === 'number' ? v : 0);
                  }, 0);
                  return (
                    <td key={c.entityId}>
                      <strong>{total || '—'}</strong>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Scores save on your phone instantly and sync when there’s signal — the “unsynced” badge up
        top shows anything still waiting. Enter gross strokes; handicaps are applied automatically.
      </p>
    </div>
  );
}
