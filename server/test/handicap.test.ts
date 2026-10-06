import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HandicapInputError,
  Rational,
  allocateStrokes,
  courseHandicapFromRaw,
  courseHandicapRaw,
  differenceFirstStrokes,
  groupStrokes,
  netDoubleBogey,
  netScore,
  playingHandicapFromRaw,
  rationalToFixed,
  roundHalfUp,
  scrambleSideStrokes,
  scrambleTeamHandicapFromRaw,
  strokesOnHole,
  toPercent,
  toTenths,
} from '../src/services/handicapMath';
import { courseHandicap, courseHandicapRawFor, handicapInfoFor, playingHandicap, scrambleSidesFor } from '../src/services/scoring';
import { COURSES, PLAYERS, ROUNDS, byName, courseOf, roundOf } from './helpers';

const conestoga = courseOf(roundOf('r1-conestoga'));
const coral = courseOf(roundOf('r2-coral-canyon'));
const ledges = courseOf(roundOf('r3-ledges'));
const links = courseOf(roundOf('r4-sh-links'));

// ── Independent golden values (supplied by the reviewer, hand-checked) ──

test('golden: Steen R1 raw CH is exactly 13.5, displays 14, PH 11', () => {
  const raw = courseHandicapRawFor(11.3, conestoga);
  assert.equal(raw.n * 2, raw.d * 27, `raw is ${raw.n}/${raw.d}, expected 27/2`); // 13.5 exactly
  assert.equal(rationalToFixed(raw), '13.5000');
  assert.equal(courseHandicap(11.3, conestoga), 14);
  assert.equal(playingHandicap(11.3, conestoga, 0.85), 11);
});

test('golden: Schmoo R1 PH 25 (unrounded 29.503 × 85% = 25.08)', () => {
  assert.equal(courseHandicap(25.0, conestoga), 30);
  assert.equal(playingHandicap(25.0, conestoga, 0.85), 25);
});

test('golden: Neffy and Jakob R3 PH 5 each (5.731 × 95% = 5.44)', () => {
  assert.equal(playingHandicap(5.9, ledges, 0.95), 5);
  assert.equal(courseHandicap(5.9, ledges), 6);
});

test('golden: R2 Neffy/Raider/Steen/Douglas strokes 0/4/6/15 (90% of the difference in unrounded CH)', () => {
  const four = ['Neffy', 'Raider', 'Steen', 'Douglas'].map(byName);
  const raws = four.map((p) => courseHandicapRawFor(p.handicapIndex, coral));
  assert.deepEqual(raws.map((r) => rationalToFixed(r)), ['8.0663', '13.0017', '14.9000', '25.2769']);
  assert.deepEqual(differenceFirstStrokes(raws, 0.9), [0, 4, 6, 15]);
  const infos = handicapInfoFor(four, 'fourball', 0.9, coral);
  assert.deepEqual(infos.map((i) => i.effectiveHandicap), [0, 4, 6, 15]);
  // Display values alongside: rounded CH 8/13/15/25, PH (6.2a) 7/12/13/23.
  assert.deepEqual(infos.map((i) => i.courseHandicap), [8, 13, 15, 25]);
  assert.deepEqual(infos.map((i) => i.playingHandicap), [7, 12, 13, 23]);
});

test('golden: Steen R4 half-index 5.7, raw 9-hole CH 6.5097…, display 7 (conditional on 35.7/135)', () => {
  const raw = courseHandicapRawFor(11.3, links);
  assert.equal(rationalToFixed(raw, 7), '6.5097345');
  assert.equal(courseHandicapFromRaw(raw), 7);
  // The half index actually used: 5.65 → 5.7 (tenths: 113/2 = 56.5 → 57).
  assert.equal(roundHalfUp({ n: 113, d: 2 }), 57);
});

test('golden: R4 team handicaps Neffy+Jakob 2, Steen+Big Gerb 4, Neffy+Schmoo 3 (conditional on 35.7/135)', () => {
  const team = (a: string, b: string) => scrambleTeamHandicapFromRaw([byName(a), byName(b)].map((p) => courseHandicapRawFor(p.handicapIndex, links)));
  assert.equal(team('Neffy', 'Jakob'), 2);
  assert.equal(team('Steen', 'Big Gerb'), 4);
  assert.equal(team('Neffy', 'Schmoo'), 3);
  // Through the server wrapper, with side strokes off the lower team.
  const sides = scrambleSidesFor([[byName('Steen'), byName('Big Gerb')], [byName('Neffy'), byName('Jakob')]], links);
  assert.deepEqual(sides, { team: [4, 2], strokes: [2, 0] });
});

// ── Rounding ──

