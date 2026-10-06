import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSnapshot, scoringBasis } from '../src/services/basis';
import { strokesOnHole } from '../src/services/handicapMath';
import { TIE_SETTING_PREFIX, computeMatch, qualifierLeaderboard, ryderBoard } from '../src/services/leaderboard';
import { closureChange } from '../src/services/matchClosures';
import { scrambleSidesFor } from '../src/services/scoring';
import type { Match, Pairing, Round } from '../src/types';
import { PLAYERS, byName, courseOf, makeDb, match, pars, playerScores, plus, roundOf, sideScores } from './helpers';

const r2 = roundOf('r2-coral-canyon');
const r3 = roundOf('r3-ledges');
const r4 = roundOf('r4-sh-links');
const r5 = roundOf('r5-sh-champ');
const r1 = roundOf('r1-conestoga');
const ids = (...names: string[]) => names.map((n) => byName(n).id);
const pr = (id: string, a: string, b: string): Pairing => ({ id, roundId: r1.id, name: `${a}/${b}`, playerIds: ids(a, b), teeTime: null });

// ── Format mechanics ──

test('four-ball takes the better NET ball per side', () => {
  const course = courseOf(r2);
  // Neffy(0)/Darren(1) v Jakob(0)/Little Gerb(1): Darren and LG each get one stroke, on SI 1.
  const m = match('bb', r2.id, ids('Neffy', 'Darren'), ids('Jakob', 'Little Gerb'));
  const h = course.holes.findIndex((x) => x.strokeIndex === 1);
  const upTo = (v: number) => course.holes.map((x, i) => (i < h ? x.par : i === h ? v : null));
  const db = makeDb({
    matches: [m],
    scores: [
      ...playerScores(r2.id, byName('Neffy').id, upTo(5)),
      ...playerScores(r2.id, byName('Darren').id, upTo(5)), // stroke on SI 1 → net 4
      ...playerScores(r2.id, byName('Jakob').id, upTo(5)),
      ...playerScores(r2.id, byName('Little Gerb').id, upTo(6)), // net 5 with the stroke
    ],
  });
  const s = computeMatch(db, r2, m);
  assert.deepEqual([...s.sideA.players, ...s.sideB.players].map((p) => p.effectiveHandicap), [0, 1, 0, 1]);
  assert.equal(s.leader, 'A', 'gross best ball would halve the hole (5 v 5); net gives it to A');
  assert.equal(s.margin, 1);
  assert.equal(s.thru, h + 1);
});

test('Stableford points floor at 0 and an explicit pickup scores 0 points for that player only', () => {
  const course = courseOf(r3);
  const [a1, a2, b1, b2] = ids('Neffy', 'Jakob', 'Darren', 'Little Gerb');
  const m = match('sf', r3.id, [a1, a2], [b1, b2]);
  const p = pars(course);
  const blowup = [...p];
  blowup[0] = p[0] + 6;
  const pickup = [...p] as (number | 'P')[];
  pickup[0] = 'P';
  const base = [...playerScores(r3.id, b1, p), ...playerScores(r3.id, b2, p)];
  const floorDb = makeDb({ matches: [m], scores: [...base, ...playerScores(r3.id, a1, blowup), ...playerScores(r3.id, a2, p)] });
  const pickDb = makeDb({ matches: [m], scores: [...base, ...playerScores(r3.id, a1, pickup), ...playerScores(r3.id, a2, p)] });
  const f = computeMatch(floorDb, r3, m);
  const k = computeMatch(pickDb, r3, m);
  // Policy 2: everyone plays full PH (Neffy/Jakob 5, Darren/LG 6) — totals exceed 36 each.
  assert.equal(f.detail!.totalA, k.detail!.totalA, 'a +6 blow-up and a pickup both score 0 on that hole');
  assert.equal(f.final, true);
  assert.equal(k.final, true, 'a pickup resolves the hole');
  assert.equal(k.thru, 18);
});

