import { isFriday } from "./interest-rate";

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
 * Guards Friday-only self-service actions (A->B, C->B, capital release, and
 * B-exit submission). Takes `forDate` as a parameter and never calls
 * `new Date()` internally (invariant #4) — callers pass `new Date()` once at
 * the action boundary. Does not apply to B-exit admin approval/rejection,
 * which may happen on any day per the phase brief.
 */
export function assertFriday(forDate: Date): void {
  if (!isFriday(forDate)) {
    throw new NotFridayError();
  }
}
