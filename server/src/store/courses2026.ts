import { Course, Hole } from '../types';

/**
 * The five 2026 scorecards, at the tees the group is playing.
 *
 * Transcribed by hand from the official cards (COURSES.md in the repo root is
 * the matching human-readable reference). Nothing here reads or parses that
 * document — these are plain literals.
 *
 * This is seed data: it only populates a brand-new empty database. Every field
 * below stays fully editable afterwards through Admin → Courses.
 *
 * This module deliberately imports nothing but types, so one-off scripts can
 * pull the data in without booting the server's config/logger/database.
 */

/** [par, yards, strokeIndex] in hole order; hole numbers are stamped on below. */
type HoleRow = [par: number, yards: number, strokeIndex: number];

function holes(rows: HoleRow[]): Hole[] {
  return rows.map(([par, yards, strokeIndex], i) => ({
    number: i + 1,
    par,
    yards,
    strokeIndex,
  }));
}

export function courses2026(): Course[] {
  return [
    {
      id: 'conestoga',
      name: 'Conestoga Golf Club',
      location: 'Mesquite, NV',
      tee: 'Gold',
      par: 72,
      rating: 72.3,
      slope: 132,
      // OUT 36/3258 · IN 36/3493 · TOTAL 72/6751 — matches the printed card.
      holes: holes([
        [4, 388, 5],
        [3, 162, 15],
        [4, 366, 9],
        [4, 373, 1],
        [3, 188, 13],
        [5, 515, 3],
        [4, 285, 17],
        [4, 417, 7],
        [5, 564, 11],
        [3, 186, 14],
        [4, 460, 2],
        [5, 513, 16],
        [4, 378, 10],
        [3, 136, 18],
        [4, 438, 8],
        [5, 550, 12],
        [4, 388, 6],
        [4, 444, 4],
      ]),
    },
    {
      id: 'coral-canyon',
      name: 'Coral Canyon Golf Course',
      location: 'Washington, UT',
      tee: 'Blue',
      par: 72,
      rating: 72.6,
      slope: 143,
      // OUT 36/3373 · IN 36/3213 — the card's printed IN reads 3207, so these
      // holes total 6586 against a printed 6580. One back-nine hole is out by
      // 6 yards and could not be resolved from the card image. Yardage is
      // display-only and affects no scoring.
      holes: holes([
        [4, 378, 9],
        [3, 150, 15],
        [4, 413, 5],
        [3, 201, 7],
        [5, 550, 13],
        [4, 461, 1],
        [5, 493, 17],
        [3, 189, 11],
        [5, 538, 3],
        [4, 454, 6],
        [5, 568, 10],
        [3, 161, 12],
        [4, 369, 8],
        [4, 370, 2],
        [3, 110, 16],
        [5, 483, 18],
        [4, 290, 14],
        [4, 408, 4],
      ]),
      notes:
        'Back-nine yardages sum to 3213 against a printed IN of 3207 — one hole is out by 6 yards. Check against the physical card; par, stroke index, rating and slope are confirmed.',
    },
    {
      id: 'ledges',
      name: 'The Ledges Golf Club',
      location: 'St. George, UT',
      tee: 'Blue',
      par: 72,
      rating: 71.1,
      slope: 127,
      // OUT 36/3440 · IN 36/3275 · TOTAL 72/6715 — matches the printed card.
      // Re-rated: older online sources say 72.1/134; the current card is 71.1/127.
      holes: holes([
        [4, 376, 11],
        [3, 220, 13],
        [5, 538, 7],
        [4, 431, 1],
        [3, 166, 15],
        [4, 400, 5],
        [5, 556, 9],
        [4, 355, 17],
        [4, 398, 3],
        [3, 210, 16],
        [5, 511, 6],
        [3, 147, 18],
        [4, 397, 14],
        [4, 358, 12],
        [4, 297, 8],
        [5, 561, 2],
        [4, 381, 10],
        [4, 413, 4],
      ]),
    },
    {
      id: 'sand-hollow-links',
      name: 'Sand Hollow Resort — Links 9',
      location: 'Hurricane, UT',
      tee: 'Championship',
      par: 36,
      rating: 35.7,
      slope: 135,
      // Nine holes; OUT 36/3455 matches the card. Stroke indexes run 1–9.
      holes: holes([
        [4, 323, 9],
        [4, 391, 7],
        [5, 555, 4],
        [3, 167, 6],
        [4, 448, 3],
        [3, 141, 8],
        [4, 456, 1],
        [4, 410, 5],
        [5, 564, 2],
      ]),
      notes:
        'The 9-hole rating 35.7 is the printed 18-hole rating (71.4) halved, with slope 135 carried over. Confirm the official 9-hole rating with the pro shop — 9-hole ratings are not always an exact half, and this figure feeds every course handicap for the scramble.',
    },
    {
      id: 'sand-hollow-champ',
      name: 'Sand Hollow Resort — Championship',
      location: 'Hurricane, UT',
      tee: 'Championship',
      par: 72,
      rating: 72.2,
      slope: 132,
      // OUT 36/3562 · IN 36/3331 · TOTAL 72/6893 — matches the printed card.
      holes: holes([
        [4, 432, 15],
        [5, 556, 7],
        [3, 195, 17],
        [4, 439, 5],
        [4, 347, 13],
        [4, 468, 1],
        [5, 563, 3],
        [3, 158, 11],
        [4, 404, 9],
        [5, 534, 10],
        [3, 164, 16],
        [4, 432, 2],
        [4, 304, 14],
        [4, 433, 4],
        [3, 191, 8],
        [4, 355, 18],
        [5, 493, 12],
        [4, 425, 6],
      ]),
    },
  ];
}
