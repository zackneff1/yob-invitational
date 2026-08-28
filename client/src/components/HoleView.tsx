/**
 * Hole-by-hole play view — what you actually use walking the course: where the
 * match stands, one hole at a time with its details, who's getting a stroke on
 * it, and tap-only scoring.
 *
 * Scores here are entered with the −/+ buttons rather than a text field on
 * purpose: tapping a number input on a phone throws up the keyboard over half
 * the screen. Typing an exact score lives in the full-card view.
 */
import { Course, Round } from '../api/types';
import {
  Column,
  Group,
  ValueFor,
  liveStatus,
  statsFor,
  strokesForHole,
  stablefordPoints,
} from '../scorecard';

interface Props {
  course: Course;
  group: Group;
  round: Round;
  /** 1-based hole currently being played. */
  hole: number;
  valueFor: ValueFor;
  setScore: (col: Column, hole: number, raw: string) => void;
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
  onAdjust,
  onGoToHole,
  onFinish,
}: Props) {
  const holeCount = course.holes.length;
  const current = course.holes.find((h) => h.number === hole) ?? course.holes[0];
  const isLast = current.number === holeCount;
  const isStableford = round.format === 'stableford';
  const status = liveStatus(course, round, group, valueFor);

  const strokesOf = (col: Column) => strokesForHole(course, col, current);

  /** Everyone in the group getting a shot on this hole. */
  const stroking = group.columns
    .map((col) => ({ col, strokes: strokesOf(col) }))
    .filter(({ strokes }) => strokes > 0);

  const allScored = (holeNumber: number) =>
    group.columns.every((col) => typeof valueFor(col, holeNumber) === 'number');

  const bump = (col: Column, delta: number) => onAdjust(col, current.number, delta, current.par);

  return (
    <div className="hole-play">
      {status && (
        <div className="match-status-bar">
          <span className="match-status-label">
            {round.format === 'bestball-qualifier' ? 'Team' : 'Match'}
          </span>
          <span className="match-status-text">{status}</span>
        </div>
      )}

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
              allScored(h.number) ? 'done' : ''
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
                disabled={gross === '' || gross === 1}
              >
                −
              </button>
              <span
                className={`stepper-value ${gross === '' ? 'empty' : ''}`}
                role="status"
                aria-label={`${col.label} gross score${gross === '' ? ' not entered' : `: ${gross}`}`}
              >
                {gross === '' ? '–' : gross}
              </span>
              <button aria-label={`Raise ${col.label}'s score`} onClick={() => bump(col, 1)}>
                +
              </button>
              <span className="stepper-result">
                {net != null ? (
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
              {typeof gross === 'number' && (
                <button
                  className="ghost clear-score"
                  aria-label={`Clear ${col.label}'s score`}
                  title="Clear this score"
                  onClick={() => setScore(col, current.number, '')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

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
    </div>
  );
}
