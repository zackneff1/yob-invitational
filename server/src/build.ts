/**
 * A non-secret identifier of the running build, so the deployed version can
 * be verified from the outside (`GET /api/health` and the admin export).
 *
 * Render sets RENDER_GIT_COMMIT on every deploy; BUILD_ID is a manual
 * fallback for other hosts. Locally this is just "dev".
 */
export const BUILD_ID: string = (
  process.env.RENDER_GIT_COMMIT ??
  process.env.BUILD_ID ??
  'dev'
).slice(0, 12);

/** Oldest client build the server will treat as current. */
export const MIN_CLIENT_VERSION = 2;