test('roundHalfUp: .5 goes up for positive, towards zero (up) for negative; exact at every boundary', () => {
  assert.equal(roundHalfUp({ n: 27, d: 2 }), 14); // 13.5
  assert.equal(roundHalfUp({ n: 29, d: 10 }), 3); // 2.9
  assert.equal(roundHalfUp({ n: 25, d: 10 }), 3); // 2.5
  assert.equal(roundHalfUp({ n: 24999, d: 10000 }), 2); // 2.4999
  assert.equal(roundHalfUp({ n: 25001, d: 10000 }), 3); // 2.5001
  assert.equal(roundHalfUp({ n: -5, d: 2 }), -2); // −2.5 → −2 (Appendix C: plus handicaps move up towards zero)
  assert.equal(roundHalfUp({ n: -26, d: 10 }), -3); // −2.6 → −3
  assert.equal(roundHalfUp({ n: -24, d: 10 }), -2); // −2.4 → −2
  assert.equal(roundHalfUp({ n: 0, d: 1 }), 0);
});

test('exact-half boundaries at each stage', () => {
  // CH stage: raw exactly x.5 for every seeded course via a crafted index.
  for (const c of COURSES) {
    // find an index in tenths whose raw CH is exactly k + 1/2
    let found = false;
    for (let t = 0; t <= 540 && !found; t++) {
      const raw = courseHandicapRaw(t / 10, { par: c.par, rating: c.rating, slope: c.slope, holeCount: c.holes.length });
      if ((2 * raw.n) % raw.d === 0 && raw.n % raw.d !== 0) {
        found = true;
        const exact = (2 * raw.n) / raw.d; // odd integer
        assert.equal(courseHandicapFromRaw(raw), (exact + 1) / 2, `${t / 10} @ ${c.id}`);
      }
    }
  }
  // PH stage: raw × allowance exactly .5 — 30.0 CH × 85% = 25.5 → 26 when the raw CH is a whole 30.
  const raw30: Rational = { n: 30 * 1130, d: 1130 };
  assert.equal(playingHandicapFromRaw(raw30, 0.85), 26);
  // and 25.4999 stays 25
  assert.equal(playingHandicapFromRaw({ n: 254999, d: 10000 }, 1), 25);
  // Difference stage: 90% of a difference that lands on .5 — diff 5 → 4.5 → 5
  assert.deepEqual(differenceFirstStrokes([{ n: 0, d: 1130 }, { n: 5 * 1130, d: 1130 }], 0.9), [0, 5]);
  // Team stage: 35% × 3 + 15% × 3 = 1.5 exactly → 2 (the old floating-point code gave 1)
  const three: Rational = { n: 3 * 1130, d: 1130 };
  assert.equal(scrambleTeamHandicapFromRaw([three, three]), 2);
});

test('no floating-point misrounding for any index 0.0–54.0 on any seeded course (BigInt oracle)', () => {
  for (const c of COURSES) {
    const holeCount = c.holes.length;
    for (let t = 0; t <= 540; t++) {
      const idxT = holeCount === 9 ? BigInt(Math.floor((t + 1) / 2)) : BigInt(t); // 9 holes: half rounded to a tenth
      const n = idxT * BigInt(c.slope) + 113n * BigInt(Math.round(c.rating * 10) - 10 * c.par);
      const d = 1130n;
      const expected = Number((2n * n + d) / (2n * d) - (2n * n + d < 0n && (2n * n + d) % (2n * d) !== 0n ? 1n : 0n));
      assert.equal(courseHandicap(t / 10, c), expected, `${t / 10} @ ${c.id}`);
    }
  }
});

// ── Allowances through the pipeline ──

test('policy 2 playing handicaps for all seeded players (6.2a: unrounded CH × allowance, rounded once)', () => {
  const expect: Record<string, number[]> = {
    // R1 85%, R2 90%, R3 100%, R5 100%  (R4 is a team format). Independent BigInt oracle values.
    Neffy: [6, 7, 6, 7],
    Jakob: [6, 7, 6, 7],
    'Little Gerb': [7, 8, 7, 8],
    Darren: [7, 8, 7, 8],
    Raider: [10, 12, 10, 12],
    Steen: [11, 13, 12, 13],
    'Cousin Will': [12, 14, 13, 14],
    Aaron: [14, 16, 15, 16],
    'Big Gerb': [15, 17, 16, 17],
    Douglas: [20, 23, 21, 23],
    Meesa: [20, 24, 22, 24],
    Schmoo: [25, 29, 27, 29],
  };
  const ids = ['r1-conestoga', 'r2-coral-canyon', 'r3-ledges', 'r5-sh-champ'];
  assert.equal(roundOf('r3-ledges').allowance, 1, 'Stableford is played at 100%');
  for (const p of PLAYERS) {
    const got = ids.map((id) => playingHandicap(p.handicapIndex, courseOf(roundOf(id)), roundOf(id).allowance));
    assert.deepEqual(got, expect[p.name], p.name);
  }
});

test('net double bogey cap: gross above par + 2 + strokes counts as that', () => {
  assert.equal(netDoubleBogey(4, 0), 6);
  assert.equal(netDoubleBogey(5, 2), 9);
  assert.equal(netScore(9, 4, 0), 6);
  assert.equal(netScore(6, 4, 0), 6);
  assert.equal(netScore(5, 4, 0), 5);
  assert.equal(netScore(10, 4, 1), 6); // cap 7, minus the stroke
  assert.equal(netScore(3, 4, 1), 2);
});

