import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the server dir or the repo root (dev convenience; on Render
// real environment variables are injected instead).
dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')],
});

const DEV_JWT_SECRET = 'dev-only-secret-do-not-use-in-prod';
const DEV_DATABASE_URL = 'postgresql://yob:yob@localhost:5432/yob_invitational';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
    INVITE_CODE: z.string().min(1).default('yob2026'),
    DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_SECRET === DEV_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be set explicitly in production',
      });
    }
    if (env.DATABASE_URL === DEV_DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be set explicitly in production',
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

// Prisma reads DATABASE_URL straight from process.env — make sure the value
// resolved here (including the dev default) is what it sees.
process.env.DATABASE_URL = config.DATABASE_URL;
