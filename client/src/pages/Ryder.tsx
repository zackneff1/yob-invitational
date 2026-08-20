import { useRyderBoard, useTrip } from '../hooks';
import { MatchCard } from './Matches';

export function RyderPage() {
  const board = useRyderBoard();
  const trip = useTrip();

  if (board.isLoading) return <p className="muted">Loading…</p>;
  if (!board.data) return <p className="muted">Couldn’t load the Cup standings.</p>;

  const { teams, totalPoints, pointsToWin, rounds } = board.data;
  const [a, b] = teams;
  const players = trip.data?.players ?? [];

  return (
    <div className="page">
      <h1>Ryder Cup</h1>
      <div className="cup-score card">
        <div className="cup-team" style={{ color: a.color }}>
          <span className="cup-name">{a.name}</span>
          <span className="cup-points">{a.points}</span>
          {a.provisional !== a.points && <span className="muted small">({a.provisional} proj.)</span>}
        </div>
        <div className="cup-mid">
          <span className="muted small">first to {pointsToWin}</span>
          <span className="muted small">{totalPoints} pts total</span>
        </div>
        <div className="cup-team" style={{ color: b.color }}>
          <span className="cup-name">{b.name}</span>
          <span className="cup-points">{b.points}</span>
          {b.provisional !== b.points && <span className="muted small">({b.provisional} proj.)</span>}
        </div>
      </div>
      <div className="cup-bar">
        <div
          style={{
            width: `${(a.points / totalPoints) * 100}%`,
            background: a.color,
          }}
        />
        <div
          style={{
            width: `${(b.points / totalPoints) * 100}%`,
            background: b.color,
            marginLeft: 'auto',
          }}
        />
      </div>
      <p className="muted small">
        Captains: {players.find((p) => p.id === a.captainId)?.name ?? 'TBD'} ({a.name}) ·{' '}
        {players.find((p) => p.id === b.captainId)?.name ?? 'TBD'} ({b.name}). Solid points are
        final; projected includes matches still on the course.
      </p>

      {rounds.map((round) => (
        <section key={round.roundId}>
          <h2>{round.roundName}</h2>
          {round.matches.length === 0 && <p className="muted">Matches not set.</p>}
          {round.matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </section>
      ))}
    </div>
  );
}
