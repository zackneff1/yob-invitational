import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTrip } from '../hooks';
import { LODGING, mapsLink, smsLink, telLink } from '../lodging';
import { notificationPermission, requestNotifications } from '../notify';
import { descriptionWithoutHandicapRule, handicapRule } from '../roundRules';
import { leaderboardRounds, statusLabel } from '../rounds';
import { courseClockNote, localTime, zoneFor } from '../teeTimes';

function AlertsCard() {
  const [permission, setPermission] = useState(notificationPermission());
  const enable = async () => setPermission(await requestNotifications());
  return (
    <section className="card">
      <h2>Match alerts</h2>
      <p className="muted small">
        Whenever a match closes in Rounds 2–5, a banner pops up in the app for everyone with the
        result.
        {permission === 'granted' && ' Phone notifications are on for this device too.'}
        {permission === 'denied' &&
          ' Phone notifications are blocked for this site in your browser settings.'}
      </p>
      {permission === 'default' && (
        <>
          <button onClick={() => void enable()}>🔔 Also buzz my phone</button>
          <p className="muted small">
            On iPhone this only works once the app is on your Home Screen (Share → Add to Home
            Screen) and you open it from there.
          </p>
        </>
      )}
    </section>
  );
}

function LodgingCard({ settings }: { settings: Record<string, string> }) {
  const confirmation = settings[LODGING.confirmationKey];
  return (
    <section className="card lodging">
      <h2>Where we&apos;re staying</h2>
      <p className="muted small">
        Two houses across the street from each other at The Ledges, 15 minutes north of town. No
        check-in desk — drive straight to the house and let yourself in with the door code.
      </p>
      <p>
        <strong>Check in:</strong> {LODGING.checkIn} · <strong>Check out:</strong>{' '}
        {LODGING.checkOut}
      </p>
      {LODGING.houses.map((house) => {
        const code = settings[house.codeKey];
        return (
          <div key={house.id} className="house">
            <h3>{house.name}</h3>
            <a href={mapsLink(house.address)} target="_blank" rel="noreferrer">
              {house.address} ↗
            </a>
            <div className="muted small">{house.whichSide}</div>
            <div>
              <span className="muted small">Front door code: </span>
              {code ? (
                <strong className="door-code">{code}</strong>
              ) : (
                <span className="muted small">not entered yet — an admin adds it under Admin → Lodging</span>
              )}
            </div>
          </div>
        );
      })}
      <details>
        <summary>Keypad: how to get in</summary>
        <ol>
          {LODGING.keypad.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">Codes are registered under {LODGING.codeHolder}&apos;s name.</p>
      </details>
      <details>
        <summary>Driving directions from St. George</summary>
        <ol>
          {LODGING.directions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">
          Red Rock Peace (4975) will be on your left, Red Rock Getaway (4958) on your right.
        </p>
      </details>
      <p className="muted small">
        {LODGING.manager}: call <a href={telLink(LODGING.officePhone)}>{LODGING.officePhone}</a> or
        text <a href={smsLink(LODGING.textLine)}>{LODGING.textLine}</a> (also after hours). Their
        online guest guide logs in with arrival date {LODGING.guestGuideArrival} and confirmation
        number {confirmation ? <strong>{confirmation}</strong> : '(ask Aaron)'}.
      </p>
    </section>
  );
}

export function OverviewPage() {
  const trip = useTrip();
  if (trip.isLoading) return <p className="muted">Loading trip…</p>;
  if (!trip.data) return <p className="muted">Couldn’t load the trip. Pull down to retry.</p>;
  const { rounds, courses, players, ryderTeams, settings } = trip.data;

  const teamsDrafted = ryderTeams.some((t) => t.playerIds.length > 0);
  const boardRounds = leaderboardRounds(rounds);

  return (
    <div className="page">
      <h1>Trip Overview</h1>
      <p className="muted">
        12 players · Ryder Cup format · Round 1 decides the captains, draft is live after. All
        times are St. George (Mountain) time.
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
          const zone = zoneFor(course);
          const clockNote = courseClockNote(round.teeTimes, zone);
          const onBoard = boardRounds.some((r) => r.id === round.id);
          return (
            <div key={round.id} className={`card round-card ${round.status}`}>
              <div className="round-card-head">
                <div>
                  <h3>
                    {round.name}
                    {round.status !== 'upcoming' && (
                      <span className={`status-badge ${round.status}`}>
                        {statusLabel(round.status)}
                      </span>
                    )}
                  </h3>
                  <p className="muted">
                    {round.dayLabel} · {course?.name} ({course?.location})
                  </p>
                </div>
                {onBoard && (
                  <Link className="pill-link" to={`/leaderboard/${round.id}`}>
                    Leaderboard →
                  </Link>
                )}
              </div>
              <p>
                <strong>{round.formatLabel}</strong>
              </p>
              <p className="muted">{descriptionWithoutHandicapRule(round.description)}</p>
              <p className="rule-line">
                <strong>Handicaps:</strong> {handicapRule(round)}
              </p>
              <p>
                <strong>Tee times:</strong>{' '}
                {round.teeTimes.map((t) => localTime(t, zone)).join(' · ')}
              </p>
              {clockNote && <p className="tz-note">⏰ {clockNote}</p>}
              <p className="muted">
                {course?.tee !== 'TBD' ? `${course?.tee} tees · ` : ''}
                Par {course?.par} · Rating {course?.rating} · Slope {course?.slope}
                {course?.holes.length === 9 ? ' · 9 holes' : ''}
              </p>
            </div>
          );
        })}
      </section>

      <LodgingCard settings={settings ?? {}} />

      <AlertsCard />

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
          Columns show playing handicap per round (course handicap × allowance) —{' '}
          <strong>before</strong> strokes come off the low man, so they are not the strokes you
          actually receive. Your real strokes show as * marks on the score entry page, which
          depend on the field in Round 1 and on your match in Rounds 2–5. Indexes get updated
          right before the trip in Admin.
        </p>
      </section>
    </div>
  );
}
