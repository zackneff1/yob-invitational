import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { enqueueScores, flushQueue, pendingScores } from '../api/queue';
import { Course, Round } from '../api/types';
import { useAuth } from '../auth';
import { HoleView } from '../components/HoleView';
import { useScores, useTrip } from '../hooks';
import { activeSessionRoundId, usePlaySession } from '../playSession';
import {
  Column,
  Group,
  ValueFor,
  buildGroups,
  statsFor,
  strokesForHole,
  totalYardsOf,
} from '../scorecard';
import { mountainEquivalentNote, withZone, zoneFor } from '../teeTimes';

/** Per-player net/gross/thru cards, shared by both views. */
function SummaryStrip({
  course,
  group,
  valueFor,
  isStableford,
}: {
  course: Course;
  group: Group;
  valueFor: ValueFor;
  isStableford: boolean;
}) {
  return (
    <div className="score-summary">
      {group.columns.map((col) => {
        const stats = statsFor(course, col, valueFor);
        return (
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
        );
      })}
    </div>
  );
}

/**
 * The full scorecard grid — every hole at once. Best for fixing up scores
 * after the round; the hole-by-hole view is what you use while playing.
 * Entry is always gross strokes; net is derived here for display only, the
 * same way the server derives it for the leaderboard.
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
  valueFor: ValueFor;
  setScore: (col: Column, hole: number, raw: string) => void;
}) {
  const totalYards = totalYardsOf(course);
  const isStableford = round.format === 'stableford';
  const allStats = group.columns.map((col) => ({ col, stats: statsFor(course, col, valueFor) }));
  const anyScores = allStats.some(({ stats }) => stats.thru > 0);

  return (
    <>
      {anyScores && (
        <SummaryStrip
          course={course}
          group={group}
          valueFor={valueFor}
          isStableford={isStableford}
        />
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
                  const strokes = strokesForHole(course, c, hole);
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
                            ' '
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

/** Shown before you tee off, and again once you've ended the round. */
function StartRound({
  course,
  group,
  round,
  valueFor,
  onStart,
}: {
  course: Course;
  group: Group;
  round: Round;
  valueFor: ValueFor;
  onStart: () => void;
}) {
  const played = group.columns.some(
    (col) => statsFor(course, col, valueFor).thru > 0,
  );
  return (
    <>
      <div className="card start-card">
        <h2>{played ? 'Round not in progress' : 'Ready to play?'}</h2>
        <p className="muted small">
          {played
            ? 'Your scores are saved. Pick up where you left off, or switch to the full card to fix anything.'
            : 'Start the round and the app walks you through hole by hole — the hole’s details, who’s getting a stroke, and a box for each score.'}
        </p>
        <button className="hole-next" onClick={onStart}>
          {played ? 'Resume round ⛳' : 'Start round ⛳'}
        </button>
        <p className="entry-note">
          <span>⛳</span>
          <span>
            Always enter your <strong>gross</strong> score — the actual shots you took. The app
            takes the strokes off and shows the <strong>net</strong> itself.
          </span>
        </p>
      </div>
      {played && (
        <SummaryStrip
          course={course}
          group={group}
          valueFor={valueFor}
          isStableford={round.format === 'stableford'}
        />
      )}
    </>
  );
}

