import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Course, Match, Pairing, Round, RoundStatus, RyderTeam, Trip } from '../api/types';
import { LODGING } from '../lodging';
import { liveRound, roundNickname, roundShort, statusLabel } from '../rounds';
import { localTime, zoneFor } from '../teeTimes';
import { useTrip } from '../hooks';

type Tab =
  | 'rounds'
  | 'players'
  | 'pairings'
  | 'teams'
  | 'matches'
  | 'courses'
  | 'lodging'
  | 'reset';

const TAB_LABELS: Record<Tab, string> = {
  rounds: 'rounds',
  players: 'players',
  pairings: 'R1 draw',
  teams: 'teams',
  matches: 'lineups',
  courses: 'courses',
  lodging: 'lodging',
  reset: 'reset',
};

export function AdminPage() {
  const trip = useTrip();
  const [tab, setTab] = useState<Tab>('rounds');
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['trip'] });
    void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    void queryClient.invalidateQueries({ queryKey: ['ryder'] });
  };

  const notify = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  if (trip.isLoading || !trip.data) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      <h1>Admin</h1>
      <div className="chip-row">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button key={t} className={`chip ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {message && <p className="form-success">{message}</p>}
      {tab === 'rounds' && <RoundsTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'players' && <PlayersTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'pairings' && <PairingsTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'teams' && <TeamsTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'matches' && <MatchesTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'courses' && <CoursesTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'lodging' && <LodgingTab trip={trip.data} onSaved={refresh} notify={notify} />}
      {tab === 'reset' && <ResetTab trip={trip.data} onSaved={refresh} notify={notify} />}
    </div>
  );
}

interface TabProps {
  trip: Trip;
  onSaved: () => void;
  notify: (msg: string) => void;
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  });
}

/** Start / end rounds — this is what scopes everyone's Score tab. */
function RoundsTab({ trip, onSaved, notify }: TabProps) {
  const live = liveRound(trip.rounds);

  const setStatus = async (round: Round, status: RoundStatus) => {
    const nick = roundNickname(round);
    if (status === 'live' && live && live.id !== round.id) {
      if (
        !window.confirm(
          `Start ${nick}? That ends ${roundNickname(live)} — everyone's Score tab moves to ${nick}.`,
        )
      )
        return;
    }
    if (status === 'final' && !window.confirm(`End ${nick}? Players can no longer enter scores for it (admins still can).`)) return;
    if (status === 'upcoming' && !window.confirm(`Put ${nick} back to "upcoming"? Scores are kept; it just stops being the live round.`)) return;
    await api(`/api/admin/rounds/${round.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    notify(status === 'live' ? `${nick} started` : status === 'final' ? `${nick} ended` : `${nick} reset`);
    onSaved();
  };

  return (
    <section className="card">
      <h2>Start &amp; end rounds</h2>
      <p className="muted small">
        Everyone&apos;s Score tab shows the <strong>live</strong> round only, and the Leaderboard
        offers rounds that have started plus the next one up. Start a round when the first group
        tees off and end it when the last card is in. Only one round is live at a time — starting
        the next one ends the current one.
      </p>
      {trip.rounds.map((r) => (
        <div key={r.id} className="round-admin-row">
          <div>
            <strong>
              {roundShort(trip.rounds, r)} · {roundNickname(r)}
            </strong>
            <span className={`status-badge ${r.status}`}>{statusLabel(r.status)}</span>
            <div className="muted small">
              {r.dayLabel}
              {r.startedAt ? ` · started ${fmtWhen(r.startedAt)}` : ''}
              {r.endedAt ? ` · ended ${fmtWhen(r.endedAt)}` : ''}
            </div>
          </div>
          <div className="row-actions">
            {r.status === 'upcoming' && (
              <button onClick={() => void setStatus(r, 'live')}>Start round</button>
            )}
            {r.status === 'live' && (
              <button onClick={() => void setStatus(r, 'final')}>End round</button>
            )}
            {r.status === 'final' && (
              <button className="ghost" onClick={() => void setStatus(r, 'live')}>
                Reopen
              </button>
            )}
            {r.status !== 'upcoming' && (
              <button className="ghost" onClick={() => void setStatus(r, 'upcoming')}>
                Reset
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

const LODGING_FIELDS: { key: string; label: string }[] = [
  ...LODGING.houses.map((h) => ({ key: h.codeKey, label: `${h.name} — front door code` })),
  { key: LODGING.confirmationKey, label: 'Guest guide confirmation number' },
];

/** Door codes live in the database, not the (public) source code. */
function LodgingTab({ trip, onSaved, notify }: TabProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(Object.fromEntries(LODGING_FIELDS.map((f) => [f.key, trip.settings?.[f.key] ?? ''])));
  }, [trip.settings]);

  const save = async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings: values }) });
    notify('Lodging info saved');
    onSaved();
  };

  return (
    <section className="card">
      <h2>Lodging</h2>
      <p className="muted small">
        Addresses, directions and the rental office number are built into the Trip page. The door
        codes and the guest-guide confirmation number are entered here instead, because the
        app&apos;s source code is public on GitHub — anything typed here is only shown to people
        signed in to the app. Leave a field blank to hide it.
      </p>
      {LODGING_FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input
            value={values[f.key] ?? ''}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        </label>
      ))}
      <button onClick={() => void save()}>Save lodging info</button>
    </section>
  );
}

function PlayersTab({ trip, onSaved, notify }: TabProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});

  const save = async (playerId: string) => {
    const raw = edits[playerId];
    const handicapIndex = Number(raw);
    if (raw == null || Number.isNaN(handicapIndex)) return;
    await api(`/api/admin/players/${playerId}`, {
      method: 'PUT',
      body: JSON.stringify({ handicapIndex }),
    });
    notify('Handicap saved');
    onSaved();
  };

  const resetLogin = async (playerId: string, name: string) => {
    if (!window.confirm(`Reset login for ${name}? They'll re-claim their profile.`)) return;
    await api(`/api/admin/players/${playerId}/reset-login`, { method: 'POST' });
    notify('Login reset');
    onSaved();
  };

  return (
    <section className="card">
      <h2>Players</h2>
      <p className="muted small">Update handicap indexes right before the trip.</p>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Index</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {trip.players.map((p) => (
            <tr key={p.id}>
              <td>
                {p.name}
                {p.isAdmin && ' ⭐'}
                <div className="muted small">{p.claimed ? 'claimed' : 'not claimed yet'}</div>
              </td>
              <td>
                <input
                  className="num-input"
                  type="number"
                  step="0.1"
                  defaultValue={p.handicapIndex}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </td>
              <td className="row-actions">
                <button onClick={() => void save(p.id)}>Save</button>
                {p.claimed && (
                  <button className="ghost" onClick={() => void resetLogin(p.id, p.name)}>
                    Reset login
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PairingsTab({ trip, onSaved, notify }: TabProps) {
  const round = trip.rounds.find((r) => r.format === 'bestball-qualifier');
  const zone = zoneFor(trip.courses.find((c) => c.id === round?.courseId));
  const [pairings, setPairings] = useState<Pairing[]>([]);

  useEffect(() => {
    if (round) setPairings(trip.pairings.filter((p) => p.roundId === round.id));
  }, [trip.pairings, round]);

  if (!round) return null;

  const randomize = async () => {
    if (pairings.length && !window.confirm('Redraw all Round 1 teams?')) return;
    await api('/api/admin/pairings/randomize', {
      method: 'POST',
      body: JSON.stringify({ roundId: round.id }),
    });
    notify('Teams drawn 🎲');
    onSaved();
  };

  const update = (i: number, patch: Partial<Pairing>) => {
    setPairings((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const save = async () => {
    await api('/api/admin/pairings', {
      method: 'PUT',
      body: JSON.stringify({ roundId: round.id, pairings }),
    });
    notify('Pairings saved');
    onSaved();
  };

  return (
    <section className="card">
      <h2>Round 1 — Random Draw</h2>
      <button onClick={() => void randomize()}>🎲 Draw random teams</button>
      {pairings.map((pairing, i) => (
        <div key={pairing.id} className="pairing-row">
          {[0, 1].map((slot) => (
            <select
              key={slot}
              value={pairing.playerIds[slot] ?? ''}
              onChange={(e) => {
                const ids = [...pairing.playerIds];
                ids[slot] = e.target.value;
                update(i, { playerIds: ids.filter(Boolean), name: '' });
              }}
            >
              <option value="">—</option>
              {trip.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ))}
          <select
            value={pairing.teeTime ?? ''}
            onChange={(e) => update(i, { teeTime: e.target.value || null })}
          >
            <option value="">tee time…</option>
            {round.teeTimes.map((t) => (
              <option key={t} value={t}>
                {localTime(t, zone)}
              </option>
            ))}
          </select>
        </div>
      ))}
      {pairings.length > 0 && <button onClick={() => void save()}>Save edits</button>}
    </section>
  );
}

function TeamsTab({ trip, onSaved, notify }: TabProps) {
  const [teams, setTeams] = useState<RyderTeam[]>(trip.ryderTeams);

  useEffect(() => setTeams(trip.ryderTeams), [trip.ryderTeams]);

  const toggle = (teamId: 'A' | 'B', playerId: string) => {
    setTeams((prev) =>
      prev.map((t) => {
        const without = t.playerIds.filter((id) => id !== playerId);
        if (t.id !== teamId) {
          return { ...t, playerIds: without, captainId: t.captainId === playerId ? null : t.captainId };
        }
        return t.playerIds.includes(playerId)
          ? { ...t, playerIds: without, captainId: t.captainId === playerId ? null : t.captainId }
          : { ...t, playerIds: [...without, playerId] };
      }),
    );
  };

  const save = async () => {
    await api('/api/admin/teams', { method: 'PUT', body: JSON.stringify({ teams }) });
    notify('Teams saved');
    onSaved();
  };

  return (
    <section className="card">
      <h2>Draft — Ryder Cup Teams</h2>
      <div className="team-grid">
        {teams.map((team) => (
          <div key={team.id} className="team-block" style={{ borderColor: team.color }}>
            <input
              value={team.name}
              onChange={(e) =>
                setTeams((prev) =>
                  prev.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t)),
                )
              }
            />
            <label className="muted small">
              Captain
              <select
                value={team.captainId ?? ''}
                onChange={(e) =>
                  setTeams((prev) =>
                    prev.map((t) =>
                      t.id === team.id ? { ...t, captainId: e.target.value || null } : t,
                    ),
                  )
                }
              >
                <option value="">—</option>
                {team.playerIds.map((id) => (
                  <option key={id} value={id}>
                    {trip.players.find((p) => p.id === id)?.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
      <table>
        <tbody>
          {trip.players.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              {teams.map((team) => (
                <td key={team.id}>
                  <button
                    className={team.playerIds.includes(p.id) ? '' : 'ghost'}
                    style={team.playerIds.includes(p.id) ? { background: team.color } : {}}
                    onClick={() => toggle(team.id, p.id)}
                  >
                    {team.name}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => void save()}>Save teams</button>
    </section>
  );
}

function MatchesTab({ trip, onSaved, notify }: TabProps) {
  const matchRounds = trip.rounds.filter((r) => r.matchCount > 0);
  const [roundId, setRoundId] = useState(matchRounds[0]?.id ?? '');
  const [matches, setMatches] = useState<Match[]>([]);

  const round = matchRounds.find((r) => r.id === roundId);
  const zone = zoneFor(trip.courses.find((c) => c.id === round?.courseId));
  const teamA = trip.ryderTeams.find((t) => t.id === 'A');
  const teamB = trip.ryderTeams.find((t) => t.id === 'B');
  const perSide = round?.format === 'singles' ? 1 : 2;

  useEffect(() => {
    if (!round) return;
    const existing = trip.matches.filter((m) => m.roundId === round.id);
    if (existing.length) setMatches(existing);
    else
      setMatches(
        Array.from({ length: round.matchCount }, (_, i) => ({
          id: `new-${round.id}-${i}`,
          roundId: round.id,
          teeTime: round.teeTimes[i % round.teeTimes.length] ?? null,
          sideA: [],
          sideB: [],
          result: null,
          closedAt: null,
        })),
      );
  }, [round, trip.matches]);

  if (!round || !teamA || !teamB) return null;

  const setSide = (mi: number, side: 'sideA' | 'sideB', slot: number, playerId: string) => {
    setMatches((prev) =>
      prev.map((m, idx) => {
        if (idx !== mi) return m;
        const ids = [...m[side]];
        ids[slot] = playerId;
        return { ...m, [side]: ids.filter(Boolean) };
      }),
    );
  };

  const save = async () => {
    await api('/api/admin/matches', {
      method: 'PUT',
      body: JSON.stringify({
        roundId: round.id,
        matches: matches.map((m) => ({
          id: m.id.startsWith('new-') ? undefined : m.id,
          sideA: m.sideA,
          sideB: m.sideB,
          teeTime: m.teeTime,
        })),
      }),
    });
    notify('Matches saved');
    onSaved();
  };

  const setResult = async (matchId: string, result: 'A' | 'B' | 'HALVED' | null) => {
    await api(`/api/admin/matches/${matchId}/result`, {
      method: 'PUT',
      body: JSON.stringify({ result }),
    });
    notify(result ? 'Result overridden' : 'Override cleared');
    onSaved();
  };

  // A player already placed in any match this round disappears from the other
  // dropdowns, so a lineup can't double-book anyone. The slot's own pick stays.
  const usedElsewhere = (current: string) => {
    const used = new Set(matches.flatMap((m) => [...m.sideA, ...m.sideB]));
    used.delete(current);
    return used;
  };
  const playerOptions = (teamIds: string[], current: string) => {
    const taken = usedElsewhere(current);
    return teamIds
      .filter((id) => !taken.has(id))
      .map((id) => (
        <option key={id} value={id}>
          {trip.players.find((p) => p.id === id)?.name}
        </option>
      ));
  };

  return (
    <section className="card">
      <h2>Match Lineups</h2>
      <div className="chip-row">
        {matchRounds.map((r) => (
          <button
            key={r.id}
            className={`chip ${r.id === roundId ? 'active' : ''}`}
            onClick={() => setRoundId(r.id)}
          >
            {roundNickname(r)}
          </button>
        ))}
      </div>
      <p className="muted small">{round.formatLabel}</p>
      {teamA.playerIds.length === 0 && (
        <p className="muted">Draft the teams first (Teams tab) — sides pull from each roster.</p>
      )}
      {matches.map((m, mi) => (
        <div key={m.id} className="match-editor">
          <div className="match-editor-row">
            <span className="muted small">M{mi + 1}</span>
            {Array.from({ length: perSide }, (_, slot) => (
              <select
                key={`a${slot}`}
                value={m.sideA[slot] ?? ''}
                onChange={(e) => setSide(mi, 'sideA', slot, e.target.value)}
              >
                <option value="">{teamA.name}…</option>
                {playerOptions(teamA.playerIds, m.sideA[slot] ?? '')}
              </select>
            ))}
            <span>vs</span>
            {Array.from({ length: perSide }, (_, slot) => (
              <select
                key={`b${slot}`}
                value={m.sideB[slot] ?? ''}
                onChange={(e) => setSide(mi, 'sideB', slot, e.target.value)}
              >
                <option value="">{teamB.name}…</option>
                {playerOptions(teamB.playerIds, m.sideB[slot] ?? '')}
              </select>
            ))}
            <select
              value={m.teeTime ?? ''}
              onChange={(e) =>
                setMatches((prev) =>
                  prev.map((x, idx) => (idx === mi ? { ...x, teeTime: e.target.value || null } : x)),
                )
              }
            >
              <option value="">tee…</option>
              {round.teeTimes.map((t) => (
                <option key={t} value={t}>
                  {localTime(t, zone)}
                </option>
              ))}
            </select>
          </div>
          {!m.id.startsWith('new-') && (
            <div className="match-editor-row">
              <span className="muted small">Override result:</span>
              <button className="ghost" onClick={() => void setResult(m.id, 'A')}>
                {teamA.name}
              </button>
              <button className="ghost" onClick={() => void setResult(m.id, 'HALVED')}>
                Halved
              </button>
              <button className="ghost" onClick={() => void setResult(m.id, 'B')}>
                {teamB.name}
              </button>
              {m.result && (
                <button className="ghost" onClick={() => void setResult(m.id, null)}>
                  Clear ({m.result})
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <button onClick={() => void save()}>Save lineups</button>
    </section>
  );
}

const RESET_PHRASE = 'RESET AND RESEED';

function ResetTab({ onSaved, notify }: TabProps) {
  const [phrase, setPhrase] = useState('');
  const [keepLogins, setKeepLogins] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    if (
      !window.confirm(
        'Wipe EVERYTHING — scores, pairings, teams, matches — and reload the app with the ' +
          'seeded trip data (players, courses, rounds). This cannot be undone. Continue?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/reset-database', {
        method: 'POST',
        body: JSON.stringify({ confirm: phrase, preserveLogins: keepLogins }),
      });
      setPhrase('');
      notify('Database wiped and re-seeded ✓');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ borderColor: '#b91c1c' }}>
      <h2>⚠️ Wipe &amp; re-seed the database</h2>
      <p className="muted small">
        Deletes everything — all scores, the Round 1 draw, drafted teams, and match lineups —
        then reloads the app with the built-in trip data: the 12 players, the five courses with
        their current seeded scorecards, and the five rounds. Use it to start completely fresh
        (for example after the seeded course info changes). It cannot be undone.
      </p>
      <label style={{ display: 'block', margin: '0.75rem 0' }}>
        <input
          type="checkbox"
          checked={keepLogins}
          onChange={(e) => setKeepLogins(e.target.checked)}
        />{' '}
        Keep everyone&apos;s logins (recommended — nobody has to re-register)
      </label>
      <label className="muted small" style={{ display: 'block' }}>
        Type <strong>{RESET_PHRASE}</strong> to confirm:
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={RESET_PHRASE}
          style={{ display: 'block', marginTop: '0.25rem' }}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button
        disabled={phrase !== RESET_PHRASE || busy}
        onClick={() => void reset()}
        style={{ background: '#b91c1c', marginTop: '0.75rem' }}
      >
        {busy ? 'Wiping…' : 'Wipe and re-seed'}
      </button>
    </section>
  );
}

function CoursesTab({ trip, onSaved, notify }: TabProps) {
  const [drafts, setDrafts] = useState<Record<string, Course>>({});

  const draftOf = (course: Course): Course => drafts[course.id] ?? course;

  const patch = (course: Course, changes: Partial<Course>) => {
    setDrafts((prev) => ({ ...prev, [course.id]: { ...draftOf(course), ...changes } }));
  };

  const save = async (courseId: string) => {
    const draft = drafts[courseId];
    if (!draft) return;
    await api(`/api/admin/courses/${courseId}`, {
      method: 'PUT',
      body: JSON.stringify({
        tee: draft.tee,
        par: draft.par,
        rating: draft.rating,
        slope: draft.slope,
        holes: draft.holes,
      }),
    });
    notify('Course saved');
    onSaved();
  };

  return (
    <section>
      <h2>Courses</h2>
      <p className="muted small">
        Seeded scorecards are placeholders — set the real tees, rating, slope, par, stroke
        indexes, and yardages from the printed cards before the trip. Yardages are blank until
        you enter them, and show as “—” on the score entry page.
      </p>
      {trip.courses.map((course) => {
        const draft = draftOf(course);
        return (
          <div key={course.id} className="card">
            <h3>{course.name}</h3>
            <div className="course-fields">
              <label>
                Tees
                <input value={draft.tee} onChange={(e) => patch(course, { tee: e.target.value })} />
              </label>
              <label>
                Par
                <input
                  className="num-input"
                  type="number"
                  value={draft.par}
                  onChange={(e) => patch(course, { par: Number(e.target.value) })}
                />
              </label>
              <label>
                Rating
                <input
                  className="num-input"
                  type="number"
                  step="0.1"
                  value={draft.rating}
                  onChange={(e) => patch(course, { rating: Number(e.target.value) })}
                />
              </label>
              <label>
                Slope
                <input
                  className="num-input"
                  type="number"
                  value={draft.slope}
                  onChange={(e) => patch(course, { slope: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="score-grid-wrap">
              <table className="score-grid compact">
                <thead>
                  <tr>
                    <th>Hole</th>
                    {draft.holes.map((h) => (
                      <th key={h.number}>{h.number}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Par</td>
                    {draft.holes.map((h, i) => (
                      <td key={h.number}>
                        <input
                          type="number"
                          min={3}
                          max={6}
                          value={h.par}
                          onChange={(e) => {
                            const holes = [...draft.holes];
                            holes[i] = { ...h, par: Number(e.target.value) };
                            patch(course, { holes });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Yards</td>
                    {draft.holes.map((h, i) => (
                      <td key={h.number}>
                        <input
                          type="number"
                          min={30}
                          max={800}
                          placeholder="—"
                          value={h.yards ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const holes = [...draft.holes];
                            holes[i] = { ...h, yards: raw === '' ? undefined : Number(raw) };
                            patch(course, { holes });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>SI</td>
                    {draft.holes.map((h, i) => (
                      <td key={h.number}>
                        <input
                          type="number"
                          min={1}
                          max={18}
                          value={h.strokeIndex}
                          onChange={(e) => {
                            const holes = [...draft.holes];
                            holes[i] = { ...h, strokeIndex: Number(e.target.value) };
                            patch(course, { holes });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <button disabled={!drafts[course.id]} onClick={() => void save(course.id)}>
              Save {course.name.split('—')[0].trim()}
            </button>
          </div>
        );
      })}
    </section>
  );
}
