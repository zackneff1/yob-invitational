import { Round } from './api/types';
import { PolicyVersion } from './handicapMath';

/**
 * The handicap rule for a round, written from the code that actually applies it
 * rather than from the round's stored description.
 *
 * Those descriptions are rows in the database, seeded once when the site was
 * first deployed. When a scoring rule changes, editing the seed does not update
 * a database that already has players in it — so a stored description can go
 * stale and quietly describe rules the app no longer follows. Deriving the line
 * here means it corrects itself the moment the change deploys.
 *
 * The allowance is read live from the round, so this stays right even if an
 * admin changes it. A round that was started under the previous rule set
 * (policy 1) keeps describing that rule set.
 */
export function handicapRule(round: Round): string {
  const pct = Math.round(round.allowance * 100);
  const policy: PolicyVersion = round.policyVersion ?? 2;

  if (policy === 1) {
    // The rules the app used before 2026-10-06, kept for rounds frozen under them.
    switch (round.format) {
      case 'bestball-qualifier':
        return `${pct}% allowance · strokes off the low man across the whole field (previous rule set)`;
      case 'scramble':
        return 'Team handicap of 35% of the low + 15% of the high course handicap · off the lower team (previous rule set)';
      default:
        return `${pct}% allowance · strokes off the low man in each match (previous rule set)`;
    }
  }

  switch (round.format) {
    case 'bestball-qualifier':
      return `Full playing handicap at ${pct}% (course handicap × ${pct}%, rounded once). Stroke play, so nobody is reduced to scratch.`;
    case 'fourball':
      return `Four-ball match play: the lowest course handicap in the match plays off scratch and the other three get ${pct}% of the difference in unrounded course handicap, rounded once.`;
    case 'stableford':
      return `Full playing handicap at ${pct}% — the event's chosen allowance for aggregate Stableford (course handicap × ${pct}%, rounded once). Nobody is reduced to scratch.`;
    case 'scramble':
      return 'Team handicap = 35% of the lower + 15% of the higher unrounded 9-hole course handicap, rounded once; the higher side gets the difference. Shown off the lower team — over nine holes that changes nothing in the result.';
    case 'singles':
      return `Singles match play at ${pct}%: the lower playing handicap plays off scratch, the other gets the difference.`;
  }
}

/**
 * A round's stored description with its handicap sentence removed.
 *
 * Descriptions on the live site were written before the handicap rule moved
 * into code, and several of them end with their own version of it ("90%
 * allowance, strokes off the low man in the match"). Printing that next to the
 * derived line above says the same thing twice, and the stored copy is the one
 * that can go stale. So the sentence is dropped at display time and the derived
 * line is the single statement of the rule.
 *
 * Deliberately conservative: it only ever removes whole sentences that name the
 * handicap rule, and if that would empty the description it keeps the original.
 */
const HANDICAP_SENTENCE = /allowance|off the low man|course handicap|full handicap|team handicap/i;

export function descriptionWithoutHandicapRule(description: string): string {
  const sentences = description.match(/[^.]+\.?/g);
  if (!sentences) return description;
  const kept = sentences
    .filter((sentence) => !HANDICAP_SENTENCE.test(sentence))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return kept.length ? kept.join(' ') : description;
}
