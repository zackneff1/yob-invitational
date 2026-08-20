import { Link, useParams } from 'react-router-dom';
import { ComputedMatch } from '../api/types';
import { useRoundLeaderboard, useTrip } from '../hooks';
import { handicapRule } from '../roundRules';
import { TeeZone, withZone, zoneFor } from '../teeTimes';

function fmtToPar(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

export function MatchCard({ match, zone }: { match: ComputedMatch; zone?: TeeZone | null }) {
  return (
    <div className={`card match-card ${match.final ? 'match-final' : ''}`}>
      <div className="match-sides">
        <div className="match-side">
          <span className="team-name" style={{ color: match.sideA.color }}>
            {match.sideA.teamName}
          </span>
          {match.sideA.players.map((p) => (
            <span key={p.playerId} className="player-name">
              {p.name}
              {p.effectiveHandicap > 0 && <em> +{p.effectiveHandicap}</em>}
            </span>
          ))}
        </div>
        <div className="match-vs">vs</div>
        <div className="match-side right">
          <span className="team-name" style={{ color: match.sideB.color }}>
            {match.sideB.teamName}
          </span>
          {match.sideB.players.map((p) => (
            <span key={p.playerId} className="player-name">
              {p.name}
              {p.effectiveHandicap > 0 && <em> +{p.effectiveHandicap}</em>}
            </span>
          ))}
        </div>
      </div>
      <div className="match-status">
        <strong>{match.statusText}</strong>
        {match.detail && (
          <span className="muted">
            {' '}
            · {match.detail.totalA}–{match.detail.totalB} {match.detail.unit}
          </span>
        )}
        {match.teeTime && <span className="muted"> · {withZone(match.teeTime, zone ?? null)}</span>}
      </div>
    </div>
  );
}

export function MatchesPage() {
  const { roundId } = useParams();
  const trip = useTrip();
  const activeRoundId = roundId ?? trip.data?.rounds[0]?.id;
  const board = useRoundLeaderboard(activeRoundId);
  const activeRound = trip.data?.rounds.find((r) => r.id === activeRoundId);
  const qualifierZone = zoneFor(trip.data?.courses.find((c) => c.id === activeRound?.courseId));

  if (trip.isLoading) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      <h1>Round Leaderboards</h1>
      <div className="chip-row">
        {trip.data?.rounds.map((r, i) => (
          <Link
            key={r.id}
            to={`/leaderboard/${r.id}`}
            className={`chip ${r.id === activeRoundId ? 'active' : ''}`}
          >
            R{i + 1}
          </Link>
        ))}
      </div>

      {board.isLoading && <p className="muted">Loading leaderboard…</p>}

      {board.data?.type === 'qualifier' && (
        <>
          <h2>{board.data.round.name}</h2>
          <p className="muted">{board.data.round.formatLabel} — winners are the captains.</p>
          <p className="rule-line">
            <strong>Handicaps:</strong> {handicapRule(board.data.round)}
          </p>
          {board.data.rows.length === 0 && (
            <p className="muted">No pairings drawn yet. Admin runs the random draw.</p>
          )}
          {board.data.rows.length > 0 && (
            <table className="card">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>Thru</th>
                  <th>Net</th>
                  <th>To Par</th>
                </tr>
              </thead>
              <tbody>
                {board.data.rows.map((row) => (
                  <tr key={row.pairingId} className={row.position === 1 ? 'leader-row' : ''}>
                    <td>{row.thru > 0 ? row.position : '—'}</td>
                    <td>
                      {row.name}
                      <div className="muted small">
                        {row.players.map((p) => `${p.name} (${p.playingHandicap})`).join(' · ')}
                        {row.teeTime ? ` · ${withZone(row.teeTime, qualifierZone)}` : ''}
                      </div>
                    </td>
                    <td>{row.thru || '—'}</td>
                    <td>{row.thru ? row.net : '—'}</td>
                    <td>
                      <strong>{row.thru ? fmtToPar(row.toPar) : '—'}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {board.data?.type === 'matches' && (
        <>
          <h2>{board.data.round.name}</h2>
          <p className="muted">{board.data.round.formatLabel}</p>
          <p className="rule-line">
            <strong>Handicaps:</strong> {handicapRule(board.data.round)}
          </p>
          {board.data.matches.length === 0 && (
            <p className="muted">Matches not set yet — captains submit lineups to the admins.</p>
          )}
          {board.data.matches.map((m) => (
            <MatchCard key={m.id} match={m} zone={qualifierZone} />
          ))}
        </>
      )}
    </div>
  );
}