test('Stableford: both partners picking up scores 0 for the team on that hole and still resolves it', () => {
  const course = courseOf(r3);
  const [a1, a2, b1, b2] = ids('Neffy', 'Jakob', 'Darren', 'Little Gerb');
  const m = match('sf2', r3.id, [a1, a2], [b1, b2]);
  const p = pars(course);
  const pk = [...p] as (number | 'P')[];
  pk[4] = 'P';
  const both = makeDb({ matches: [m], scores: [...playerScores(r3.id, a1, pk), ...playerScores(r3.id, a2, pk), ...playerScores(r3.id, b1, p), ...playerScores(r3.id, b2, p)] });
  const s = computeMatch(both, r3, m);
  assert.equal(s.final, true);
  assert.equal(s.thru, 18);
  const none = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r3.id, a1, p), ...playerScores(r3.id, a2, p), ...playerScores(r3.id, b1, p), ...playerScores(r3.id, b2, p)] }), r3, m);
  // The team lost exactly the points both would have scored on hole 5 (par = 2 pts each, +1 if a stroke falls there).
  const hole5 = course.holes[4];
  const strokesA = s.sideA.players.map((pl) => strokesOnHole(pl.effectiveHandicap, hole5.strokeIndex, 18));
  const lost = strokesA.reduce((sum, st) => sum + 2 + st, 0);
  assert.equal(none.detail!.totalA - s.detail!.totalA, lost);
});

test('Stableford: a MISSING score leaves the hole unresolved — not final, provisional shown', () => {
  const course = courseOf(r3);
  const [a1, a2, b1, b2] = ids('Neffy', 'Jakob', 'Darren', 'Little Gerb');
  const m = match('sfm', r3.id, [a1, a2], [b1, b2]);
  const p = pars(course);
  const missing = p.map((v, i) => (i === 4 ? null : v));
  const s = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r3.id, a1, missing), ...playerScores(r3.id, a2, p), ...playerScores(r3.id, b1, p), ...playerScores(r3.id, b2, p)] }), r3, m);
  assert.equal(s.final, false);
  assert.equal(s.thru, 17);
  assert.equal(s.provisional.thru, 18);
  assert.deepEqual(s.unresolvedHoles, [5]);
  assert.deepEqual(s.missing, [{ entityId: a1, name: 'Neffy', holes: [5] }]);
  assert.equal(s.points.A + s.points.B, 0);
});

test('scramble is hole-by-hole match play on team net: 5 holes won by 1 then 4 lost → A wins 5&4', () => {
  const course = courseOf(r4);
  // Neffy+Jakob and Darren+Little Gerb both have team handicap 2 → no strokes either way.
  const m = match('sc', r4.id, ids('Neffy', 'Jakob'), ids('Darren', 'Little Gerb'));
  const p = pars(course);
  const aGross = p.map((v, i) => (i < 5 ? v - 1 : v + 3));
  const s = computeMatch(makeDb({ matches: [m], scores: [...sideScores(r4.id, m.id, 'A', aGross), ...sideScores(r4.id, m.id, 'B', p)] }), r4, m);
  assert.deepEqual(s.sideStrokes, { A: 0, B: 0 });
  assert.equal(s.final, true);
  assert.equal(s.leader, 'A');
  assert.equal(s.margin, 5);
  assert.equal(s.closeoutRemaining, 4);
  assert.equal(s.resultKey, 'A:5&4');
  assert.equal(s.detail, undefined, 'no aggregate totals in match play');
  // The team with the higher handicap gets the difference, allocated by SI; the lower plays off zero.
  const m2 = match('sc2', r4.id, ids('Neffy', 'Jakob'), ids('Douglas', 'Schmoo'));
  const sides = scrambleSidesFor([[byName('Neffy'), byName('Jakob')], [byName('Douglas'), byName('Schmoo')]], course);
  const s2 = computeMatch(makeDb({ matches: [m2], scores: [...sideScores(r4.id, m2.id, 'A', p), ...sideScores(r4.id, m2.id, 'B', p)] }), r4, m2);
  assert.equal(s2.sideStrokes!.A, 0);
  assert.equal(s2.sideStrokes!.B, sides.team[1] - sides.team[0]);
  // All pars: B wins each stroke hole. Strokes fall on SI 1–4 (holes 7, 9, 5, 3); after
  // hole 7 B is 3 up with 2 to play, so the match closes out 3&2 before hole 9 is reached.
  assert.equal(s2.sideStrokes!.B, 4);
  assert.equal(s2.leader, 'B');
  assert.equal(s2.final, true);
  assert.equal(s2.resultKey, 'B:3&2');
});

