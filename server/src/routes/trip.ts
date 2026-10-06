import { Router } from 'express';
import { BUILD_ID, MIN_CLIENT_VERSION } from '../build';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { scoringBasis } from '../services/basis';
import {
  SCORING_POLICY_VERSION,
  courseHandicapFromRaw,
  playingHandicapFromRaw,
} from '../services/handicapMath';
import { courseHandicapRawFor } from '../services/scoring';
import { loadDb } from '../store/loadDb';

export const tripRouter = Router();

/** Everything the client needs to render the trip: players, courses, rounds, teams, matches. */
tripRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const db = await loadDb();
    res.json({
      build: BUILD_ID,
      minClientVersion: MIN_CLIENT_VERSION,
      policyVersion: SCORING_POLICY_VERSION,
      players: db.users.map((p) => ({
        id: p.id,
        name: p.name,
        isAdmin: p.isAdmin,
        handicapIndex: p.handicapIndex,
        claimed: p.passwordHash != null,
      })),
      courses: db.courses,
      rounds: db.rounds.map((r) => {
        // Handicaps and the card come from the round's frozen basis once it
        // has started, so the phone shows the same strokes the server scores.
        const basis = scoringBasis(db, r);
        const { scoringSnapshot, ...round } = r;
        return {
          ...round,
          scoringCourse: basis.course,
          policyVersion: basis.policy,
          frozen: basis.frozen,
          snapshotMissing: basis.snapshotMissing,
          snapshotCapturedAt: basis.snapshotCapturedAt,
          lineupHistory: scoringSnapshot?.lineupHistory ?? [],
          courseHandicaps: basis.players.map((p) => {
            const raw = courseHandicapRawFor(p.handicapIndex, basis.course, basis.policy);
            return {
              playerId: p.id,
              handicapIndex: p.handicapIndex,
              courseHandicapRaw: raw,
              courseHandicap: courseHandicapFromRaw(raw),
              playingHandicap: playingHandicapFromRaw(raw, basis.allowance, basis.policy),
            };
          }),
        };
      }),
      pairings: db.pairings,
      ryderTeams: db.ryderTeams,
      matches: db.matches,
      // Everyone signed in may see these (door codes for the houses etc.);
      // the invite code + login is the gate, same as the rest of the trip.
      settings: db.settings,
    });
  }),
);
