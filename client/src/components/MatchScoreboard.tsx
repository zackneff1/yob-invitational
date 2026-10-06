/**
 * A Ryder Cup match the way the Ryder Cup shows one: each side's players on
 * its own half, and in the middle a pill in the leading team's colour saying
 * how the match stands — "2 UP", "AS", "3&2", "HALVED" — with "thru 12" or
 * "Final" under it. Points earned appear on the winning side once it's over.
 *
 * Used by the Leaderboard and Cup pages (fed from the server) and by the score
 * page (fed from the scores on the phone), so the match reads the same
 * everywhere.
 */
import { MatchState, ScoreboardSide, describeMatch } from '../matchState';

interface Props {
  state: MatchState;
  sideA: ScoreboardSide;
  sideB: ScoreboardSide;
  /** Shown under the pill before the match starts. */
  teeTime?: string | null;
  compact?: boolean;
}

function fmtPoints(p: number): string {
  return p === 0.5 ? '½' : p === 1.5 ? '1½' : String(p);
}

export function MatchScoreboard({ state, sideA, sideB, teeTime, compact }: Props) {
  const readout = describeMatch(state, { A: sideA.name, B: sideB.name });
  const pillColor =
    readout.tone === 'A' ? sideA.color : readout.tone === 'B' ? sideB.color : undefined;

  const pointsFor = (which: 'A' | 'B'): number | null => {
    if (!state.final) return null;
    if (state.leader == null) return 0.5;
    return state.leader === which ? 1 : 0;
  };

  const renderSide = (side: ScoreboardSide, which: 'A' | 'B') => {
    const pts = pointsFor(which);
    const leading = readout.tone === which;
    const trailing = readout.tone != null && readout.tone !== which;
    return (
      <div
        className={`rc-side ${which === 'B' ? 'right' : ''} ${leading ? 'leading' : ''} ${
          trailing ? 'trailing' : ''
        }`}
      >
        <span className="rc-team" style={{ color: side.color }}>
          {side.name}
        </span>
        {side.players.map((p) => (
          <span key={p.label} className="rc-player">
            {p.label}
            {p.strokes > 0 && <em title="strokes received in this match">+{p.strokes}</em>}
          </span>
        ))}
        {side.strokes != null && side.strokes > 0 && (
          <span className="rc-player">
            <em>+{side.strokes} team stroke{side.strokes > 1 ? 's' : ''}</em>
          </span>
        )}
        {pts != null && pts > 0 && (
          <span className="rc-pts" style={{ color: side.color }}>
            {fmtPoints(pts)} pt
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={`rc-match ${state.final ? 'final' : ''} ${compact ? 'compact' : ''}`}>
      {renderSide(sideA, 'A')}
      <div className="rc-center">
        <span
          className={`rc-pill ${pillColor ? '' : 'neutral'}`}
          style={pillColor ? { background: pillColor } : undefined}
        >
          {readout.big}
        </span>
        <span className="rc-sub">{readout.sub}</span>
        {state.thru === 0 && !state.final && teeTime && <span className="rc-sub">{teeTime}</span>}
      </div>
      {renderSide(sideB, 'B')}
    </div>
  );
}
