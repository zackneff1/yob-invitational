import { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../store/prisma';
import { Player } from '../types';

export interface AuthedRequest extends Request {
  user?: Player;
}

export function signToken(playerId: string): string {
  return jwt.sign({ sub: playerId }, config.JWT_SECRET, { expiresIn: '30d' });
}

export const requireAuth: RequestHandler = (req: AuthedRequest, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  let sub: string;
  try {
    sub = (jwt.verify(token, config.JWT_SECRET) as { sub: string }).sub;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  prisma.player
    .findUnique({ where: { id: sub } })
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Unknown user' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
};

export const requireAdmin: RequestHandler = (req: AuthedRequest, res, next) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
};
