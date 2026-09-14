import { describe, expect, it, beforeAll } from "vitest";

/**
 * Security headers (SCRUM-120) are set via `next.config.ts`'s `headers()`
 * function, which only takes effect through Next.js's own server — unlike
 * every other test file in this project (which calls lib functions
 * directly against the real DB), this one requires the actual running app
 * server (docker compose's `app` service on localhost:3000) and makes real
 * HTTP requests, matching this ticket's own "curl -I against live routes"
 * verification instruction. If the server isn't reachable, every test
 * below fails with a clear connection-refused error rather than a
 * misleading assertion failure — start `docker compose up app` (or
 * `npm run dev`) before running this file.
 */
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

const REQUIRED_HEADERS: Record<string, string> = {
  "content-security-policy": "", // presence + shape checked separately below
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const ROUTES_TO_CHECK = [
  "/", // root, redirects to a locale
  "/en/login", // public page
  "/api/health", // API route
  "/en/transactions", // protected page — redirects to /login, headers must still be present
];

async function fetchHeaders(path: string): Promise<Headers> {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return response.headers;
}

describe("security headers", () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the server isn't up, rather than
    // letting every individual test time out independently.
    try {
      await fetch(BASE_URL, { redirect: "manual" });
    } catch (err) {
      throw new Error(
        `Cannot reach ${BASE_URL} — start the app server first (docker compose up app, or npm run dev). ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  for (const route of ROUTES_TO_CHECK) {
    it(`sets all required security headers on ${route}`, async () => {
      const headers = await fetchHeaders(route);

      for (const [name, expectedValue] of Object.entries(REQUIRED_HEADERS)) {
        expect(headers.has(name), `missing header "${name}" on ${route}`).toBe(true);
        if (expectedValue) {
          expect(headers.get(name)).toBe(expectedValue);
        }
      }
    });
  }

  it("the CSP actually restricts sources rather than being a no-op wildcard", async () => {
    const headers = await fetchHeaders("/en/login");
    const csp = headers.get("content-security-policy");

    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Never a blanket wildcard default-src — that would defeat the point
    // of having a policy at all.
    expect(csp).not.toMatch(/default-src\s+\*/);
  });

  it("X-Frame-Options is present on every checked route, not just the homepage", async () => {
    for (const route of ROUTES_TO_CHECK) {
      const headers = await fetchHeaders(route);
      expect(headers.get("x-frame-options"), `missing on ${route}`).toBe("DENY");
    }
  });
});
