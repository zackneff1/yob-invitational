/**
 * Hole-by-hole play view — what you actually use walking the course: where the
 * match stands, one hole at a time with its details, who's getting a stroke on
 * it, and tap-only scoring.
 *
 * Scores here are entered with the −/+ buttons rather than a text field on
 * purpose: tapping a number input on a phone throws up the keyboard over half
 * the screen. Typing an exact score lives in the full-card view. A player who
 * doesn't hole out taps "Pickup" — an explicit no-return, never a 0.
 */
import { Course, Round } from '../api/types';
import { Column, Group, ValueFor, strokesForHole, stablefordPoints } from '../scorecard';
import { GroupScoreboard } from './GroupScoreboard';

interface Props {
  course: Course;
  group: Group;
  round: Round;
  /** 1-based hole currently being played. */
  hole: number;
  valueFor: ValueFor;
  setScore: (col: Column, hole: number, raw: string) => void;
  /** Record an explicit pickup / no return for the column on the hole. */
  onPickup: (col: Column, hole: number) => void;
  /** Nudge a score by delta, starting from par when nothing is entered yet. */
  onAdjust: (col: Column, hole: number, delta: number, par: number) => void;
  onGoToHole: (hole: number) => void;
  onFinish: () => void;
}

export function HoleView({
  course,
  group,
  round,
  hole,
  valueFor,
  setScore,
  onPickup,
  onAdjust,
  onGoToHole,
  onFinish,
}: Props) {
  const holeCount = course.holes.length;
  const current = course.holes.find((h) => h.number === hole) ?? course.holes[0];
  const isLast = current.number === holeCount;
  const isStableford = round.format === 'stableford';
  const isMatchPlay = round.format === 'fourball' || round.format === 'singles';

  const strokesOf = (col: Column) => strokesForHole(course, col, current);

  /** Everyone in the group getting a shot on this hole. */
  const stroking = group.columns
    .map((col) => ({ col, strokes: strokesOf(col) }))
    .filter(({ strokes }) => strokes > 0);

  /** Every ball on the hole is resolved: a score or a pickup. */
  const allResolved = (holeNumber: number) =>
    group.columns.every((col) => valueFor(col, holeNumber) !== '');

  const bump = (col: Column, delta: number) => onAdjust(col, current.number, delta, current.par);

  /** Match play: who took this hole, once every ball on it is resolved. */
  const holeResult = (): string | null => {
    if (!isMatchPlay || !group.match) return null;
    const netsOf = (ids: string[]) =>
      ids
        .map((id) => group.columns.find((c) => c.entityId === id))
        .filter((c): c is Column => Boolean(c))
        .map((c) => {
          const g = valueFor(c, current.number);
          return typeof g === 'number' ? g - strokesOf(c) : g;
        });
    const a = netsOf(group.match.sideA);
    const b = netsOf(group.match.sideB);
    if ([...a, ...b].some((v) => v === '')) return null;
    const numA = a.filter((v): v is number => typeof v === 'number');
    const numB = b.filter((v): v is number => typeof v === 'number');
    if (!numA.length && !numB.length) return 'Hole halved (both sides picked up)';
    if (!numA.length) return `${group.match.teamB} wins the hole (${group.match.teamA} picked up)`;
    if (!numB.length) return `${group.match.teamA} wins the hole (${group.match.teamB} picked up)`;
    const bestA = Math.min(...numA);
    const bestB = Math.min(...numB);
    if (bestA === bestB) return `Hole halved (net ${bestA})`;
    return `${bestA < bestB ? group.match.teamA : group.match.teamB} wins the hole (net ${Math.min(bestA, bestB)} to ${Math.max(bestA, bestB)})`;
  };
  const result = holeResult();

  return (
    <div className="hole-play">
      <GroupScoreboard course={course} round={round} group={group} valueFor={valueFor} compact />

      <div className="card hole-head">
        <div className="hole-nav">
          <button
            className="hole-arrow"
            aria-label="Previous hole"
            disabled={current.number === 1}
            onClick={() => onGoToHole(current.number - 1)}
          >
            ‹
          </button>
          <div className="hole-title">
            <span className="hole-number">Hole {current.number}</span>
            <span className="hole-of">of {holeCount}</span>
          </div>
          <button
            className="hole-arrow"
            aria-label="Next hole"
            disabled={isLast}
            onClick={() => onGoToHole(current.number + 1)}
          >
            ›
          </button>
        </div>
        <div className="hole-facts">
          <span className="hole-fact">
            <strong>Par {current.par}</strong>
          </span>
          <span className="hole-fact">{current.yards ? `${current.yards} yds` : 'yds —'}</span>
          <span className="hole-fact">Index {current.strokeIndex}</span>
        </div>
        <p className="stroking-line">
          {stroking.length === 0 ? (
            <span className="muted">Nobody gets a stroke on this hole.</span>
          ) : (
            <>
              <span className="muted">Stroking here: </span>
              {stroking.map(({ col, strokes }, i) => (
                <span key={col.entityId}>
                  {i > 0 && ', '}
                  <strong>{col.label}</strong>
                  {strokes > 1 ? ` (${strokes})` : ''}
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      <div className="hole-strip">
        {course.holes.map((h) => (
          <button
            key={h.number}
            className={`hole-pip ${h.number === current.number ? 'active' : ''} ${
              allResolved(h.number) ? 'done' : ''
            }`}
            aria-label={`Go to hole ${h.number}`}
            onClick={() => onGoToHole(h.number)}
          >
            {h.number}
          </button>
        ))}
      </div>

      {group.columns.map((col) => {
        const strokes = strokesOf(col);
        const gross = valueFor(col, current.number);
        const picked = gross === 'pickup';
        const net = typeof gross === 'number' ? gross - strokes : null;
        return (
          <div className="card hole-player" key={col.entityId}>
            <div className="hole-player-top">
              <span className="hole-player-name">{col.label}</span>
              {strokes > 0 ? (
                <span className="hole-stroke-badge">
                  {'*'.repeat(strokes)} {strokes} stroke{strokes > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="hole-stroke-badge none">no stroke</span>
              )}
            </div>
            <div className="stepper">
              {/* Nothing entered yet: only + is live, so it's obvious that's
                  where you start (it lands on par). */}
              <button
                aria-label={`Lower ${col.label}'s score`}
                onClick={() => bump(col, -1)}
                disabled={gross === '' || picked || gross === 1}
              >
                −
              </button>
              <span
                className={`stepper-value ${gross === '' ? 'empty' : ''} ${picked ? 'picked' : ''}`}
                role="status"
                aria-label={`${col.label} gross score${
                  gross === '' ? ' not entered' : picked ? ': picked up' : `: ${gross}`
                }`}
              >
                {gross === '' ? '–' : picked ? 'P' : gross}
              </span>
              <button aria-label={`Raise ${col.label}'s score`} onClick={() => bump(col, 1)}>
                +
              </button>
              <span className="stepper-result">
                {picked ? (
                  <span className="muted small">picked up · no score</span>
                ) : net != null ? (
                  <>
                    <span className="stepper-net">
                      net <strong>{net}</strong>
                    </span>
                    {isStableford && (
                      <span className="stepper-pts">
                        {stablefordPoints(net, current.par)} pt
                        {stablefordPoints(net, current.par) === 1 ? '' : 's'}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted small">gross</span>
                )}
              </span>
              {col.entityType === 'player' && !picked && (
                <button
                  className="ghost pickup-btn"
                  title="Didn't hole out — the ball doesn't count on this hole"
                  onClick={() => onPickup(col, current.number)}
                >
                  Pickup
                </button>
              )}
              {gross !== '' && (
                <button
                  className="ghost clear-score"
                  aria-label={`Clear ${col.label}'s ${picked ? 'pickup' : 'score'}`}
                  title={picked ? 'Clear the pickup' : 'Clear this score'}
                  onClick={() => setScore(col, current.number, '')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

      {result && <p className="hole-result">{result}</p>}

      <div className="hole-actions">
        {isLast ? (
          <button className="hole-next" onClick={onFinish}>
            Finish round ✓
          </button>
        ) : (
          <button className="hole-next" onClick={() => onGoToHole(current.number + 1)}>
            Next hole →
          </button>
        )}
      </div>
    </div>
  );
}
