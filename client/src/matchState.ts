import { ComputedMatch, MatchReading, RoundFormat } from './api/types';

/**
 * Where a Ryder Cup match stands, in the terms match play is actually talked
 * about: who is up, by how much, and through how many holes. Net scores never
 * appear here — in match play they only matter hole by hole.
 *
 * Two readings live side by side. The *confirmed* one counts only holes where
 * every ball is in (a score or an explicit pickup); it is the only reading
 * that can make a match final or award a point. The *provisional* one counts
 * everything that has arrived, so a group whose partner's phone hasn't synced
 * still sees the match moving — labelled as provisional.
 *
 * Built from the server's computed match on the leaderboard pages, and from
 * the scores on the phone on the score page, so both render identically.
 */
export interface MatchState {
  format: RoundFormat;
  holeCount: number;
  /** Confirmed reading. */
  thru: number;
  leader: 'A' | 'B' | null;
  /** Holes up (match play), points ahead (Stableford), strokes ahead (scramble). */
  margin: number;
  final: boolean;
  /** Holes left when closed out early — the "2" in "3&2". */
  closeoutRemaining: number;
  /** Running totals for the formats that have them (Stableford pts, scramble net). */
  totals?: { A: number; B: number; unit: string };
  /** Provisional reading (may be ahead of the confirmed one). */
  provisional?: MatchReading;
  /** Holes inside the provisional reading still missing a ball. */
  unresolvedHoles?: number[];
  overridden?: boolean;
}

export function stateFromComputed(m: ComputedMatch): MatchState {
  return {
    format: m.format,
    holeCount: m.holeCount,
    thru: m.thru,
    leader: m.leader,
    margin: m.margin,
    final: m.final,
    closeoutRemaining: m.closeoutRemaining,
    totals: m.detail ? { A: m.detail.totalA, B: m.detail.totalB, unit: m.detail.unit } : undefined,
    provisional: m.provisional,
    unresolvedHoles: m.unresolvedHoles ?? [],
    overridden: m.overridden,
  };
}

/** One side of a match as the scoreboard draws it. */
export interface ScoreboardSide {
  name: string;
  color: string;
  players: { label: string; strokes: number }[];
  /** Scramble: strokes the side receives as a team (players carry none). */
  strokes?: number;
}

export function sidesFromComputed(m: ComputedMatch): { A: ScoreboardSide; B: ScoreboardSide } {
  const isScramble = m.format === 'scramble';
  const side = (s: ComputedMatch['sideA'], which: 'A' | 'B'): ScoreboardSide => ({
    name: s.teamName,
    color: s.color,
    players: s.players.map((p) => ({
      label: p.name,
      strokes: isScramble ? 0 : p.effectiveHandicap,
    })),
    strokes: isScramble ? m.sideStrokes?.[which] : undefined,
  });
  return { A: side(m.sideA, 'A'), B: side(m.sideB, 'B') };
}

export interface MatchReadout {
  /** The big number in the middle: "2 UP", "AS", "3&2", "24–21". */
  big: string;
  /** Under it: "thru 12", "Final", "pending · 1 score missing". */
  sub: string;
  /** Which side the big number belongs to (colours the pill). */
  tone: 'A' | 'B' | null;
  /** The reading shown is provisional (a score is still missing somewhere). */
  provisional: boolean;
}

/** The reading to show: confirmed once final, else the provisional one if it is ahead. */
function readingToShow(s: MatchState): { r: MatchReading; provisional: boolean } {
  const confirmed: MatchReading = {
    thru: s.thru,
    leader: s.leader,
    margin: s.margin,
    decided: s.closeoutRemaining > 0,
    closeoutRemaining: s.closeoutRemaining,
    complete: s.final,
    totals: s.totals,
  };
  if (s.final || !s.provisional) return { r: confirmed, provisional: false };
  const unresolved = (s.unresolvedHoles?.length ?? 0) > 0;
  if (s.provisional.thru > confirmed.thru || unresolved) return { r: s.provisional, provisional: unresolved };
  return { r: confirmed, provisional: false };
}