export function ScoreEntryPage() {
  const { auth } = useAuth();
  const trip = useTrip();
  const queryClient = useQueryClient();
  // Come back to the round you're mid-way through, not always Round 1.
  const [roundId, setRoundId] = useState<string>(activeSessionRoundId);
  const [groupId, setGroupId] = useState<string>('');
  const [view, setView] = useState<'play' | 'card'>('play');
  // Session-local edits, keyed entityType|entityId|hole — shown immediately,
  // synced through the offline queue. The ref mirrors the state and is written
  // synchronously, so back-to-back taps on the +/− stepper each build on the
  // previous one instead of all reading the same pre-render value.
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const localRef = useRef<Record<string, number | null>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rounds = trip.data?.rounds ?? [];
  // Ignore a stored round id that isn't in this trip any more.
  const activeRoundId = rounds.some((r) => r.id === roundId) ? roundId : (rounds[0]?.id ?? '');
  const scores = useScores(activeRoundId || undefined);
  const round = rounds.find((r) => r.id === activeRoundId);
  const course = trip.data?.courses.find((c) => c.id === round?.courseId);
  const { session, start, end, goToHole } = usePlaySession(
    activeRoundId,
    course?.holes.length ?? 18,
  );

  const groups = useMemo(() => {
    if (!trip.data || !activeRoundId) return [];
    const r = trip.data.rounds.find((x) => x.id === activeRoundId);
    const zone = zoneFor(trip.data.courses.find((c) => c.id === r?.courseId));
    return buildGroups(trip.data, activeRoundId, (t) => withZone(t, zone));
  }, [trip.data, activeRoundId]);

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
  /** Out on the course right now, as opposed to browsing the card. */
  const inPlay = view === 'play' && !!session;

  /** Latest value for a cell, reading the synchronous ref rather than state. */
  const readCurrent = (col: Column, hole: number): number | null => {
    const key = `${col.entityType}|${col.entityId}|${hole}`;
    if (key in localRef.current) return localRef.current[key];
    const queued = pendingScores().find(
      (q) =>
        q.roundId === activeRoundId &&
        q.entityType === col.entityType &&
        q.entityId === col.entityId &&
        q.hole === hole,
    );
    if (queued) return queued.strokes;
    const server = scores.data?.find(
      (s) => s.entityType === col.entityType && s.entityId === col.entityId && s.hole === hole,
    );
    return server?.strokes ?? null;
  };

  const valueFor: ValueFor = (col, hole) => {
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
    localRef.current = { ...localRef.current, [key]: strokes };
    setLocal(localRef.current);
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

  /** Stepper: nudge a score by one, starting from par when nothing's entered. */
  const adjustScore = (col: Column, hole: number, delta: number, par: number) => {
    const current = readCurrent(col, hole);
    const next = current == null ? par : current + delta;
    setScore(col, hole, String(Math.max(1, Math.min(20, next))));
  };

  /** Only offered on the last hole — no way to bail out mid-round by accident. */
  const finishRound = () => {
    if (
      !window.confirm(
        'Finish the round? Your scores are saved either way — you can still fix anything on the full card.',
      )
    )
      return;
    end();
  };

  if (trip.isLoading) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      {/* Out on the course the screen belongs to the hole in front of you: no
          round switcher, no group picker, no course blurb. Those all come back
          on the full card, which is also the way out of play mode. */}
      {inPlay ? (
        <h1 className="play-title">
          {round?.name}
          <span className="muted"> · {round?.formatLabel.split('—')[0].trim()}</span>
        </h1>
      ) : (
        <>
          <h1>Scores</h1>
          <div className="chip-row">
            {rounds.map((r, i) => (
              <button
                key={r.id}
                className={`chip ${r.id === activeRoundId ? 'active' : ''}`}
                onClick={() => {
                  setRoundId(r.id);
                  setGroupId('');
                  localRef.current = {};
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
            <select
              className="group-select"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {group && course && round && (
        <>
          <div className="chip-row view-toggle">
            <button
              className={`chip ${view === 'play' ? 'active' : ''}`}
              onClick={() => setView('play')}
            >
              Hole by hole
            </button>
            <button
              className={`chip ${view === 'card' ? 'active' : ''}`}
              onClick={() => setView('card')}
            >
              Full card
            </button>
          </div>

          {view === 'card' ? (
            <ScoreCard
              course={course}
              group={group}
              round={round}
              valueFor={valueFor}
              setScore={setScore}
            />
          ) : session ? (
            <HoleView
              course={course}
              group={group}
              round={round}
              hole={session.hole}
              valueFor={valueFor}
              setScore={setScore}
              onAdjust={adjustScore}
              onGoToHole={goToHole}
              onFinish={finishRound}
            />
          ) : (
            <StartRound
              course={course}
              group={group}
              round={round}
              valueFor={valueFor}
              onStart={start}
            />
          )}
        </>
      )}

      {group && view === 'card' && (
        <p className="muted small">
          <strong>*</strong> = you get a stroke on that hole, <strong>**</strong> = two strokes.
          Strokes come off the low man — the whole 12-man field in Round 1, your match in
          Rounds 2–5 — so the lowest handicap gets none. Yardages show “—” until an admin enters
          them in Admin → Courses.
        </p>
      )}
      {!inPlay && (
        <p className="muted small">
          Scores save on your phone instantly and sync when there’s signal — the “unsynced” badge
          up top shows anything still waiting.
        </p>
      )}
    </div>
  );
}
