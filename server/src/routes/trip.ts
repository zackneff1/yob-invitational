import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../store/db';
import { courseHandicap, playingHandicap } from '../services/scoring';

export const tripRouter = Router();

/** Everything the client needs to render the trip: players, courses, rounds, teams, matches. */
tripRouter.get('/', requireAuth, (_req, res) => {
  const db = getDb();
  res.json({
    players: db.users.map((p) => ({
      id: p.id,
      name: p.name,
      isAdmin: p.isAdmin,
      handicapIndex: p.handicapIndex,
      claimed: p.passwordHash != null,
    })),
    courses: db.courses,
    rounds: db.rounds.map((r) => {
      const course = db.courses.find((c) => c.id === r.courseId)!;
      return {
        ...r,
        courseHandicaps: db.users.map((p) => ({
          playerId: p.id,
          courseHandicap: courseHandicap(p.handicapIndex, course),
          playingHandicap: playingHandicap(p.handicapIndex, course, r.allowance),
        })),
      };
    }),
    pairings: db.pairings,
    ryderTeams: db.ryderTeams,
    matches: db.matches,
  });
});