/** How the Ryder Cup writes a match: "2 UP" live, "3&2" / "1 UP" / "HALVED" final, "AS" level. */
export function describeMatch(s: MatchState, teamNames?: { A: string; B: string }): MatchReadout {
  const isMatchPlay = s.format === 'fourball' || s.format === 'singles';
  const { r, provisional } = readingToShow(s);
  const missing = s.unresolvedHoles?.length ?? 0;
  const pendingTag = missing > 0 ? ` · ${missing} hole${missing > 1 ? 's' : ''} awaiting scores` : '';
  if (r.thru === 0 && !s.final) return { big: 'vs', sub: 'Not started', tone: null, provisional: false };
  const finalTag = s.overridden ? 'Final · admin' : 'Final';

  if (isMatchPlay) {
    if (s.final) {
      if (!r.leader) return { big: 'HALVED', sub: finalTag, tone: null, provisional: false };
      const big = r.closeoutRemaining > 0 ? `${r.margin}&${r.closeoutRemaining}` : `${r.margin} UP`;
      return { big, sub: finalTag, tone: r.leader, provisional: false };
    }
    if (r.complete) {
      // Would be over, but a ball is still missing somewhere in the counted holes.
      const big = !r.leader ? 'HALVED' : r.closeoutRemaining > 0 ? `${r.margin}&${r.closeoutRemaining}` : `${r.margin} UP`;
      return { big, sub: `pending${pendingTag}`, tone: r.leader, provisional: true };
    }
    if (!r.leader) return { big: 'AS', sub: `thru ${r.thru}${provisional ? ' (prov.)' : ''}${pendingTag}`, tone: null, provisional };
    return { big: `${r.margin} UP`, sub: `thru ${r.thru}${provisional ? ' (prov.)' : ''}${pendingTag}`, tone: r.leader, provisional };
  }

  // Stableford (points) and scramble (net strokes): the totals are the story,
  // with the leader's side coloured in.
  const t = r.totals ?? { A: 0, B: 0, unit: '' };
  const big = `${t.A}–${t.B}`;
  const who = r.leader && teamNames ? `${teamNames[r.leader]} by ${r.margin}` : r.leader ? `by ${r.margin}` : 'tied';
  if (s.final) {
    const result = !r.leader ? 'Halved' : who;
    return { big, sub: `${finalTag} · ${result} · ${t.unit}`, tone: r.leader, provisional: false };
  }
  return {
    big,
    sub: `${who} · thru ${r.thru} · ${t.unit}${provisional ? ' (prov.)' : ''}${pendingTag}`,
    tone: r.leader,
    provisional,
  };
}

/** One-line version for alerts and status bars: "Team Neffy wins 3&2". */
export function matchSentence(s: MatchState, teamNames: { A: string; B: string }): string {
  const r = describeMatch(s, teamNames);
  const isMatchPlay = s.format === 'fourball' || s.format === 'singles';
  if (s.final) {
    if (!s.leader) return isMatchPlay ? 'Match halved' : `Match halved ${r.big}`;
    return isMatchPlay
      ? `${teamNames[s.leader]} wins ${r.big}`
      : `${teamNames[s.leader]} wins ${r.big}${s.totals ? ` ${s.totals.unit}` : ''}`;
  }
  const { r: reading } = readingToShow(s);
  if (reading.thru === 0) return 'Not started';
  const tag = r.provisional ? ' (provisional)' : '';
  if (!reading.leader) return isMatchPlay ? `All square thru ${reading.thru}${tag}` : `Tied ${r.big} thru ${reading.thru}${tag}`;
  return isMatchPlay
    ? `${teamNames[reading.leader]} ${reading.margin} UP thru ${reading.thru}${tag}`
    : `${teamNames[reading.leader]} up ${r.big} thru ${reading.thru}${tag}`;
}
