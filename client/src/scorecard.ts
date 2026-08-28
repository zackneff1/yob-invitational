// Shared scorecard logic used by both score-entry views: the hole-by-hole
// play view and the full-card grid.
import { Course, Hole, Trip } from './api/types';

export interface Column {
  entityType: 'player' | 'side';
  entityId: string;
  label: string;
  /** Strokes this player (or scramble side) receives over the round, after the
   *  round's allowance and any play-off-the-low-man reduction. */
  effectiveHandicap: number;
}

export interface Group {
  id: string;
  label: string;
  columns: Column[];
}

/** Reads the current gross score for a column on a hole, '' when unplayed. */
export type ValueFor = (col: Column, hole: number) => number | '';

/**
 * Strokes received on one hole for a given handicap, allocated by stroke index.
 * Hand-mirrored from `strokesOnHole` in server/src/services/scoring.ts — the
 * client shares no module with the server, so if that math ever changes this
 * copy has to change with it. Display only; the server still does the scoring.
 */
export function strokesOnHole(ph: number, strokeIndex: number, holeCount: number): number {
  if (ph === 0) return 0;
  const abs = Math.abs(ph);
  const base = Math.floor(abs / holeCount);
  const rem = abs % holeCount;
  const extra = ph > 0 ? strokeIndex <= rem : strokeIndex > holeCount - rem;
  return (base + (extra ? 1 : 0)) * Math.sign(ph);
}

/** Mirror of `stablefordPoints` on the server: par 2, birdie 3, bogey 1. */
export function stablefordPoints(net: number, par: number): number {
  return Math.max(0, 2 + par - net);
}

/** Strokes a column gets on one specific hole. */
export function strokesForHole(course: Course, col: Column, hole: Hole): number {
  return strokesOnHole(col.effectiveHandicap, hole.strokeIndex, course.holes.length);
}

/** Only meaningful once every hole has a yardage — a partial sum would read
 *  like a real course length and be wrong. */
export function totalYardsOf(course: Course): number | null {
  return course.holes.every((h) => typeof h.yards === 'number')
    ? course.holes.reduce((sum, h) => sum + (h.yards ?? 0), 0)
    : null;
}

export interface ColumnStats {
  thru: number;
  gross: number;
  net: number;
  points: number;
}

/** Running totals for one column across every hole scored so far. */
export function statsFor(course: Course, col: Column, valueFor: ValueFor): ColumnStats {
  const stats: ColumnStats = { thru: 0, gross: 0, net: 0, points: 0 };
  for (const hole of course.holes) {
    const gross = valueFor(col, hole.number);
    if (typeof gross !== 'number') continue;
    const net = gross - strokesForHole(course, col, hole);
    stats.thru += 1;
    stats.gross += gross;
    stats.net += net;
    stats.points += stablefordPoints(net, hole.par);
  }
  return stats;
}

/**
 * Build the score-entry groups for a round: tee-time groups for the qualifier,
 * one group per match for Ryder Cup rounds. `labelTeeTime` formats a tee time
 * for display (the caller owns timezone handling).
 */
export function buildGroups(
  trip: Trip,
  roundId: string,
  labelTeeTime: (t: string) => string,
): Group[] {
  const round = trip.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const nameOf = (id: string) => trip.players.find((p) => p.id === id)?.name ?? id;
  const hcpOf = (id: string) => round.courseHandicaps.find((c) => c.playerId === id);
  const playingOf = (id: string) => hcpOf(id)?.playingHandicap ?? 0;
  const courseHcpOf = (id: string) => hcpOf(id)?.courseHandicap ?? 0;

  /** Strokes each player gets, off the low man in the group passed in — the
   *  whole field for the qualifier, the match for Rounds 2-5. Mirrors
   *  handicapInfoFor on the server so these markers match the leaderboard. */
  const effectiveOf = (playerIds: string[]): Map<string, number> => {
    const phs = playerIds.map(playingOf);
    const low = phs.length > 1 ? Math.min(...phs) : 0;
    return new Map(playerIds.map((id, i) => [id, phs[i] - low]));
  };

  /** Scramble team handicap: 35% of the low course handicap + 15% of the high. */
  const teamHandicapOf = (playerIds: string[]): number => {
    const chs = playerIds.map(courseHcpOf).sort((a, b) => a - b);
    const low = chs[0] ?? 0;
    const high = chs[chs.length - 1] ?? 0;
    return Math.round(0.35 * low + 0.15 * high);
  };

  if (round.format === 'bestball-qualifier') {
    const pairings = trip.pairings.filter((p) => p.roundId === roundId);
    const byTime = new Map<string, typeof pairings>();
    for (const p of pairings) {
      const key = p.teeTime ?? 'Unassigned';
      byTime.set(key, [...(byTime.get(key) ?? []), p]);
    }
    // Off the low man across the whole 12-man field, not each pair.
    const fieldEff = effectiveOf([...new Set(pairings.flatMap((p) => p.playerIds))]);
    return [...byTime.entries()].map(([teeTime, group]) => ({
      id: `tee-${teeTime}`,
      label: `${labelTeeTime(teeTime)} — ${group.map((g) => g.name).join(' & ')}`,
      columns: group.flatMap((g) =>
        g.playerIds.map((pid) => ({
          entityType: 'player' as const,
          entityId: pid,
          label: nameOf(pid),
          effectiveHandicap: fieldEff.get(pid) ?? 0,
        })),
      ),
    }));
  }

  const matches = trip.matches.filter((m) => m.roundId === roundId);
  const teamName = (side: 'A' | 'B') => trip.ryderTeams.find((t) => t.id === side)?.name ?? side;

  return matches.map((m, i) => {
    const label = `Match ${i + 1}: ${m.sideA.map(nameOf).join('/')} vs ${m.sideB.map(nameOf).join('/')}`;
    if (round.format === 'scramble') {
      // Sides play off the lower team handicap, as the server does.
      const thA = teamHandicapOf(m.sideA);
      const thB = teamHandicapOf(m.sideB);
      const low = Math.min(thA, thB);
      return {
        id: m.id,
        label,
        columns: [
          {
            entityType: 'side' as const,
            entityId: `${m.id}:A`,
            label: teamName('A'),
            effectiveHandicap: thA - low,
          },
          {
            entityType: 'side' as const,
            entityId: `${m.id}:B`,
            label: teamName('B'),
            effectiveHandicap: thB - low,
          },
        ],
      };
    }
    // Four-ball, Stableford and singles: strokes are worked out across the
    // whole match, not per side.
    const playerIds = [...m.sideA, ...m.sideB];
    const eff = effectiveOf(playerIds);
    return {
      id: m.id,
      label,
      columns: playerIds.map((pid) => ({
        entityType: 'player' as const,
        entityId: pid,
        label: nameOf(pid),
        effectiveHandicap: eff.get(pid) ?? 0,
      })),
    };
  });
}
