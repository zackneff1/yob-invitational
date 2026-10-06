/**
 * Read-only: compare a running deployment's configuration with the reviewed
 * course data in the repo, field by field.
 *
 * Logs in as an admin, calls GET /api/admin/export, and prints every
 * difference between the hosted courses/rounds and the seed (tees, par,
 * rating, slope, hole count, each hole's par / yardage / stroke index, round
 * formats and allowances). Writes nothing. Pair it with
 * `server/scripts/push-courses.ts` (dry run first) to fix stale course cards
 * through the ordinary admin API — never with Admin → reset.
 *
 * Usage (from the repo root):
 *
 *   YOB_URL=https://your-site.onrender.com \
 *   YOB_EMAIL=you@example.com \
 *   YOB_PASSWORD='...' \
 *   npx tsx server/scripts/verify-live.ts
 *
 * Credentials are read from the environment and never written or logged.
 */
import { courses2026 } from '../src/store/courses2026';
import { seedRounds } from '../src/store/seed';
import type { Course } from '../src/types';

const BASE = (process.env.YOB_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.YOB_EMAIL ?? '';
const PASSWORD = process.env.YOB_PASSWORD ?? '';

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = `${msg} — ${body.error}`;
    } catch {
      /* not JSON */
    }
    throw new Error(`${path}: ${msg}`);
  }
  return (await res.json()) as T;
}

interface ExportShape {
  exportedAt: string;
  build: string;
  policyVersion: number;
  courses: Course[];
  rounds: {
    id: string;
    courseId: string;
    format: string;
    allowance: number;
    matchCount: number;
    teeTimes: string[];
    status: string;
    scoring: { scores: number; pickups: number };
    frozen: boolean;
  }[];
  players: { id: string; name: string; handicapIndex: number }[];
}

async function main() {
  if (!BASE || !EMAIL || !PASSWORD) fail('Set YOB_URL, YOB_EMAIL and YOB_PASSWORD in the environment.');
  const health = await api<{ status: string; build?: string; policyVersion?: number }>('/api/health');
  console.log(`Site: ${BASE}  build: ${health.build ?? '(not reported)'}  policy: ${health.policyVersion ?? '(not reported)'}`);
  const { token } = await api<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const live = await api<ExportShape>('/api/admin/export', { token });
  console.log(`Export at ${live.exportedAt}, build ${live.build}, policy ${live.policyVersion}\n`);

  let diffs = 0;
  const diff = (where: string, field: string, hosted: unknown, seed: unknown) => {
    if (JSON.stringify(hosted) !== JSON.stringify(seed)) {
      diffs += 1;
      console.log(`  ${where} · ${field}: hosted=${JSON.stringify(hosted)} seed=${JSON.stringify(seed)}`);
    }
  };

  console.log('Courses (hosted vs seed):');
  for (const seed of courses2026()) {
    const hosted = live.courses.find((c) => c.id === seed.id);
    if (!hosted) {
      diffs += 1;
      console.log(`  ${seed.id}: MISSING on the hosted site`);
      continue;
    }
    for (const f of ['name', 'tee', 'par', 'rating', 'slope'] as const) diff(seed.id, f, hosted[f], seed[f]);
    diff(seed.id, 'holeCount', hosted.holes.length, seed.holes.length);
    seed.holes.forEach((h, i) => {
      const hh = hosted.holes[i];
      if (!hh) return;
      diff(seed.id, `hole ${h.number} par`, hh.par, h.par);
      diff(seed.id, `hole ${h.number} yards`, hh.yards ?? null, h.yards ?? null);
      diff(seed.id, `hole ${h.number} SI`, hh.strokeIndex, h.strokeIndex);
    });
  }
  console.log('\nRounds (hosted vs seed):');
  for (const seed of seedRounds()) {
    const hosted = live.rounds.find((r) => r.id === seed.id);
    if (!hosted) {
      diffs += 1;
      console.log(`  ${seed.id}: MISSING on the hosted site`);
      continue;
    }
    for (const f of ['courseId', 'format', 'allowance', 'matchCount'] as const) diff(seed.id, f, hosted[f], seed[f]);
    diff(seed.id, 'teeTimes (as stored)', hosted.teeTimes, seed.teeTimes);
    console.log(`  ${seed.id}: status ${hosted.status}, ${hosted.scoring.scores} scores (${hosted.scoring.pickups} pickups), ${hosted.frozen ? 'frozen' : 'not frozen'}`);
  }
  console.log('\nPlayers on the hosted site (indexes are admin data, not compared to the seed):');
  for (const p of live.players) console.log(`  ${p.name}: ${p.handicapIndex}`);
  console.log(`\n${diffs === 0 ? '✔ No configuration differences.' : `${diffs} difference(s) found.`}`);
  console.log('Sand Hollow Links 35.7 / 135 remains awaiting course confirmation regardless of this comparison.');
  if (diffs > 0) {
    console.log('To fix course cards: dry-run `npx tsx server/scripts/push-courses.ts`, review, then add --apply. Never use Admin → reset.');
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
