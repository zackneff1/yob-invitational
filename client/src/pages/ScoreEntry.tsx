import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { enqueueScores, flushQueue, pendingScores } from '../api/queue';
import { Course, Hole, Round, Trip } from '../api/types';
import { useAuth } from '../auth';
import { useScores, useTrip } from '../hooks';
import { mountainEquivalentNote, withZone, zoneFor } from '../teeTimes';

interface Column {
  entityType: 'player' | 'side';
  entityId: string;
  label: string;
  /** Strokes this player (or scramble side) receives over the round, after the
   *  round's allowance and any play-off-the-low-man reduction. */
  effectiveHandicap: number;
}

interface Group {
  id: string;
  label: string;
  columns: Column[];
}

/**
 * Strokes received on one hole for a given handicap, allocated by stroke index.
 * Hand-mirrored from `strokesOnHole` in server/src/services/scoring.ts — the
 * client shares no module with the server, so if that math ever changes this
 * copy has to change with it. Display only; the server still does the scoring.
 */
function strokesOnHole(ph: number, strokeIndex: number, holeCount: number): number {
  if (ph === 0) return 0;
  const abs = Math.abs(ph);
  const base = Math.floor(abs / holeCount);
  const rem = abs % holeCount;
  const extra = ph > 0 ? strokeIndex <= rem : strokeIndex > holeCount - rem;
  return (base + (extra ? 1 : 0)) * Math.sign(ph);
}

/** Mirror of `stablefordPoints` on the server: par 2, birdie 3, bogey 1. */
function stablefordPoints(net: number, par: number): number {
  return Math.max(0, 2 + par - net);
}

/** Only meaningful once every hole has a yardage — a partial sum would read
 *  like a real course length and be wrong. */
function totalYardsOf(course: Course): number | null {
  return course.holes.every((h) => typeof h.yards === 'number')
    ? course.holes.reduce((sum, h) => sum + (h.yards ?? 0), 0)
    : null;
}

/** Build the score-entry groups for a round: tee-time groups for the
 *  qualifier, one group per match for Ryder Cup rounds. */
function buildGroups(trip: Trip, roundId: string): Group[] {
  const round = trip.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const nameOf = (id: string) => trip.players.find((p) => p.id === id)?.name ?? id;
  const hcpOf = (id: string) => round.courseHandicaps.find((c) => c.playerId === id);
  const playingOf = (id: string) => hcpOf(id)?.playingHandicap ?? 0;
  const courseHcpOf = (id: string) => hcpOf(id)?.courseHandicap ?? 0;

  /** Strokes each player gets, off the low man in the group passed in — the
   *  whole field for the qualifier, the match for Rounds 2-5. Mirrors
   *  handicapInfoFor on the server so these markers match the leaderboard. */
  const effectiveOf = (playerIds: string[]): Map<string, number> => {
    const phs = playerIds.map(playingOf);
    const low = phs.length > 1 ? Math.min(...phs) : 0;
    return new Map(playerIds.map((id, i) => [id, phs[i] - low]));
  };

  /** Scramble team handicap: 35% of the low course handicap + 15% of the high. */
  const teamHandicapOf = (playerIds: string[]): number => {
    const chs = playerIds.map(courseHcpOf).sort((a, b) => a - b);
    const low = chs[0] ?? 0;
    const high = chs[chs.length - 1] ?? 0;
    return Math.round(0.35 * low + 0.15 * high);
  };

  if (round.format === 'bestball-qualifier') {
    const pairings = trip.pairings.filter((p) => p.roundId === roundId);
    const byTime = new Map<string, typeof pairings>();
    for (const p of pairings) {
      const key = p.teeTime ?? 'Unassigned';
      byTime.set(key, [...(byTime.get(key) ?? []), p]);
    }
    const zone = zoneFor(trip.courses.find((c) => c.id === round.courseId));
    // Off the low man across the whole 12-man field, not each pair.
    const fieldEff = effectiveOf([...new Set(pairings.flatMap((p) => p.playerIds))]);
    return [...byTime.entries()].map(([teeTime, group]) => ({
      id: `tee-${teeTime}`,
      label: `${withZone(teeTime, zone)} — ${group.map((g) => g.name).join(' & ')}`,
      columns: group.flatMap((g) =>
        g.playerIds.map((pid) => ({
          entityType: 'player' as const,
          entityId: pid,
          label: nameOf(pid),
          effectiveHandicap: fieldEff.get(pid) ?? 0,
        })),
      ),
    }));
  }

  const matches = trip.matches.filter((m) => m.roundId === roundId);
  const teamName = (side: 'A' | 'B') => trip.ryderTeams.find((t) => t.id === side)?.name ?? side;

  return matches.map((m, i) => {
    const label = `Match ${i + 1}: ${m.sideA.map(nameOf).join('/')} vs ${m.sideB.map(nameOf).join('/')}`;
    if (round.format === 'scramble') {
      // Sides play off the lower team handicap, as the server does.
      const thA = teamHandicapOf(m.sideA);
      const thB = teamHandicapOf(m.sideB);
      const low = Math.min(thA, thB);
      return {
        id: m.id,
        label,
        columns: [
          {
            entityType: 'side' as const,
            entityId: `${m.id}:A`,
            label: teamName('A'),
            effectiveHandicap: thA - low,
          },
          {
            entityType: 'side' as const,
            entityId: `${m.id}:B`,
            label: teamName('B'),
            effectiveHandicap: thB - low,
          },
        ],
      };
    }
    // Four-ball, Stableford and singles: strokes are worked out across the
    // whole match, not per side.
    const playerIds = [...m.sideA, ...m.sideB];
    const eff = effectiveOf(playerIds);
    return {
      id: m.id,
      label,
      columns: playerIds.map((pid) => ({
        entityType: 'player' as const,
        entityId: pid,
        label: nameOf(pid),
        effectiveHandicap: eff.get(pid) ?? 0,
      })),
    };
  });
}

