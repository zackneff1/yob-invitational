import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import { Course, Player, Round } from '../types';
import { courses2026 } from './courses2026';
import { prisma } from './prisma';

export function seedCourses(): Course[] {
  return courses2026();
}

export function seedRounds(): Round[] {
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
        'Randomly drawn two-man best ball teams, net stroke play at 85% of course handicap, strokes off the low man across the full 12-man field. The winning team become the two captains. Live draft after the round.',
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
        'Four-ball (best ball) match play, 2v2. 90% allowance, strokes off the low man in the match.',
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
        'Both partners score Stableford points on every hole (net double bogey 0, bogey 1, par 2, birdie 3, eagle 4). Team total decides the match. 95% allowance, strokes off the low man in the match.',
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
        'Two-man scramble over 9 holes, head to head net. Team handicap = 35% of low + 15% of high course handicap.',
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
        'Head-to-head singles match play at Sand Hollow Championship. Full handicap, strokes off the low man. 6 points on the board — the closer.',
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

/** One-time bootstrap: populate an empty database with the 2026 trip. */
export async function ensureSeeded(): Promise<void> {
  const playerCount = await prisma.player.count();
  if (playerCount > 0) return;
  await prisma.$transaction([
    prisma.player.createMany({ data: seedPlayers() }),
    prisma.course.createMany({
      data: seedCourses().map((c) => ({
        ...c,
        holes: c.holes as unknown as Prisma.InputJsonValue,
      })),
    }),
    prisma.round.createMany({ data: seedRounds() }),
    prisma.ryderTeam.createMany({
      data: [
        { id: 'A', name: 'Team A', color: '#1d4ed8', captainId: null, playerIds: [] },
        { id: 'B', name: 'Team B', color: '#b91c1c', captainId: null, playerIds: [] },
      ],
    }),
  ]);
  logger.info('seeded database with the 2026 trip');
}
