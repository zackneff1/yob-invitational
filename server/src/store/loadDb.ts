import { DB, Hole, MatchResult, RoundFormat, RoundStatus, ScoreEntityType } from '../types';
import { prisma } from './prisma';

/**
 * Read-only snapshot of the whole event, shaped for the pure scoring and
 * leaderboard services. The dataset is tiny (12 players, 5 rounds, a few
 * thousand hole scores at most), so loading it whole keeps the computation
 * code simple and easily testable.
 */
export async function loadDb(): Promise<DB> {
  const [users, courses, rounds, pairings, ryderTeams, matches, scores, settings] =
    await Promise.all([
      prisma.player.findMany({ orderBy: { name: 'asc' } }),
      prisma.course.findMany(),
      prisma.round.findMany({ orderBy: { id: 'asc' } }),
      prisma.pairing.findMany({ orderBy: [{ teeTime: 'asc' }, { id: 'asc' }] }),
      prisma.ryderTeam.findMany({ orderBy: { id: 'asc' } }),
      prisma.match.findMany({ orderBy: [{ teeTime: 'asc' }, { id: 'asc' }] }),
      prisma.score.findMany(),
      prisma.setting.findMany(),
    ]);
  return {
    users,
    courses: courses.map((c) => ({
      ...c,
      holes: c.holes as unknown as Hole[],
      notes: c.notes ?? undefined,
    })),
    rounds: rounds.map((r) => ({
      ...r,
      format: r.format as RoundFormat,
      status: r.status as RoundStatus,
      startedAt: r.startedAt?.getTime() ?? null,
      endedAt: r.endedAt?.getTime() ?? null,
    })),
    pairings,
    ryderTeams: ryderTeams.map((t) => ({ ...t, id: t.id as 'A' | 'B' })),
    matches: matches.map((m) => ({
      ...m,
      result: m.result as MatchResult,
      closedAt: m.closedAt?.getTime() ?? null,
    })),
    scores: scores.map((s) => ({
      ...s,
      entityType: s.entityType as ScoreEntityType,
      updatedAt: s.updatedAt.getTime(),
    })),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  };
}