test('net double bogey cap applies in every format: a 9 and a net double bogey halve the hole', () => {
  const [a, b] = ids('Neffy', 'Jakob'); // same handicap → 0 strokes each
  const m = match('ndb', r5.id, [a], [b]);
  const p = pars(courseOf(r5));
  const nine = p.slice(0, 1).map(() => 9);
  const six = p.slice(0, 1).map((v) => v + 2);
  const s = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, nine), ...playerScores(r5.id, b, six)] }), r5, m);
  assert.equal(s.thru, 1);
  assert.equal(s.leader, null, 'gross 9 is capped to net double bogey and halves against a 6');
  // Qualifier: a team's blow-up hole costs at most net double bogey.
  const pairings = [pr('p1', 'Neffy', 'Jakob')];
  const blow = p.map((v, i) => (i === 0 ? 12 : v));
  const board = qualifierLeaderboard(makeDb({ pairings, scores: [...playerScores(r1.id, a, blow), ...playerScores(r1.id, b, blow)] }), r1);
  const row = board.rows[0];
  // Both have 6 strokes at Conestoga (full PH), one of them on hole 1 (SI 5). Net double bogey
  // nets to par + 2 whatever the stroke, so hole 1 is +2 and the other five strokes give −5.
  assert.equal(row.toPar, 2 - 5);
});

test('scramble: a side needs an actual team score; a pickup row for a side stops the match at that hole', () => {
  const m = match('scp', r4.id, ids('Neffy', 'Jakob'), ids('Darren', 'Little Gerb'));
  const p = pars(courseOf(r4));
  const withPickup = [...p] as (number | 'P')[];
  withPickup[3] = 'P';
  const s = computeMatch(makeDb({ matches: [m], scores: [...sideScores(r4.id, m.id, 'A', withPickup), ...sideScores(r4.id, m.id, 'B', p)] }), r4, m);
  assert.equal(s.thru, 3);
  assert.equal(s.final, false);
});

// ── Match play: pickups, missing partners, premature closeouts ──

test('four-ball: a partner pickup lets the other ball count; a whole side picking up loses the hole; both sides halve it', () => {
  const course = courseOf(r2);
  const [a1, a2, b1, b2] = ids('Neffy', 'Jakob', 'Darren', 'Little Gerb'); // Darren/LG get 1 stroke each (SI 1)
  const m = match('fbp', r2.id, [a1, a2], [b1, b2]);
  const p = pars(course);
  const h = 1; // hole 2, SI 15 → nobody strokes
  const set = (a1h: number | 'P', a2h: number | 'P', b1h: number | 'P', b2h: number | 'P') => {
    const mk = (v: number | 'P') => p.slice(0, 2).map((x, i) => (i === h ? v : x)) as (number | 'P')[];
    return computeMatch(makeDb({ matches: [m], scores: [...playerScores(r2.id, a1, mk(a1h)), ...playerScores(r2.id, a2, mk(a2h)), ...playerScores(r2.id, b1, mk(b1h)), ...playerScores(r2.id, b2, mk(b2h))] }), r2, m);
  };
  assert.equal(set('P', 3, 4, 4).leader, 'A', 'partner birdie counts despite the pickup');
  assert.equal(set('P', 'P', 6, 7).leader, 'B', 'a side with no counting ball loses the hole');
  assert.equal(set('P', 'P', 'P', 'P').leader, null, 'everyone picking up halves the hole');
  assert.equal(set('P', 'P', 'P', 'P').thru, 2, '…and the hole is resolved');
});

