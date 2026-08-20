/**
 * Tee-time timezone labelling.
 *
 * Conestoga is in Mesquite, Nevada and runs on Pacific time. Every other venue
 * on the trip is in Utah, on Mountain time — an hour ahead. A 1:20 PM tee time
 * at Conestoga is 2:20 PM back in St. George, which is exactly the kind of
 * thing that makes someone miss their group.
 *
 * The zone is derived from the course's location rather than a new database
 * column, so this needs no schema change. Display only — no stored tee-time
 * string is rewritten, so admins keep editing the plain times they always have.
 */

export type TeeZone = 'PT' | 'MT';

/** Which timezone a course's tee times are quoted in, or null if unrecognised. */
export function zoneFor(course?: { location: string } | null): TeeZone | null {
  if (!course) return null;
  const where = course.location;
  if (/(,\s*NV\b)|nevada/i.test(where)) return 'PT';
  if (/(,\s*UT\b)|utah/i.test(where)) return 'MT';
  return null;
}

/** `"1:20 PM"` → `"1:20 PM PT"`. Left alone when the zone is unknown. */
export function withZone(time: string, zone: TeeZone | null): string {
  return zone ? `${time} ${zone}` : time;
}

const TIME = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i;

/** `"1:20 PM"` (Pacific) → `"2:20 PM"` (Mountain). Null if it can't be parsed. */
export function toMountain(time: string): string | null {
  const parsed = TIME.exec(time.trim());
  if (!parsed) return null;
  const hour12 = Number(parsed[1]) % 12;
  const isPm = parsed[3].toUpperCase() === 'PM';
  const minutes = ((hour12 + (isPm ? 12 : 0)) * 60 + Number(parsed[2]) + 60) % (24 * 60);
  const hour24 = Math.floor(minutes / 60);
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${display}:${String(minutes % 60).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

/**
 * The "…which is X back in St. George" note, for courses in another timezone.
 * Returns null when the course is already on Mountain time (nothing to warn
 * about) or when the times can't be parsed.
 */
export function mountainEquivalentNote(
  teeTimes: string[],
  zone: TeeZone | null,
): string | null {
  if (zone !== 'PT') return null;
  const converted = teeTimes.map(toMountain);
  if (!converted.length || converted.some((t) => t == null)) return null;
  return `Pacific time — an hour behind St. George. That's ${converted.join(' · ')} Mountain.`;
}
