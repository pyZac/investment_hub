import { isFriday } from "./interest-rate";
import { prisma } from "./prisma";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";

/**
 * Thrown by every self-service withdrawal/transfer/capital-release action
 * when attempted outside Fridays (Asia/Dubai). The client-side countdown is a
 * UX convenience only — this is the actual enforcement point.
 */
export class NotFridayError extends Error {
  constructor() {
    super("This action is only available on Fridays (Asia/Dubai time).");
    this.name = "NotFridayError";
  }
}

/**
 * Guards Friday-only self-service actions (A->B profit transfer, capital
 * release, and B-exit submission — every real caller of this function).
 * Does not apply to C->B (no Friday gate at all, a deliberate earlier
 * change) or to B-exit admin approval/rejection, which may happen on any
 * day per the phase brief.
 *
 * Async since SCRUM (Developer Tools, 2026-09-24): reads the
 * `developer_tools_settings` singleton row's `bypassFridayGate` flag — when
 * an admin has turned this on (Developer Tools page, production-health
 * testing only), every caller below passes regardless of the real day.
 * This is the single enforcement point for that bypass, matching the
 * existing pattern of `assertFriday` being the one place all three real
 * call sites route through — no caller needs its own bypass-awareness.
 *
 * Takes `forDate` as a parameter and never calls `new Date()` internally
 * (invariant #4) — callers pass `new Date()` once at the action boundary.
 */
export async function assertFriday(forDate: Date): Promise<void> {
  const settings = await prisma.developerToolsSetting.findUnique({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
  });
  if (settings?.bypassFridayGate) {
    return;
  }

  if (!isFriday(forDate)) {
    throw new NotFridayError();
  }
}