test('four-ball: a missing partner score keeps the match provisional — no final, no point, no stamp', () => {
  const course = courseOf(r2);
  const [a1, a2, b1, b2] = ids('Neffy', 'Jakob', 'Darren', 'Little Gerb');
  const m = match('ps', r2.id, [a1, a2], [b1, b2]);
  const p = pars(course);
  // Phase 1: Darren's bogeys synced, Little Gerb's birdies still queued offline.
  const phase1 = makeDb({ matches: [m], scores: [...playerScores(r2.id, a1, p), ...playerScores(r2.id, a2, p), ...playerScores(r2.id, b1, plus(p, 1))] });
  const s1 = computeMatch(phase1, r2, m);
  assert.equal(s1.final, false, 'not final: a ball is missing on every hole');
  assert.equal(s1.thru, 0, 'no confirmed holes');
  assert.ok(s1.provisional.thru > 0, 'but a provisional reading exists');
  assert.equal(s1.provisional.leader, 'A');
  assert.equal(s1.points.A + s1.points.B, 0);
  assert.equal(s1.resultKey, null);
  assert.equal(closureChange({ closedAt: null, resultKey: null }, s1), 'none', 'no alert stamp');
  assert.match(s1.statusText, /prov\.|pending/);
  // Phase 2: Little Gerb's scores arrive.
  const phase2 = makeDb({ matches: [m], scores: [...phase1.scores, ...playerScores(r2.id, b2, plus(p, -1))] });
  const s2 = computeMatch(phase2, r2, m);
  assert.equal(s2.final, true);
  assert.equal(s2.leader, 'B');
  assert.equal(closureChange({ closedAt: null, resultKey: null }, s2), 'stamp');
});

test('match play: holes after a legitimate close-out are not required', () => {
  const [a, b] = ids('Neffy', 'Jakob');
  const m = match('co', r5.id, [a], [b]);
  const p = pars(courseOf(r5));
  const aScores = p.map((v, i) => (i < 10 ? v - 1 : null));
  const bScores = p.map((v, i) => (i < 10 ? v : null));
  const s = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, aScores), ...playerScores(r5.id, b, bScores)] }), r5, m);
  assert.equal(s.final, true);
  assert.equal(s.closeoutRemaining, 8);
  assert.equal(s.resultKey, 'A:10&8');
  assert.equal(s.points.A, 1);
});

test('singles: a missing hole in the middle stops the confirmed count; later holes wait', () => {
  const [a, b] = ids('Neffy', 'Jakob');
  const m = match('gap', r5.id, [a], [b]);
  const p = pars(courseOf(r5));
  const gap = p.map((v, i) => (i === 6 ? null : v));
  const s = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, gap), ...playerScores(r5.id, b, p)] }), r5, m);
  assert.equal(s.thru, 6);
  assert.equal(s.final, false);
  assert.equal(s.provisional.thru, 6, 'with a whole side missing the provisional reading stops too');
});

// ── Corrections, reopening, overrides, closure identity ──

test('result identity: a final-to-final correction re-stamps; an unchanged final does not; reopening clears', () => {
  const [a, b] = ids('Neffy', 'Jakob');
  const m = match('lc', r5.id, [a], [b]);
  const p = pars(courseOf(r5));
  const aWins18 = p.map((v, i) => (i === 17 ? v - 1 : v));
  const first = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, aWins18), ...playerScores(r5.id, b, p)] }), r5, m);
  assert.equal(first.resultKey, 'A:1UP');
  assert.equal(closureChange({ closedAt: null, resultKey: null }, first), 'stamp');
  const stored = { closedAt: 1000, resultKey: first.resultKey };
  assert.equal(closureChange(stored, first), 'none', 'routine sync: same result, no new alert');
  const corrected = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, p), ...playerScores(r5.id, b, p)] }), r5, m);
  assert.equal(corrected.resultKey, 'HALVED');
  assert.equal(corrected.final, true);
  assert.equal(closureChange(stored, corrected), 'stamp', 'winner changed without ever being un-final → alert again');
  const flipped = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, p), ...playerScores(r5.id, b, aWins18)] }), r5, m);
  assert.equal(flipped.resultKey, 'B:1UP');
  assert.equal(closureChange({ closedAt: 2000, resultKey: 'HALVED' }, flipped), 'stamp');
  const reopened = computeMatch(makeDb({ matches: [m], scores: [...playerScores(r5.id, a, p.map((v, i) => (i === 9 ? null : v))), ...playerScores(r5.id, b, p)] }), r5, m);
  assert.equal(reopened.final, false);
  assert.equal(closureChange({ closedAt: 2000, resultKey: 'B:1UP' }, reopened), 'clear');
});

