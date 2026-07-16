/**
 * Shared CRON_SECRET check for cron/maintenance routes. Accepts the secret via
 * `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. Denies when
 * CRON_SECRET is unset so a misconfigured deployment fails closed, not open.
 */
export function isCronAuthorized(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";
  return bearer === configured || header === configured;
}
