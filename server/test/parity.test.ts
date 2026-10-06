import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import * as clientMath from '../../client/src/handicapMath';
import * as serverMath from '../src/services/handicapMath';
import { computeMatch } from '../src/services/leaderboard';
import { buildSnapshot } from '../src/services/basis';
import type { Round } from '../src/types';
import { PLAYERS, clientStateFor, makeDb, makeRng, match, playerScores, roundOf, sideScores } from './helpers';

test('the shared handicap module is byte-identical on server and client', () => {
  const a = readFileSync(path.join(__dirname, '../src/services/handicapMath.ts'), 'utf8');
  const b = readFileSync(path.join(__dirname, '../../client/src/handicapMath.ts'), 'utf8');
  assert.equal(a, b, 'server/src/services/handicapMath.ts and client/src/handicapMath.ts have diverged — copy one over the other');
});

test('strokesOnHole and stablefordPoints agree exhaustively', () => {
  for (let ph = -5; ph <= 45; ph++)
    for (const holes of [9, 18])
      for (let si = 1; si <= holes; si++)
        assert.equal(serverMath.strokesOnHole(ph, si, holes), clientMath.strokesOnHole(ph, si, holes));
  for (let par = 3; par <= 5; par++)
    for (let net = par - 4; net <= par + 6; net++)
      assert.equal(serverMath.stablefordPoints(net, par), clientMath.stablefordPoints(net, par));
});

const formats: { roundId: string; perSide: number }[] = [
  { roundId: 'r2-coral-canyon', perSide: 2 },
  { roundId: 'r3-ledges', perSide: 2 },
  { roundId: 'r4-sh-links', perSide: 2 },
  { roundId: 'r5-sh-champ', perSide: 1 },
];

for (const policy of [2, 1] as const) {
  test(`phone and server agree on random matches with missing scores and pickups (policy ${policy})`, () => {
    const rng = makeRng(20261006 + policy);
    let checked = 0;
    for (const f of formats) {
      const base = roundOf(f.roundId);
      for (let i = 0; i < 120; i++) {
        const ids = [...PLAYERS].sort(() => rng() - 0.5).slice(0, f.perSide * 2).map((p) => p.id);
        const m = match(`m${i}`, base.id, ids.slice(0, f.perSide), ids.slice(f.perSide));
        const liveDb = makeDb({ matches: [m] });
        // Freeze under the requested policy so both sides read the same basis.
        const round: Round = { ...base, status: 'live', scoringSnapshot: { ...buildSnapshot(liveDb, base, 1), policyVersion: policy } };
        const course = round.scoringSnapshot!.course;
        const played = Math.floor(rng() * (course.holes.length + 1));
        const gen = () =>
          course.holes.map((h, hi) => {
            if (hi >= played) return null;
            const r = rng();
            if (r < 0.06) return null; // missing
            if (r < 0.12 && round.format !== 'scramble') return 'P' as const; // pickup
            return h.par + Math.floor(rng() * 5) - 1;
          });
        const scores =
          round.format === 'scramble'
            ? [...sideScores(round.id, m.id, 'A', gen()), ...sideScores(round.id, m.id, 'B', gen())]
            : ids.flatMap((pid) => playerScores(round.id, pid, gen()));
        const db = makeDb({ matches: [m], scores, rounds: [round] });
        const s = computeMatch(db, round, m);
        const { state: c, group, sides } = clientStateFor(db, round.id, m.id);
        assert.ok(c, 'client produced a state');
        const where = `${round.id} #${i} policy ${policy}`;
        assert.equal(c!.thru, s.thru, `${where} thru`);
        assert.equal(c!.leader, s.leader, `${where} leader`);
        assert.equal(c!.margin, s.margin, `${where} margin`);
        assert.equal(c!.final, s.final, `${where} final`);
        assert.equal(c!.closeoutRemaining, s.closeoutRemaining, `${where} closeout`);
        assert.deepEqual(c!.provisional, s.provisional, `${where} provisional`);
        assert.deepEqual(c!.unresolvedHoles, s.unresolvedHoles, `${where} unresolved`);
        if (round.format === 'scramble') {
          assert.equal(sides?.A.strokes, s.sideStrokes?.A, `${where} side strokes A`);
          assert.equal(sides?.B.strokes, s.sideStrokes?.B, `${where} side strokes B`);
        } else {
          for (const info of [...s.sideA.players, ...s.sideB.players]) {
            const col = group.columns.find((x) => x.entityId === info.playerId);
            assert.equal(col?.effectiveHandicap, info.effectiveHandicap, `${where} strokes for ${info.name}`);
          }
        }
        checked += 1;
      }
    }
    assert.ok(checked >= 480);
  });
}
