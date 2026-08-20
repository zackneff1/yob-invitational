import { Round } from './api/types';

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
 * admin changes it.
 */
export function handicapRule(round: Round): string {
  const allowance = `${Math.round(round.allowance * 100)}% allowance`;

  switch (round.format) {
    case 'bestball-qualifier':
      // Round 1 is one big field rather than a set of matches.
      return `${allowance} · strokes off the low man across the whole field, so the lowest handicap plays off scratch`;
    case 'scramble':
      // Sides, not individuals: a team handicap per side, then off the lower one.
      return 'Team handicap of 35% of the low + 15% of the high course handicap · played off the lower team handicap in the match';
    default:
      return `${allowance} · strokes off the low man in each match`;
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
