import { Router } from 'express';
import { BUILD_ID } from '../build';
import { SCORING_POLICY_VERSION } from '../services/handicapMath';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', build: BUILD_ID, policyVersion: SCORING_POLICY_VERSION });
});
