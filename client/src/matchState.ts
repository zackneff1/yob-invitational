import { ComputedMatch, RoundFormat } from './api/types';

/**
 * Where a Ryder Cup match stands, in the terms match play is actually talked
 * about: who is up, by how much, and through how many holes. Net scores never
 * appear here — in match play they only matter hole by hole.
 *
 * Built from the server's computed match on the leaderboard pages, and from
 * the scores on the phone on the score page, so both render identically.
 */
export interface MatchState {
  format: RoundFormat;
  thru: number;
  holeCount: number;
  leader: 'A' | 'B' | null;
  /** Holes up (match play), points ahead (Stableford), strokes ahead (scramble). */
  margin: number;
  final: boolean;
  /** Holes left when closed out early — the "2" in "3&2". */
  closeoutRemaining: number;
  /** Running totals for the formats that have them (Stableford pts, scramble net). */
  totals?: { A: number; B: number; unit: string };
  overridden?: boolean;
}

export function stateFromComputed(m: ComputedMatch): MatchState {
  return {
    format: m.format,
    thru: m.thru,
    holeCount: m.holeCount,
    leader: m.leader,
    margin: m.margin,
    final: m.final,
    closeoutRemaining: m.closeoutRemaining,
    totals: m.detail
      ? { A: m.detail.totalA, B: m.detail.totalB, unit: m.detail.unit }
      : undefined,
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
  /** Under it: "thru 12", "Final", "Not started". */
  sub: string;
  /** Which side the big number belongs to (colours the pill). */
  tone: 'A' | 'B' | null;
}

/** How the Ryder Cup writes a match: "2 UP" live, "3&2" / "1 UP" / "HALVED" final, "AS" level. */
export function describeMatch(s: MatchState, teamNames?: { A: string; B: string }): MatchReadout {
  const isMatchPlay = s.format === 'fourball' || s.format === 'singles';
  if (s.thru === 0 && !s.final) return { big: 'vs', sub: 'Not started', tone: null };
  const finalTag = s.overridden ? 'Final · admin' : 'Final';

  if (isMatchPlay) {
    if (s.final) {
      if (!s.leader) return { big: 'HALVED', sub: finalTag, tone: null };
      const big = s.closeoutRemaining > 0 ? `${s.margin}&${s.closeoutRemaining}` : `${s.margin} UP`;
      return { big, sub: finalTag, tone: s.leader };
    }
    if (!s.leader) return { big: 'AS', sub: `thru ${s.thru}`, tone: null };
    return { big: `${s.margin} UP`, sub: `thru ${s.thru}`, tone: s.leader };
  }

  // Stableford (points) and scramble (net strokes): the totals are the story,
  // with the leader's side coloured in.
  const t = s.totals ?? { A: 0, B: 0, unit: '' };
  const big = `${t.A}–${t.B}`;
  const who = s.leader && teamNames ? `${teamNames[s.leader]} by ${s.margin}` : s.leader ? `by ${s.margin}` : 'tied';
  if (s.final) {
    const result = !s.leader ? 'Halved' : who;
    return { big, sub: `${finalTag} · ${result} · ${t.unit}`, tone: s.leader };
  }
  return { big, sub: `${who} · thru ${s.thru} · ${t.unit}`, tone: s.leader };
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
  if (s.thru === 0) return 'Not started';
  if (!s.leader) return isMatchPlay ? `All square thru ${s.thru}` : `Tied ${r.big} thru ${s.thru}`;
  return isMatchPlay
    ? `${teamNames[s.leader]} ${s.margin} UP thru ${s.thru}`
    : `${teamNames[s.leader]} up ${r.big} thru ${s.thru}`;
}
