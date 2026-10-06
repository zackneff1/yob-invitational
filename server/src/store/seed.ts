import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import { Course, Player, Round } from '../types';
import { courses2026 } from './courses2026';
import { prisma } from './prisma';

export function seedCourses(): Course[] {
  return courses2026();
}

export function seedRounds(): Round[] {
  // Every round starts out 'upcoming'; admins start and end them from Admin → Rounds.
  const fresh = { status: 'upcoming' as const, startedAt: null, endedAt: null, scoringSnapshot: null };
  return [
    {
      id: 'r1-conestoga',
      name: 'Round 1 — The Qualifier',
      courseId: 'conestoga',
      date: '2026-10-10',
      dayLabel: 'Saturday 10/10',
      teeTimes: ['1:20 PM', '1:30 PM', '1:40 PM'],
      format: 'bestball-qualifier',
      formatLabel: 'Two-man best ball, stroke play (85% handicap)',
      allowance: 0.85,
      playOffLow: true,
      matchCount: 0,
      description:
        'Randomly drawn two-man best ball teams, net stroke play. The winning team become the two captains. Live draft after the round.',
      ...fresh,
    },
    {
      id: 'r2-coral-canyon',
      name: 'Round 2 — Coral Canyon',
      courseId: 'coral-canyon',
      date: '2026-10-11',
      dayLabel: 'Sunday 10/11 AM',
      teeTimes: ['7:50 AM', '8:00 AM', '8:10 AM'],
      format: 'fourball',
      formatLabel: 'Four-ball match play — 3 matches, 1 pt each',
      allowance: 0.9,
      playOffLow: true,
      matchCount: 3,
      description:
        'Four-ball (best ball) match play, 2v2 — better net ball on each hole wins the hole.',
      ...fresh,
    },
    {
      id: 'r3-ledges',
      name: 'Round 3 — The Ledges',
      courseId: 'ledges',
      date: '2026-10-11',
      dayLabel: 'Sunday 10/11 PM',
      teeTimes: ['2:00 PM', '2:10 PM', '2:20 PM'],
      format: 'stableford',
      formatLabel: 'Two-man aggregate Stableford — 3 matches, 1 pt each',
      allowance: 0.95,
      playOffLow: true,
      matchCount: 3,
      description:
        'Both partners score Stableford points on every hole (net double bogey 0, bogey 1, par 2, birdie 3, eagle 4). Team total decides the match.',
      ...fresh,
    },
    {
      id: 'r4-sh-links',
      name: 'Round 4 — Sand Hollow Links',
      courseId: 'sand-hollow-links',
      date: '2026-10-12',
      dayLabel: 'Monday 10/12 AM',
      teeTimes: ['9:00 AM', '9:10 AM', '9:20 AM'],
      format: 'scramble',
      formatLabel: 'Two-man scramble, 9 holes — 3 matches, 1 pt each',
      allowance: 1,
      playOffLow: true,
      matchCount: 3,
      description:
        'Two-man scramble over 9 holes, head to head net.',
      ...fresh,
    },
    {
      id: 'r5-sh-champ',
      name: 'Round 5 — The Singles Closer',
      courseId: 'sand-hollow-champ',
      date: '2026-10-12',
      dayLabel: 'Monday 10/12 PM',
      teeTimes: ['12:46 PM', '12:56 PM', '1:06 PM'],
      format: 'singles',
      formatLabel: 'Singles match play — 6 matches, 1 pt each',
      allowance: 1,
      playOffLow: true,
      matchCount: 6,
      description:
        'Head-to-head singles match play at Sand Hollow Championship. 6 points on the board — the closer.',
      ...fresh,
    },
  ];
}

export function seedPlayers(): Player[] {
  const p = (id: string, name: string, handicapIndex: number, isAdmin = false): Player => ({
    id,
    name,
    email: null,
    passwordHash: null,
    isAdmin,
    handicapIndex,
  });
  return [
    { ...p('neffy', 'Neffy', 5.9, true), email: 'zack@getporter.io' },
    p('aaron', 'Aaron', 13.8, true),
    p('cousin-will', 'Cousin Will', 12.0),
    p('douglas', 'Douglas', 19.5),
    p('jakob', 'Jakob', 5.9),
    p('meesa', 'Meesa', 20.3),
    p('schmoo', 'Schmoo', 25.0),
    p('raider', 'Raider', 9.8),
    p('little-gerb', 'Little Gerb', 6.9),
    p('big-gerb', 'Big Gerb', 14.8),
    p('darren', 'Darren', 6.9),
    p('steen', 'Steen', 11.3),
  ];
}

async function insertSeedData(tx: Prisma.TransactionClient): Promise<void> {
  await tx.player.createMany({ data: seedPlayers() });
  await tx.course.createMany({
    data: seedCourses().map((c) => ({
      ...c,
      holes: c.holes as unknown as Prisma.InputJsonValue,
    })),
  });
  await tx.round.createMany({
    data: seedRounds().map(({ scoringSnapshot: _snapshot, ...r }) => ({
      ...r,
      startedAt: null,
      endedAt: null,
    })),
  });
  await tx.ryderTeam.createMany({
    data: [
      { id: 'A', name: 'Team A', color: '#1d4ed8', captainId: null, playerIds: [] },
      { id: 'B', name: 'Team B', color: '#b91c1c', captainId: null, playerIds: [] },
    ],
  });
}

/** One-time bootstrap: populate an empty database with the 2026 trip. */
export async function ensureSeeded(): Promise<void> {
  const playerCount = await prisma.player.count();
  if (playerCount > 0) return;
  await prisma.$transaction((tx) => insertSeedData(tx));
  logger.info('seeded database with the 2026 trip');
}

/**
 * Wipe everything and reload the seed data — the "mass change admin info"
 * escape hatch behind POST /api/admin/reset-database. With preserveLogins
 * (the default) each player's claimed email + password is carried across,
 * matched by player id, so nobody has to re-register after a reset.
 */
export async function resetAndReseed(
  preserveLogins: boolean,
): Promise<{ restoredLogins: string[] }> {
  return prisma.$transaction(async (tx) => {
    const logins = preserveLogins
      ? await tx.player.findMany({
          where: { passwordHash: { not: null } },
          select: { id: true, email: true, passwordHash: true },
        })
      : [];
    // Delete in dependency order — scores reference rounds and players,
    // pairings/matches/rounds reference rounds and courses.
    await tx.score.deleteMany();
    await tx.match.deleteMany();
    await tx.pairing.deleteMany();
    await tx.round.deleteMany();
    await tx.course.deleteMany();
    await tx.ryderTeam.deleteMany();
    await tx.player.deleteMany();
    // Settings (lodging door codes etc.) deliberately survive a reset.
    await insertSeedData(tx);
    const restoredLogins: string[] = [];
    for (const login of logins) {
      const updated = await tx.player.updateMany({
        where: { id: login.id },
        data: { email: login.email, passwordHash: login.passwordHash },
      });
      if (updated.count > 0) restoredLogins.push(login.id);
    }
    logger.warn({ preserveLogins, restoredLogins }, 'database wiped and re-seeded');
    return { restoredLogins };
  });
}