test('admin override is a result of its own: final, points, identity, even with no scores', () => {
  const m = match('ov', r5.id, ids('Neffy'), ids('Aaron'), 'B');
  const s = computeMatch(makeDb({ matches: [m] }), r5, m);
  assert.equal(s.final, true);
  assert.deepEqual(s.points, { A: 0, B: 1 });
  assert.equal(s.resultKey, 'OVR:B');
  assert.equal(closureChange({ closedAt: null, resultKey: null }, s), 'stamp');
});

// ── Cup ──

test('Cup: points conserve, halves, 7½–7½ is a completed TIE, a side reaching 8 wins, provisional never counts', () => {
  const all = PLAYERS.map((p) => p.id);
  const mk = (r: Round, n: number, perSide: number, result: (i: number) => Match['result']) =>
    Array.from({ length: n }, (_, i) => match(`${r.id}-${i}`, r.id, all.slice(0, perSide), all.slice(perSide, perSide * 2), result(i)));
  const tie = ryderBoard(makeDb({ matches: [...mk(r2, 3, 2, (i) => (i < 2 ? 'A' : 'B')), ...mk(r3, 3, 2, (i) => (i < 1 ? 'A' : 'B')), ...mk(r4, 3, 2, (i) => (i < 2 ? 'A' : 'B')), ...mk(r5, 6, 1, (i) => (i < 2 ? 'A' : i < 5 ? 'B' : 'HALVED'))] }));
  assert.equal(tie.teams[0].points + tie.teams[1].points, 15);
  assert.deepEqual([tie.teams[0].points, tie.teams[1].points], [7.5, 7.5]);
  assert.equal(tie.outcome, 'TIE');
  assert.equal(tie.matchesFinal, 15);
  const aWins = ryderBoard(makeDb({ matches: [...mk(r2, 3, 2, () => 'A'), ...mk(r3, 3, 2, () => 'A'), ...mk(r4, 3, 2, () => 'A')] }));
  assert.equal(aWins.outcome, 'A');
  assert.equal(aWins.teams[0].points, 9);
  const partial = ryderBoard(makeDb({ matches: mk(r2, 3, 2, (i) => (i === 0 ? 'A' : null)) }));
  assert.equal(partial.outcome, 'in-progress');
  // A live match contributes projected, not solid, points.
  const live = makeDb({ matches: [match('x', r5.id, ids('Neffy'), ids('Jakob'))], scores: [...playerScores(r5.id, byName('Neffy').id, pars(courseOf(r5)).slice(0, 3).map((v) => v - 1)), ...playerScores(r5.id, byName('Jakob').id, pars(courseOf(r5)).slice(0, 3))] });
  const lb = ryderBoard(live);
  assert.equal(lb.teams[0].points, 0);
  assert.equal(lb.teams[0].provisional, 1);
  // A half-synced four-ball contributes nothing solid either.
  const halfSynced = makeDb({ matches: [match('hs', r2.id, ids('Neffy', 'Jakob'), ids('Darren', 'Little Gerb'))], scores: [...playerScores(r2.id, byName('Neffy').id, plus(pars(courseOf(r2)), -2)), ...playerScores(r2.id, byName('Darren').id, pars(courseOf(r2)))] });
  const hb = ryderBoard(halfSynced);
  assert.equal(hb.teams[0].points, 0);
  assert.equal(hb.matchesFinal, 0);
});

// ── Round 1: ties, pickups, no return ──

