/**
 * One-off: push the 2026 scorecards into a running deployment.
 *
 * This exists because seed data only ever populates a brand-new empty
 * database — it cannot touch a live site that already has players in it.
 * The script writes through the ordinary admin API (`PUT /api/admin/courses/:id`),
 * exactly the endpoint the Admin → Courses screen uses, so everything it sets
 * stays editable there afterwards. It changes no application code.
 *
 * Usage (from the repo root):
 *
 *   # 1. dry run — prints what would change, writes nothing
 *   YOB_URL=https://your-site.onrender.com \
 *   YOB_EMAIL=you@example.com \
 *   YOB_PASSWORD='...' \
 *   npx tsx server/scripts/push-courses.ts
 *
 *   # 2. same command with --apply once the dry run looks right
 *   ... npx tsx server/scripts/push-courses.ts --apply
 *
 * The account must be an admin. Credentials are read from the environment and
 * are never written to disk or logged.
 */
import { courses2026 } from '../src/store/courses2026';
import { Course } from '../src/types';

const APPLY = process.argv.includes('--apply');

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
      ...rest.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) {
    fail(`${init.method ?? 'GET'} ${path} → ${res.status}\n${body.slice(0, 500)}`);
  }
  return body ? (JSON.parse(body) as T) : ({} as T);
}

/** One-line summary of a course's headline numbers, for the before/after diff. */
function summarize(c: Pick<Course, 'tee' | 'par' | 'rating' | 'slope' | 'holes'>): string {
  const yards = c.holes.every((h) => typeof h.yards === 'number')
    ? `${c.holes.reduce((sum, h) => sum + (h.yards ?? 0), 0).toLocaleString()} yds`
    : 'no yardages';
  return `${c.tee} tees · par ${c.par} · ${c.rating}/${c.slope} · ${yards} · ${c.holes.length} holes`;
}

async function main(): Promise<void> {
  if (!BASE) fail('Set YOB_URL to the site, e.g. https://your-site.onrender.com');
  if (!EMAIL || !PASSWORD) fail('Set YOB_EMAIL and YOB_PASSWORD to an admin login.');

  console.log(`\nTarget: ${BASE}`);
  console.log(APPLY ? 'Mode:   APPLY — this will write to the database.' : 'Mode:   dry run (no writes). Re-run with --apply to write.');

  const auth = await api<{ token: string; player: { name: string; isAdmin: boolean } }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) },
  );
  if (!auth.player.isAdmin) fail(`${auth.player.name} is not an admin on this site.`);
  console.log(`Signed in as ${auth.player.name} (admin).\n`);

  const trip = await api<{ courses: Course[] }>('/api/trip', { token: auth.token });
  const wanted = courses2026();

  const missing = wanted.filter((c) => !trip.courses.some((live) => live.id === c.id));
  if (missing.length) {
    fail(`These courses do not exist on the target site: ${missing.map((c) => c.id).join(', ')}`);
  }

  for (const course of wanted) {
    const live = trip.courses.find((c) => c.id === course.id)!;
    console.log(`${course.name}`);
    console.log(`  before: ${summarize(live)}`);
    console.log(`  after:  ${summarize(course)}`);

    // The hole count is immutable through this endpoint — flag it rather than
    // sending a request the server will reject.
    if (live.holes.length !== course.holes.length) {
      fail(
        `${course.id}: site has ${live.holes.length} holes but the card has ${course.holes.length}. ` +
          `The admin API cannot change hole count; this needs Zack.`,
      );
    }

    if (APPLY) {
      await api(`/api/admin/courses/${course.id}`, {
        method: 'PUT',
        token: auth.token,
        body: JSON.stringify({
          tee: course.tee,
          par: course.par,
          rating: course.rating,
          slope: course.slope,
          holes: course.holes,
          ...(course.notes !== undefined && { notes: course.notes }),
        }),
      });
      console.log('  written ✓');
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run complete — nothing was written. Re-run with --apply to write.\n');
    return;
  }

  // Read everything back and confirm the site now matches the cards.
  const after = await api<{ courses: Course[] }>('/api/trip', { token: auth.token });
  const wrong = wanted.filter((c) => {
    const live = after.courses.find((x) => x.id === c.id);
    return !live || summarize(live) !== summarize(c);
  });
  if (wrong.length) fail(`Verification failed for: ${wrong.map((c) => c.id).join(', ')}`);
  console.log('All five courses verified against the site. Done.\n');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