test('format rules: full PH for R1 and R3, difference of PH for singles, difference-first for four-ball', () => {
  // Neffy 8.0664, Schmoo 32.2372 unrounded CH at Coral Canyon.
  const raws = ['Neffy', 'Schmoo'].map((n) => courseHandicapRawFor(byName(n).handicapIndex, coral));
  assert.deepEqual(groupStrokes('bestball-qualifier', raws, 0.85).map((s) => s.strokes), [7, 27]); // 6.86, 27.40
  assert.deepEqual(groupStrokes('stableford', raws, 0.95).map((s) => s.strokes), [8, 31]); // 7.66, 30.63
  assert.deepEqual(groupStrokes('singles', raws, 1).map((s) => s.strokes), [0, 24]); // CH 8 vs 32
  assert.deepEqual(groupStrokes('fourball', raws, 0.9).map((s) => s.strokes), [0, 22]); // 0.9 × 24.17 = 21.75
});

test('policy 1 reproduces the previous rule set (double rounding, off the low man everywhere)', () => {
  const steen = courseHandicapRawFor(11.3, conestoga, 1);
  assert.equal(playingHandicapFromRaw(steen, 0.85, 1), 12); // round(14 × 0.85 = 11.9)
  const raws = ['Neffy', 'Schmoo'].map((n) => courseHandicapRawFor(byName(n).handicapIndex, conestoga, 1));
  assert.deepEqual(groupStrokes('bestball-qualifier', raws, 0.85, 1).map((s) => s.strokes), [0, 20]); // 26 − 6
  // 9 holes under policy 1 used the exact half index (5.65), giving Steen 6 not 7.
  assert.equal(courseHandicapFromRaw(courseHandicapRawFor(11.3, links, 1)), 6);
  assert.equal(scrambleTeamHandicapFromRaw([courseHandicapRawFor(5.9, links, 1), courseHandicapRawFor(25, links, 1)], 1), 3);
});

// ── Allocation ──

test('stroke allocation: 18 and 9 holes, above the hole count, plus handicaps', () => {
  const si18 = conestoga.holes.map((h) => h.strokeIndex);
  const alloc22 = allocateStrokes(22, si18);
  assert.equal(alloc22.reduce((a, b) => a + b, 0), 22);
  conestoga.holes.forEach((h, i) => assert.equal(alloc22[i], h.strokeIndex <= 4 ? 2 : 1));
  assert.deepEqual([1, 4, 5, 18].map((si) => strokesOnHole(22, si, 18)), [2, 2, 1, 1]);
  assert.deepEqual([1, 2, 3, 9].map((si) => strokesOnHole(11, si, 9)), [2, 2, 1, 1]);
  assert.deepEqual([1, 18].map((si) => strokesOnHole(36, si, 18)), [2, 2]);
  assert.deepEqual([1, 4, 5].map((si) => strokesOnHole(40, si, 18)), [3, 3, 2]);
  assert.deepEqual([16, 17, 18].map((si) => strokesOnHole(-2, si, 18)), [0, -1, -1]);
  assert.equal(allocateStrokes(0, si18).every((s) => s === 0), true);
});

test('plus handicap through the pipeline', () => {
  const raw = courseHandicapRawFor(-2.0, conestoga); // −2.036
  assert.equal(rationalToFixed(raw), '-2.0362');
  assert.equal(courseHandicapFromRaw(raw), -2);
  assert.equal(playingHandicapFromRaw(raw, 0.85), -2); // −1.73 → −2
  const singles = groupStrokes('singles', [raw, courseHandicapRawFor(5.9, conestoga)], 1);
  assert.deepEqual(singles.map((s) => s.strokes), [0, 9]); // 7 − (−2)
});

// ── Input precision ──

test('unsupported precision is rejected, not truncated', () => {
  assert.throws(() => toTenths(11.35, 'index'), HandicapInputError);
  assert.throws(() => courseHandicapRaw(11.35, { par: 72, rating: 72.3, slope: 132, holeCount: 18 }), HandicapInputError);
  assert.throws(() => courseHandicapRaw(11.3, { par: 72, rating: 72.33, slope: 132, holeCount: 18 }), HandicapInputError);
  assert.throws(() => toPercent(0.855), HandicapInputError);
  assert.throws(() => courseHandicapRaw(11.3, { par: 72, rating: 72.3, slope: 132.5, holeCount: 18 }), HandicapInputError);
  assert.equal(toTenths(11.3, 'index'), 113);
  assert.equal(toPercent(0.85), 85);
});

test('scramble side strokes: off the lower team, never negative', () => {
  const a = [byName('Neffy'), byName('Jakob')].map((p) => courseHandicapRawFor(p.handicapIndex, links));
  const b = [byName('Douglas'), byName('Schmoo')].map((p) => courseHandicapRawFor(p.handicapIndex, links));
  const sides = scrambleSideStrokes([a, b]);
  assert.equal(sides.strokes[0], 0);
  assert.equal(sides.strokes[1], sides.team[1] - sides.team[0]);
  assert.ok(sides.strokes[1] > 0);
});

test('seeded rounds carry whole-percent allowances', () => {
  for (const r of ROUNDS) assert.doesNotThrow(() => toPercent(r.allowance), r.id);
});
