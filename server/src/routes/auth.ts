import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { AuthedRequest, requireAuth, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { getDb, saveDb } from '../store/db';
import { Player } from '../types';

export const authRouter = Router();

function publicPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    isAdmin: p.isAdmin,
    handicapIndex: p.handicapIndex,
    claimed: p.passwordHash != null,
  };
}

/** Player list for the claim screen — no auth so first-time users can see it. */
authRouter.get('/players', (_req, res) => {
  const db = getDb();
  res.json(
    db.users.map((p) => ({ id: p.id, name: p.name, claimed: p.passwordHash != null })),
  );
});

const ClaimSchema = z.object({
  playerId: z.string(),
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  inviteCode: z.string(),
});

/** First-time setup: claim your player profile with email + password. */
authRouter.post('/claim', (req, res) => {
  const body = ClaimSchema.parse(req.body);
  if (body.inviteCode.trim().toLowerCase() !== config.INVITE_CODE.toLowerCase()) {
    throw new HttpError(403, 'Wrong invite code — ask Neffy or Aaron');
  }
  const db = getDb();
  const player = db.users.find((p) => p.id === body.playerId);
  if (!player) throw new HttpError(404, 'Player not found');
  if (player.passwordHash) throw new HttpError(409, 'This profile is already claimed');
  const email = body.email.trim().toLowerCase();
  if (db.users.some((p) => p.id !== player.id && p.email?.toLowerCase() === email)) {
    throw new HttpError(409, 'That email is already in use');
  }
  player.email = email;
  player.passwordHash = bcrypt.hashSync(body.password, 10);
  saveDb();
  res.json({ token: signToken(player.id), player: publicPlayer(player) });
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/login', (req, res) => {
  const body = LoginSchema.parse(req.body);
  const db = getDb();
  const player = db.users.find((p) => p.email?.toLowerCase() === body.email.trim().toLowerCase());
  if (!player?.passwordHash || !bcrypt.compareSync(body.password, player.passwordHash)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  res.json({ token: signToken(player.id), player: publicPlayer(player) });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ player: publicPlayer(req.user!) });
});
