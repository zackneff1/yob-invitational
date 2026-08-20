import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDb } from '../store/db';
import { Player } from '../types';

export interface AuthedRequest extends Request {
  user?: Player;
}

export interface TokenPayload {
  sub: string;
}

export function signToken(playerId: string): string {
  return jwt.sign({ sub: playerId }, config.JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as TokenPayload;
    const user = getDb().users.find((u) => u.id === payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Unknown user' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}