test('qualifier: level teams share a position (T1), no tie-break is applied, tie-for-first is flagged until resolved', () => {
  const course = courseOf(r1);
  const p = pars(course);
  // Neffy/Jakob: 6 strokes each (full PH). Darren/LG: 7 each. Give D/LG one extra stroke's worth: bogey on their extra stroke hole (SI 7).
  const si7 = course.holes.findIndex((h) => h.strokeIndex === 7);
  const bogey = p.map((v, i) => (i === si7 ? v + 1 : v));
  const pairings = [pr('p1', 'Neffy', 'Jakob'), pr('p2', 'Darren', 'Little Gerb')];
  const scores = [...pairings[0].playerIds.flatMap((id) => playerScores(r1.id, id, p)), ...pairings[1].playerIds.flatMap((id) => playerScores(r1.id, id, bogey))];
  const b1 = qualifierLeaderboard(makeDb({ pairings, scores }), r1);
  assert.equal(b1.rows[0].toPar, b1.rows[1].toPar);
  assert.deepEqual(b1.rows.map((r) => [r.position, r.tied]), [[1, true], [1, true]]);
  assert.ok(b1.tieForFirst);
  assert.equal(b1.tieForFirst!.resolution, null);
  const b2 = qualifierLeaderboard(makeDb({ pairings: [pairings[1], pairings[0]], scores }), r1);
  assert.deepEqual(b2.rows.map((r) => r.position), [1, 1], 'order of input does not create a winner');
  const resolved = qualifierLeaderboard(makeDb({ pairings, scores, settings: { [`${TIE_SETTING_PREFIX}${r1.id}`]: JSON.stringify({ pairingId: 'p2', reason: 'back-nine countback agreed', by: 'neffy', at: 1 }) } }), r1);
  assert.equal(resolved.tieForFirst!.resolution!.pairingId, 'p2');
  assert.deepEqual(resolved.rows.map((r) => r.position), [1, 1], 'positions stay shared; the resolution is a recorded decision');
});

test('qualifier: a partner pickup uses the other ball; both picking up is a no-return, ranked last with no position', () => {
  const course = courseOf(r1);
  const p = pars(course);
  const one = [...p] as (number | 'P')[];
  one[2] = 'P';
  const pairings = [pr('p1', 'Neffy', 'Jakob'), pr('p2', 'Darren', 'Little Gerb')];
  const okBoard = qualifierLeaderboard(makeDb({ pairings, scores: [...playerScores(r1.id, byName('Neffy').id, one), ...playerScores(r1.id, byName('Jakob').id, p), ...pairings[1].playerIds.flatMap((id) => playerScores(r1.id, id, p))] }), r1);
  const nj = okBoard.rows.find((r) => r.pairingId === 'p1')!;
  assert.equal(nj.thru, 18);
  assert.equal(nj.noReturn, false);
  const nrBoard = qualifierLeaderboard(makeDb({ pairings, scores: [...playerScores(r1.id, byName('Neffy').id, one), ...playerScores(r1.id, byName('Jakob').id, one), ...pairings[1].playerIds.flatMap((id) => playerScores(r1.id, id, p))] }), r1);
  const nr = nrBoard.rows.find((r) => r.pairingId === 'p1')!;
  assert.equal(nr.noReturn, true);
  assert.equal(nr.position, null);
  assert.equal(nrBoard.rows[nrBoard.rows.length - 1].pairingId, 'p1');
  assert.equal(nrBoard.tieForFirst, null);
});

// ── Snapshots ──

