/**
 * The client build generation. The server reports the oldest generation it
 * treats as current (`minClientVersion` on /api/trip); an older client shows
 * an update banner and reloads rather than keep scoring with stale rules.
 *
 *  1 — original (all-or-nothing score batches, no pickups)
 *  2 — per-entry batch outcomes, explicit pickups, policy-2 handicaps
 */
export const CLIENT_VERSION = 2;