interface ColumnStats {
  thru: number;
  gross: number;
  net: number;
  points: number;
}

/**
 * The scorecard itself. Entry is always gross strokes; net is derived here for
 * display only, the same way the server derives it for the leaderboard
 * (gross minus the strokes the player gets on that hole).
 */
function ScoreCard({
  course,
  group,
  round,
  valueFor,
  setScore,
}: {
  course: Course;
  group: Group;
  round: Round;
  valueFor: (col: Column, hole: number) => number | '';
  setScore: (col: Column, hole: number, raw: string) => void;
}) {
  const holeCount = course.holes.length;
  const totalYards = totalYardsOf(course);
  const isStableford = round.format === 'stableford';

  const strokesFor = (col: Column, hole: Hole) =>
    strokesOnHole(col.effectiveHandicap, hole.strokeIndex, holeCount);

  const statsFor = (col: Column): ColumnStats => {
    const stats: ColumnStats = { thru: 0, gross: 0, net: 0, points: 0 };
    for (const hole of course.holes) {
      const gross = valueFor(col, hole.number);
      if (typeof gross !== 'number') continue;
      const net = gross - strokesFor(col, hole);
      stats.thru += 1;
      stats.gross += gross;
      stats.net += net;
      stats.points += stablefordPoints(net, hole.par);
    }
    return stats;
  };

  const allStats = group.columns.map((col) => ({ col, stats: statsFor(col) }));
  const anyScores = allStats.some(({ stats }) => stats.thru > 0);

  return (
    <>
      {anyScores && (
        <div className="score-summary">
          {allStats.map(({ col, stats }) => (
            <div className="summary-card" key={col.entityId}>
              <div className="summary-name">{col.label}</div>
              {stats.thru > 0 ? (
                <>
                  <div className="summary-figures">
                    <span className="summary-net">{stats.net}</span>
                    <span className="summary-gross">net</span>
                  </div>
                  <div className="summary-thru">
                    {stats.gross} gross · thru {stats.thru}
                    {isStableford ? ` · ${stats.points} pt${stats.points === 1 ? '' : 's'}` : ''}
                  </div>
                </>
              ) : (
                <div className="summary-thru">no scores yet</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="score-grid-wrap">
        <table className="score-grid">
          <thead>
            <tr>
              <th>Hole</th>
              <th>Par</th>
              <th>Yds</th>
              <th>Index</th>
              {group.columns.map((c) => (
                <th key={c.entityId}>
                  <span className="col-head">
                    <span>{c.label}</span>
                    <span className={`col-strokes ${c.effectiveHandicap > 0 ? '' : 'scratch'}`}>
                      {c.effectiveHandicap > 0
                        ? `+${c.effectiveHandicap} stroke${c.effectiveHandicap > 1 ? 's' : ''}`
                        : 'no strokes'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {course.holes.map((hole) => (
              <tr key={hole.number}>
                <td>
                  <strong>{hole.number}</strong>
                </td>
                <td>{hole.par}</td>
                <td className="muted small">{hole.yards ?? '—'}</td>
                <td className="muted small">{hole.strokeIndex}</td>
                {group.columns.map((c) => {
                  const strokes = strokesFor(c, hole);
                  const gross = valueFor(c, hole.number);
                  const net = typeof gross === 'number' ? gross - strokes : null;
                  return (
                    <td key={c.entityId}>
                      <div className="score-cell">
                        <div className="score-cell-top">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            aria-label={`${c.label} gross strokes, hole ${hole.number}`}
                            value={gross}
                            onChange={(e) => setScore(c, hole.number, e.target.value)}
                          />
                          <span
                            className="stroke-marks"
                            title={
                              strokes > 0
                                ? `${c.label} gets ${strokes} stroke${strokes > 1 ? 's' : ''} here`
                                : undefined
                            }
                          >
                            {strokes > 0 ? '*'.repeat(strokes) : ''}
                          </span>
                        </div>
                        {/* Net only says something when a stroke was applied. */}
                        <span className="net-line">
                          {net != null && strokes > 0 ? (
                            <>
                              net <strong>{net}</strong>
                            </>
                          ) : (
                            ' '
                          )}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="totals-row">
              <td colSpan={2}>
                <strong>Gross</strong>
              </td>
              <td className="muted small">
                <strong>{totalYards ? totalYards.toLocaleString() : '—'}</strong>
              </td>
              <td />
              {allStats.map(({ col, stats }) => (
                <td key={col.entityId}>
                  <strong>{stats.thru ? stats.gross : '—'}</strong>
                </td>
              ))}
            </tr>
            <tr className="totals-row net-row">
              <td colSpan={4}>
                <strong>Net</strong>
              </td>
              {allStats.map(({ col, stats }) => (
                <td key={col.entityId}>
                  <strong>{stats.thru ? stats.net : '—'}</strong>
                </td>
              ))}
            </tr>
            {isStableford && (
              <tr className="totals-row net-row">
                <td colSpan={4}>
                  <strong>Points</strong>
                </td>
                {allStats.map(({ col, stats }) => (
                  <td key={col.entityId}>
                    <strong>{stats.thru ? stats.points : '—'}</strong>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
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
  const totalYards = course ? totalYardsOf(course) : null;

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

      <p className="entry-note">
        <span>⛳</span>
        <span>
          Enter your <strong>gross</strong> score — the actual number of shots you took. The app
          takes your strokes off and shows the <strong>net</strong> underneath. Never enter a net
          score yourself.
        </span>
      </p>

      {course && (
        <div className="course-head">
          <h2>{course.name}</h2>
          <p className="muted small">
            {[
              course.location,
              course.tee ? `${course.tee} tees` : null,
              totalYards ? `${totalYards.toLocaleString()} yds` : null,
              `par ${course.par}`,
              `${course.rating}/${course.slope}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}

      {round && course && mountainEquivalentNote(round.teeTimes, zoneFor(course)) && (
        <p className="tz-note">⏰ {mountainEquivalentNote(round.teeTimes, zoneFor(course))}</p>
      )}

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

      {group && course && round && (
        <ScoreCard
          course={course}
          group={group}
          round={round}
          valueFor={valueFor}
          setScore={setScore}
        />
      )}

      {group && (
        <p className="muted small">
          <strong>*</strong> = you get a stroke on that hole, <strong>**</strong> = two strokes.
          Strokes come off the low man — the whole 12-man field in Round 1, your match in
          Rounds 2–5 — so the lowest handicap gets none. Yardages show “—” until an admin enters
          them in Admin → Courses.
        </p>
      )}
      <p className="muted small">
        Scores save on your phone instantly and sync when there’s signal — the “unsynced” badge up
        top shows anything still waiting.
      </p>
    </div>
  );
}