test('a started round is scored from its snapshot: later edits to indexes, card, rating, allowance, format or lineups change nothing', () => {
  const course = courseOf(r5);
  const [a, b] = ids('Neffy', 'Aaron');
  const m = match('snap', r5.id, [a], [b]);
  const p = pars(course);
  const scores = [...playerScores(r5.id, a, p), ...playerScores(r5.id, b, p)];
  const liveDb = makeDb({ matches: [m], scores });
  const before = computeMatch(liveDb, r5, m);
  const snapshot = buildSnapshot(liveDb, r5, 123);
  const frozenRound: Round = { ...r5, status: 'live', startedAt: 123, scoringSnapshot: snapshot };

  // Mutate everything that could matter, after the start.
  const editedPlayers = PLAYERS.map((pl) => (pl.id === b ? { ...pl, handicapIndex: 0 } : pl));
  const editedCourses = liveDb.courses.map((c) =>
    c.id === course.id
      ? { ...c, rating: 70.1, slope: 113, holes: c.holes.map((h) => ({ ...h, par: 5, strokeIndex: 19 - h.strokeIndex })) }
      : c,
  );
  const editedRound: Round = { ...frozenRound, allowance: 0.5, format: 'fourball' };
  const editedDb = makeDb({ players: editedPlayers, courses: editedCourses, rounds: liveDb.rounds.map((r) => (r.id === r5.id ? editedRound : r)), matches: [m], scores });
  const after = computeMatch(editedDb, editedRound, m);
  assert.equal(after.statusText, before.statusText);
  assert.deepEqual(after.sideA.players.map((x) => x.effectiveHandicap), before.sideA.players.map((x) => x.effectiveHandicap));
  assert.deepEqual(after.sideB.players.map((x) => x.effectiveHandicap), before.sideB.players.map((x) => x.effectiveHandicap));
  assert.equal(after.frozen, true);
  assert.equal(after.policyVersion, 2);
  const basis = scoringBasis(editedDb, editedRound);
  assert.equal(basis.course.rating, course.rating);
  assert.equal(basis.allowance, r5.allowance);
  assert.deepEqual(basis.course.holes.map((h) => h.strokeIndex), course.holes.map((h) => h.strokeIndex));

  // Without a snapshot the same edits DO change the result (and the round is flagged).
  const unfrozen = { ...editedRound, scoringSnapshot: null };
  const live = computeMatch(makeDb({ players: editedPlayers, courses: editedCourses, rounds: [unfrozen, ...liveDb.rounds.filter((r) => r.id !== r5.id)], matches: [m], scores }), unfrozen, m);
  assert.notEqual(live.statusText, before.statusText);
  assert.equal(live.snapshotMissing, true);
});

test('snapshot captures the scoring basis and the strokes players were told', () => {
  const m = match('snapm', r2.id, ids('Neffy', 'Raider'), ids('Steen', 'Douglas'));
  const db = makeDb({ matches: [m] });
  const snap = buildSnapshot(db, r2, 5);
  assert.equal(snap.policyVersion, 2);
  assert.equal(snap.format, 'fourball');
  assert.equal(snap.course.id, 'coral-canyon');
  assert.equal(snap.course.holes.length, 18);
  assert.equal(snap.players.length, 12);
  assert.deepEqual(snap.matches[0].sideA, ids('Neffy', 'Raider'));
  assert.deepEqual([`${m.id}:neffy`, `${m.id}:raider`, `${m.id}:steen`, `${m.id}:douglas`].map((k) => snap.strokes[k].strokes), [0, 4, 6, 15]);
  assert.equal(snap.strokes[`${m.id}:douglas`].allocation.reduce((a, b) => a + b, 0), 15);
});

test('a snapshot frozen under policy 1 keeps scoring under policy 1 after the code moves to policy 2', () => {
  const m = match('old', r2.id, ids('Neffy', 'Raider'), ids('Steen', 'Douglas'));
  const db = makeDb({ matches: [m] });
  const snap = { ...buildSnapshot(db, r2, 5), policyVersion: 1 as const };
  const round: Round = { ...r2, status: 'final', scoringSnapshot: snap };
  const s = computeMatch(makeDb({ matches: [m], rounds: [round] }), round, m);
  assert.equal(s.policyVersion, 1);
  // Policy 1: PH = round(round(CH) × 0.9) → 7/12/14/23, off the low man → 0/5/7/16.
  assert.deepEqual([...s.sideA.players, ...s.sideB.players].map((x) => x.effectiveHandicap), [0, 5, 7, 16]);
});

test('a player added after the snapshot is scored with the live index and the round stays frozen', () => {
  const db = makeDb();
  const snap = buildSnapshot(db, r5, 5);
  const newcomer = { id: 'guest', name: 'Guest', email: null, passwordHash: null, isAdmin: false, handicapIndex: 10.0 };
  const round: Round = { ...r5, status: 'live', scoringSnapshot: snap };
  const basis = scoringBasis(makeDb({ players: [...PLAYERS, newcomer], rounds: [round] }), round);
  assert.equal(basis.frozen, true);
  assert.equal(basis.players.find((p) => p.id === 'guest')!.handicapIndex, 10.0);
});
