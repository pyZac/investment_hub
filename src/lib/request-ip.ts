/**
 * Best-effort client IP extraction. Trusts X-Forwarded-For because this app
 * always runs behind the reverse proxy set up in Docker Compose — never
 * exposed directly to the internet. Falls back to a fixed key so rate
 * limiting still functions (conservatively, shared across untraceable
 * clients) if no proxy header is present, e.g. in local dev.
 */
export function requestIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}
