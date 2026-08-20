import { Link } from 'react-router-dom';
import { mountainEquivalentNote, withZone, zoneFor } from '../teeTimes';
import { useTrip } from '../hooks';

export function OverviewPage() {
  const trip = useTrip();
  if (trip.isLoading) return <p className="muted">Loading trip…</p>;
  if (!trip.data) return <p className="muted">Couldn’t load the trip. Pull down to retry.</p>;
  const { rounds, courses, players, ryderTeams } = trip.data;

  const teamsDrafted = ryderTeams.some((t) => t.playerIds.length > 0);

  return (
    <div className="page">
      <h1>Trip Overview</h1>
      <p className="muted">
        12 players · Ryder Cup format · Round 1 decides the captains, draft is live after.
      </p>

      {teamsDrafted && (
        <section className="card">
          <h2>Teams</h2>
          <div className="team-grid">
            {ryderTeams.map((team) => (
              <div key={team.id} className="team-block" style={{ borderColor: team.color }}>
                <h3 style={{ color: team.color }}>{team.name}</h3>
                <ul>
                  {team.playerIds.map((id) => {
                    const p = players.find((pl) => pl.id === id);
                    return (
                      <li key={id}>
                        {p?.name}
                        {team.captainId === id && ' 🅲'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Schedule & Formats</h2>
        {rounds.map((round) => {
          const course = courses.find((c) => c.id === round.courseId);
          return (
            <div key={round.id} className="card round-card">
              <div className="round-card-head">
                <div>
                  <h3>{round.name}</h3>
                  <p className="muted">
                    {round.dayLabel} · {course?.name} ({course?.location})
                  </p>
                </div>
                <Link className="pill-link" to={`/leaderboard/${round.id}`}>
                  Live →
                </Link>
              </div>
              <p>
                <strong>{round.formatLabel}</strong>
              </p>
              <p className="muted">{round.description}</p>
              <p>
                <strong>Tee times:</strong>{' '}
                {withZone(round.teeTimes.join(' · '), zoneFor(course))}
              </p>
              {mountainEquivalentNote(round.teeTimes, zoneFor(course)) && (
                <p className="tz-note">
                  ⏰ {mountainEquivalentNote(round.teeTimes, zoneFor(course))}
                </p>
              )}
              <p className="muted">
                {course?.tee !== 'TBD' ? `${course?.tee} tees · ` : ''}
                Par {course?.par} · Rating {course?.rating} · Slope {course?.slope}
                {course?.holes.length === 9 ? ' · 9 holes' : ''}
              </p>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Players & Handicaps</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Index</th>
              {rounds.map((r) => (
                <th key={r.id} title={r.name}>
                  {r.name.split('—')[0].replace('Round', 'R').trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...players]
              .sort((a, b) => a.handicapIndex - b.handicapIndex)
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.isAdmin && ' ⭐'}
                  </td>
                  <td>{p.handicapIndex.toFixed(1)}</td>
                  {rounds.map((r) => {
                    const ch = r.courseHandicaps.find((c) => c.playerId === p.id);
                    return <td key={r.id}>{ch?.playingHandicap ?? '—'}</td>;
                  })}
                </tr>
              ))}
          </tbody>
        </table>
        <p className="muted small">
          Columns show playing handicap per round (course handicap × allowance). Indexes get
          updated right before the trip in Admin.
        </p>
      </section>
    </div>
  );
}
