/**
 * Tee-time display.
 *
 * Every time in the app is shown in St. George time (Mountain), because that
 * is the clock everyone is living on for the weekend. The one wrinkle is
 * Conestoga: it is in Mesquite, Nevada, on Pacific time, and its tee sheet is
 * stored the way the course quotes it ("1:20 PM" Pacific). For display that is
 * shifted an hour later so it lines up with everything else, and the course
 * note points out that the clocks at Conestoga itself will read an hour behind.
 *
 * The zone is derived from the course's location rather than a new database
 * column, so this needs no schema change. Display only — no stored tee-time
 * string is rewritten, so admins keep editing the plain times they always have.
 */

export type TeeZone = 'PT' | 'MT';

/** Which timezone a course's stored tee times are quoted in, or null if unrecognised. */
export function zoneFor(course?: { location: string } | null): TeeZone | null {
  if (!course) return null;
  const where = course.location;
  if (/(,\s*NV\b)|nevada/i.test(where)) return 'PT';
  if (/(,\s*UT\b)|utah/i.test(where)) return 'MT';
  return null;
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

/** A stored tee time as the group experiences it: St. George (Mountain) time. */
export function localTime(time: string, zone: TeeZone | null): string {
  if (zone === 'PT') return toMountain(time) ?? time;
  return time;
}

/**
 * The "clocks at the course are an hour behind" note, for courses outside
 * Mountain time. Null when there is nothing to warn about.
 */
export function courseClockNote(teeTimes: string[], zone: TeeZone | null): string | null {
  if (zone !== 'PT') return null;
  const local = teeTimes.map((t) => localTime(t, zone));
  return `Times shown are St. George time. Conestoga's clocks run on Pacific, an hour behind — the tee sheet there will read ${teeTimes.join(' · ')} for our ${local.join(' · ')} groups.`;
}
