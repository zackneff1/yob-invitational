/**
 * The at-a-glance read-out above a score-entry group.
 *
 * Ryder Cup rounds get the match scoreboard — who's up and by how many holes,
 * never net totals, because in match play only the hole-by-hole result
 * matters. The Round 1 qualifier is stroke play, so it keeps the per-player
 * net/gross cards; Stableford adds a per-player points strip under the match
 * scoreboard because each player's points are what add up to the team total.
 */
import { Course, Round } from '../api/types';
import {
  Group,
  ValueFor,
  liveMatchState,
  qualifierStatus,
  scoreboardSides,
  statsFor,
} from '../scorecard';
import { MatchScoreboard } from './MatchScoreboard';

/** Per-player cards: net for stroke play, points for Stableford. */
export function PlayerStrip({
  course,
  group,
  valueFor,
  primary,
}: {
  course: Course;
  group: Group;
  valueFor: ValueFor;
  primary: 'net' | 'points';
}) {
  return (
    <div className="score-summary">
      {group.columns.map((col) => {
        const stats = statsFor(course, col, valueFor);
        const played = stats.thru + stats.pickups;
        return (
          <div className="summary-card" key={col.entityId}>
            <div className="summary-name">{col.label}</div>
            {played > 0 ? (
              <>
                <div className="summary-figures">
                  <span className="summary-net">
                    {primary === 'points' ? stats.points : stats.net}
                  </span>
                  <span className="summary-gross">{primary === 'points' ? 'pts' : 'net'}</span>
                </div>
                <div className="summary-thru">
                  {primary === 'points' ? `${stats.net} net · ` : ''}
                  {stats.gross} gross · thru {played}
                  {stats.pickups > 0 ? ` · ${stats.pickups} pickup${stats.pickups > 1 ? 's' : ''}` : ''}
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

export function GroupScoreboard({
  course,
  round,
  group,
  valueFor,
  compact,
}: {
  course: Course;
  round: Round;
  group: Group;
  valueFor: ValueFor;
  compact?: boolean;
}) {
  if (round.format === 'bestball-qualifier') {
    const status = qualifierStatus(course, group, valueFor);
    return (
      <>
        {status && (
          <div className="match-status-bar">
            <span className="match-status-label">Team</span>
            <span className="match-status-text">{status}</span>
          </div>
        )}
        <PlayerStrip course={course} group={group} valueFor={valueFor} primary="net" />
      </>
    );
  }

  const state = liveMatchState(course, round, group, valueFor);
  const sides = scoreboardSides(group);
  if (!state || !sides) return null;
  return (
    <>
      <div className="card rc-card">
        <MatchScoreboard state={state} sideA={sides.A} sideB={sides.B} compact={compact} />
      </div>
      {round.format === 'stableford' && (
        <PlayerStrip course={course} group={group} valueFor={valueFor} primary="points" />
      )}
    </>
  );
}
