import { Router } from 'express';
import { adminRouter } from './admin';
import { authRouter } from './auth';
import { healthRouter } from './health';
import { leaderboardRouter } from './leaderboard';
import { scoresRouter } from './scores';
import { tripRouter } from './trip';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/trip', tripRouter);
apiRouter.use('/scores', scoresRouter);
apiRouter.use('/leaderboard', leaderboardRouter);
apiRouter.use('/admin', adminRouter);
