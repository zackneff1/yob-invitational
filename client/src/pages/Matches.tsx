import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ComputedMatch, QualifierRow, Round, RyderTeam } from '../api/types';
import { MatchScoreboard } from '../components/MatchScoreboard';
import { useRoundLeaderboard, useTrip } from '../hooks';
import { sidesFromComputed, stateFromComputed } from '../matchState';
import { handicapRule } from '../roundRules';
import {
  defaultLeaderboardRound,
  leaderboardRounds,
  roundNickname,
  roundShort,
  statusLabel,
} from '../rounds';
import { TeeZone, localTime, zoneFor } from '../teeTimes';

function fmtToPar(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

function fmtPoints(p: number): string {
  const whole = Math.floor(p);
  const half = p - whole === 0.5;
  if (whole === 0 && half) return '½';
  return `${whole}${half ? '½' : ''}`;
}

/** One match, Ryder Cup style. Shared with the Cup page. */
export function MatchCard({ match, zone }: { match: ComputedMatch; zone?: TeeZone | null }) {
  const sides = sidesFromComputed(match);
  return (
    <div className={`card rc-card ${match.final ? 'match-final' : ''}`}>
      <MatchScoreboard
        state={stateFromComputed(match)}
        sideA={sides.A}
        sideB={sides.B}
        teeTime={match.teeTime ? localTime(match.teeTime, zone ?? null) : null}
      />
      {!match.final && (match.missing?.length ?? 0) > 0 && (
        <p className="muted small rc-missing">
          Awaiting:{' '}
          {match.missing!.map((m) => `${m.name} (hole${m.holes.length > 1 ? 's' : ''} ${m.holes.join(', ')})`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/** The round's running score: confirmed points won so far, like a Ryder Cup session board. */
function RoundScoreboard({ matches, teams }: { matches: ComputedMatch[]; teams: RyderTeam[] }) {
  const a = teams.find((t) => t.id === 'A');
  const b = teams.find((t) => t.id === 'B');
  if (!a || !b) return null;
  const sum = (pick: (m: ComputedMatch) => number) => matches.reduce((s, m) => s + pick(m), 0);
  const ptsA = sum((m) => m.points.A);
  const ptsB = sum((m) => m.points.B);
  const projA = sum((m) => m.provisionalPoints.A);
  const projB = sum((m) => m.provisionalPoints.B);
  const finals = matches.filter((m) => m.final).length;
  return (
    <div className="card rc-session">
      <div className="rc-session-team" style={{ color: a.color }}>
        <span className="rc-session-name">{a.name}</span>
        <span className="rc-session-pts">{fmtPoints(ptsA)}</span>
        {projA !== ptsA && <span className="rc-session-proj">proj {fmtPoints(projA)}</span>}
      </div>
      <div className="rc-session-mid">
        <span>{matches.length} matches</span>
        <span>{finals === matches.length ? 'all final' : `${finals} final`}</span>
      </div>
      <div className="rc-session-team right" style={{ color: b.color }}>
        <span className="rc-session-name">{b.name}</span>
        <span className="rc-session-pts">{fmtPoints(ptsB)}</span>
        {projB !== ptsB && <span className="rc-session-proj">proj {fmtPoints(projB)}</span>}
      </div>
    </div>
  );
}

/** Re-renders every few seconds so "updated Ns ago" keeps counting. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function StatusBadge({ round }: { round: Round }) {
  if (round.status === 'upcoming') return <span className="status-badge upcoming">Up next</span>;
  return <span className={`status-badge ${round.status}`}>{statusLabel(round.status)}</span>;
}

function positionLabel(row: QualifierRow): string {
  if (row.noReturn) return 'NR';
  if (row.position == null || row.thru === 0) return '—';
  return `${row.tied ? 'T' : ''}${row.position}`;
}

function BasisNote({ frozen, snapshotMissing }: { frozen?: boolean; snapshotMissing?: boolean }) {
  if (snapshotMissing) {
    return (
      <p className="tz-note">
        ⚠️ This round was started before scoring settings were frozen, so it is scored from the
        current settings.
      </p>
    );
  }
  if (frozen) return <p className="muted small">Scored on the settings frozen when the round started.</p>;
  return null;
}

export function MatchesPage() {
  const { roundId } = useParams();
  const trip = useTrip();
  const now = useNow(5000);

  const allRounds = trip.data?.rounds ?? [];
  // Only rounds that have started (plus the next one up) are offered — nobody
  // needs an empty board for Monday on Saturday afternoon.
  const visible = leaderboardRounds(allRounds);
  const requested = visible.find((r) => r.id === roundId);
  const activeRound = requested ?? defaultLeaderboardRound(visible);
  const board = useRoundLeaderboard(activeRound?.id);
  const zone = zoneFor(trip.data?.courses.find((c) => c.id === activeRound?.courseId));

  if (trip.isLoading) return <p className="muted">Loading…</p>;

  const agoSec = board.dataUpdatedAt ? Math.max(0, Math.round((now - board.dataUpdatedAt) / 1000)) : null;
  const playerName = (id: string) => trip.data?.players.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <button
          className="ghost refresh-btn"
          onClick={() => void board.refetch()}
          disabled={board.isFetching}
          title="Refresh now"
        >
          {board.isFetching ? 'Updating…' : agoSec == null ? 'Refresh' : `Updated ${agoSec}s ago ↻`}
        </button>
      </div>
      {visible.length > 1 && (
        <div className="chip-row">
          {visible.map((r) => (
            <Link
              key={r.id}
              to={`/leaderboard/${r.id}`}
              className={`chip ${r.id === activeRound?.id ? 'active' : ''}`}
            >
              {roundShort(allRounds, r)}
              {r.status === 'live' && <span className="chip-tag live">Live</span>}
            </Link>
          ))}
        </div>
      )}

      {activeRound && (
        <p className="muted">
          <strong className="text">{roundNickname(activeRound)}</strong> · {activeRound.formatLabel}{' '}
          <StatusBadge round={activeRound} />
        </p>
      )}

      {board.isLoading && <p className="muted">Loading leaderboard…</p>}

      {board.data?.type === 'qualifier' && (
        <>
          <p className="rule-line">
            <strong>Handicaps:</strong> {handicapRule(board.data.round)} Winners are the captains.
          </p>
          <BasisNote frozen={board.data.frozen} snapshotMissing={board.data.snapshotMissing} />
          {board.data.tieForFirst && (() => {
            const rows = board.data.rows;
            const tie = board.data.tieForFirst;
            const nameOf = (id: string) => rows.find((r) => r.pairingId === id)?.name ?? id;
            return (
              <div className="card tie-banner">
                <strong>Tied for first:</strong> {tie.pairingIds.map(nameOf).join(' and ')}.{' '}
                {tie.resolution ? (
                  <>
                    Resolved by the organizers: <strong>{nameOf(tie.resolution.pairingId)}</strong> are
                    the captains — “{tie.resolution.reason}” (recorded by {playerName(tie.resolution.by)}).
                  </>
                ) : (
                  <>Captain selection needs an organizer decision; an admin records it under Admin → rounds.</>
                )}
              </div>
            );
          })()}
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
                  <tr key={row.pairingId} className={row.position === 1 && !row.noReturn ? 'leader-row' : ''}>
                    <td>{positionLabel(row)}</td>
                    <td>
                      {row.name}
                      <div className="muted small">
                        {row.players.map((p) => `${p.name} (${p.effectiveHandicap})`).join(' · ')}
                        {row.teeTime ? ` · ${localTime(row.teeTime, zone)}` : ''}
                        {row.noReturn ? ' · no return on a hole' : ''}
                      </div>
                    </td>
                    <td>{row.thru || '—'}</td>
                    <td>{row.thru && !row.noReturn ? row.net : '—'}</td>
                    <td>
                      <strong>{row.thru && !row.noReturn ? fmtToPar(row.toPar) : '—'}</strong>
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
          {board.data.matches.length > 0 && trip.data && (
            <RoundScoreboard matches={board.data.matches} teams={trip.data.ryderTeams} />
          )}
          <p className="rule-line">
            <strong>Handicaps:</strong> {handicapRule(board.data.round)}
          </p>
          <BasisNote
            frozen={board.data.matches[0]?.frozen}
            snapshotMissing={board.data.matches[0]?.snapshotMissing}
          />
          {board.data.matches.length === 0 && (
            <p className="muted">Matches not set yet — captains submit lineups to the admins.</p>
          )}
          {board.data.matches.map((m) => (
            <MatchCard key={m.id} match={m} zone={zone} />
          ))}
          <p className="muted small">
            Points count only when every ball on the counted holes is in. A dashed result is
            provisional — a partner’s score is still on its way.
          </p>
        </>
      )}
    </div>
  );
}
