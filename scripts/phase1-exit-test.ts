/**
 * Phase 1 exit test (SCRUM-31) — run via `npx tsx scripts/phase1-exit-test.ts`.
 * Calls the real library functions directly for steps with no HTTP route yet
 * (registration, security-question reset, admin manual reset, route guard);
 * login/logout/TOTP are exercised over HTTP against a running dev server
 * since those already have real routes. Not a reimplementation of any logic.
 */
import * as OTPAuth from "otpauth";
import { prisma } from "../src/lib/prisma";
import { registerWithSponsor, registerAsRoot } from "../src/lib/users";
import { resetPasswordViaSecurityQuestions, adminResetPassword } from "../src/lib/security-questions";
import { requirePermission, requireAdmin, AuthError } from "../src/lib/route-guard";

const BASE_URL = process.env.EXIT_TEST_BASE_URL ?? "http://localhost:3001";

let step = 0;
function log(title: string, detail: unknown) {
  step += 1;
  console.log(`\n=== Step ${step}: ${title} ===`);
  console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

function fail(title: string, detail: unknown): never {
  console.error(`\n!!! FAILED at "${title}" !!!`);
  console.error(detail);
  process.exit(1);
}

const cleanupUserIds: string[] = [];

async function main() {
  // Every request in this script shares one source IP. Clear any leftover
  // rate-limit/lockout state from a prior run of this script so runs are
  // independent of each other and of real wall-clock timing.
  await prisma.securityEvent.deleteMany({ where: { type: { in: ["LOGIN_FAILED", "ACCOUNT_LOCKED"] } } });

  const sampleQuestions = [
    { question: "First pet's name?", answer: "Fluffy" },
    { question: "Mother's maiden name?", answer: "Smith" },
    { question: "First school?", answer: "Oakwood" },
  ];

  // --- Registration: root user, then a referred user under them ---
  const rootEmail = `exit-root-${crypto.randomUUID()}@test.local`;
  const root = await registerAsRoot({
    email: rootEmail,
    password: "rootPassword123",
    name: "Exit Test Root",
    securityQuestions: sampleQuestions,
  });
  cleanupUserIds.push(root.id);
  if (root.sponsorId !== null) fail("root registration", "expected sponsorId to be null");
  log("Registered root user (no referral code)", { id: root.id, email: root.email, sponsorId: root.sponsorId });

  const referredEmail = `exit-referred-${crypto.randomUUID()}@test.local`;
  const referred = await registerWithSponsor(root.id, {
    email: referredEmail,
    password: "referredPassword123",
    name: "Exit Test Referred",
    securityQuestions: sampleQuestions,
  });
  cleanupUserIds.push(referred.id);
  if (referred.sponsorId !== root.id) fail("referred registration", "expected sponsorId to equal root.id");
  log("Registered second user under the first user's referral link", {
    id: referred.id,
    email: referred.email,
    sponsorId: referred.sponsorId,
  });

  const secondReferredEmail = `exit-referred2-${crypto.randomUUID()}@test.local`;
  const secondReferred = await registerWithSponsor(root.id, {
    email: secondReferredEmail,
    password: "referred2Password123",
    name: "Exit Test Referred 2",
    securityQuestions: sampleQuestions,
  });
  cleanupUserIds.push(secondReferred.id);
  log("Registered a third user, also under the root's referral link", {
    id: secondReferred.id,
    email: secondReferred.email,
    sponsorId: secondReferred.sponsorId,
  });

  // --- Login as each self-registered user (HTTP, real route) ---
  async function loginHttp(email: string, password: string) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    return { status: res.status, body, setCookie: res.headers.get("set-cookie") };
  }

  const rootLogin = await loginHttp(rootEmail, "rootPassword123");
  if (rootLogin.status !== 200 || rootLogin.body.status !== "authenticated") {
    fail("root login", rootLogin);
  }
  log("Logged in as the root user", rootLogin);

  const referredLogin = await loginHttp(referredEmail, "referredPassword123");
  if (referredLogin.status !== 200 || referredLogin.body.status !== "authenticated") {
    fail("referred login", referredLogin);
  }
  log("Logged in as the referred user", referredLogin);

  // --- Admin route blocked for a normal user (route guard, not HTTP — no admin routes exist until Phase 6) ---
  try {
    await requirePermission("USER_MANAGEMENT", new Date(), "not-a-real-admin-session-token");
    fail("admin route guard", "expected AuthError for an invalid/non-admin token but none was thrown");
  } catch (err) {
    if (!(err instanceof AuthError)) fail("admin route guard", err);
    log("Confirmed the permission guard rejects a request with no valid admin session", {
      errorMessage: err.message,
      status: err.status,
    });
  }

  const rootAsPlainUser = await prisma.user.findUniqueOrThrow({ where: { id: root.id } });
  if (rootAsPlainUser.role !== "USER") fail("admin route guard setup", "expected root to be role USER");
  console.log(
    "  (root user's role is USER, not ADMIN — requireAdmin()/requirePermission() reject it by construction; " +
      "see route-guard.test.ts for direct coverage of this exact case with a real session token)",
  );

  // --- Self-service password reset via security questions ---
  await resetPasswordViaSecurityQuestions(
    { email: rootEmail, answers: ["Fluffy", "Smith", "Oakwood"], newPassword: "rootNewPassword456" },
    new Date(),
    "203.0.113.10",
  );
  const rootLoginAfterReset = await loginHttp(rootEmail, "rootNewPassword456");
  if (rootLoginAfterReset.status !== 200 || rootLoginAfterReset.body.status !== "authenticated") {
    fail("post-reset login", rootLoginAfterReset);
  }
  log("Root user reset their own password via security questions, then logged in with the new password", {
    resetAnswers: ["Fluffy", "Smith", "Oakwood"],
    loginAfterReset: rootLoginAfterReset,
  });

  // --- Admin manual password reset ---
  const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  await adminResetPassword(mainAdmin.id, referred.id, {
    newPassword: "adminSetPassword789",
    reason: "Exit test: admin manual reset.",
  });
  const referredLoginAfterAdminReset = await loginHttp(referredEmail, "adminSetPassword789");
  if (referredLoginAfterAdminReset.status !== 200 || referredLoginAfterAdminReset.body.status !== "authenticated") {
    fail("post-admin-reset login", referredLoginAfterAdminReset);
  }
  const adminResetEvent = await prisma.adminAction.findFirst({
    where: { targetUserId: referred.id, actionType: "PASSWORD_RESET" },
    orderBy: { createdAt: "desc" },
  });
  log("Main admin manually reset the referred user's password, logged to admin_actions", {
    adminActionRow: adminResetEvent,
    loginWithAdminSetPassword: referredLoginAfterAdminReset,
  });

  // --- Main admin reaches every admin function with no explicit grants ---
  const allPermissions = [
    "CREDIT_ISSUANCE",
    "WITHDRAWAL_APPROVAL",
    "USER_MANAGEMENT",
    "PACKAGE_MANAGEMENT",
    "RATE_CONFIG",
    "COMMISSION_CONFIG",
    "RANK_CONFIG",
    "LEDGER_VIEW",
    "MANUAL_ADJUSTMENT",
    "JOB_MONITOR",
    "SOLVENCY_VIEW",
  ] as const;

  const grantCount = await prisma.adminPermissionGrant.count({ where: { adminUserId: mainAdmin.id } });
  if (grantCount !== 0) fail("main admin grant check", `expected 0 explicit grants, found ${grantCount}`);

  // Main admin needs a real session token for requirePermission (goes through requireAdmin -> requireSession).
  const { randomBytes, createHash } = await import("node:crypto");
  const mainAdminToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId: mainAdmin.id,
      tokenHash: createHash("sha256").update(mainAdminToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const results: Record<string, boolean> = {};
  for (const permission of allPermissions) {
    try {
      await requirePermission(permission, new Date(), mainAdminToken);
      results[permission] = true;
    } catch {
      results[permission] = false;
    }
  }
  await prisma.session.deleteMany({ where: { userId: mainAdmin.id, tokenHash: createHash("sha256").update(mainAdminToken).digest("hex") } });

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) fail("main admin permission bypass", results);
  log(`Main admin (0 explicit admin_permission_grants rows) passes requirePermission() for all ${allPermissions.length} catalog permissions`, results);

  // --- Repeated failed logins trigger lockout ---
  const lockoutTargetEmail = referredEmail;
  const failedAttempts: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await loginHttp(lockoutTargetEmail, `wrong-password-${i}`);
    failedAttempts.push({ attempt: i + 1, status: res.status, body: res.body });
  }
  const lockedOutAttempt = await loginHttp(lockoutTargetEmail, "adminSetPassword789");
  const lockEvent = await prisma.securityEvent.findFirst({
    where: { type: "ACCOUNT_LOCKED", email: lockoutTargetEmail },
    orderBy: { createdAt: "desc" },
  });
  if (lockedOutAttempt.status !== 429 || !lockEvent) {
    fail("lockout", { failedAttempts, lockedOutAttempt, lockEvent });
  }
  log("5 failed login attempts triggered a lockout; the 6th attempt (with the correct password) was rejected and logged as a visible security event", {
    failedAttempts,
    sixthAttemptWithCorrectPassword: lockedOutAttempt,
    securityEventRow: lockEvent,
  });

  // --- Admin login requires a valid TOTP code after the password ---
  // The previous section's 5 failed attempts also tripped the per-IP lockout
  // (every request in this script shares one source IP) — clear that lockout
  // state so it doesn't cross-contaminate this unrelated exit-test scenario.
  await prisma.securityEvent.deleteMany({ where: { type: { in: ["LOGIN_FAILED", "ACCOUNT_LOCKED"] } } });

  await prisma.user.update({ where: { id: mainAdmin.id }, data: { totpSecret: null, totpEnrolledAt: null } });

  const adminPasswordOnlyLogin = await loginHttp(mainAdmin.email, "change-me-now");
  if (adminPasswordOnlyLogin.status !== 200 || adminPasswordOnlyLogin.body.status !== "totp_enrollment_required") {
    fail("admin password-only login (no TOTP enrolled)", adminPasswordOnlyLogin);
  }
  log("Main admin login with correct password but no TOTP enrolled does NOT return a session — enrollment is required first", adminPasswordOnlyLogin);

  const enrollRes = await fetch(`${BASE_URL}/api/auth/totp/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken: adminPasswordOnlyLogin.body.pendingToken }),
  });
  const enrollBody = await enrollRes.json();
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(enrollBody.secret),
  });
  const confirmRes = await fetch(`${BASE_URL}/api/auth/totp/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pendingToken: enrollBody.pendingToken,
      secret: enrollBody.secret,
      code: totp.generate(),
    }),
  });
  const confirmBody = await confirmRes.json();
  if (confirmRes.status !== 200) fail("TOTP enrollment confirm", confirmBody);
  log("Enrolled TOTP for the main admin (secret generated, confirmed with a real generated code, session created)", {
    enrolled: true,
    user: confirmBody.user,
  });

  await prisma.session.deleteMany({ where: { userId: mainAdmin.id } });

  const secondAdminLogin = await loginHttp(mainAdmin.email, "change-me-now");
  if (secondAdminLogin.status !== 200 || secondAdminLogin.body.status !== "totp_required") {
    fail("admin login after enrollment (expect totp_required, not a session)", secondAdminLogin);
  }
  log("Second login attempt with the correct password now returns totp_required (not a session, not re-enrollment)", secondAdminLogin);

  const wrongCodeRes = await fetch(`${BASE_URL}/api/auth/totp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken: secondAdminLogin.body.pendingToken, code: "000000" }),
  });
  const wrongCodeBody = await wrongCodeRes.json();
  if (wrongCodeRes.status !== 401) fail("wrong TOTP code", { status: wrongCodeRes.status, body: wrongCodeBody });
  log("A wrong TOTP code after the correct password is rejected with no session", {
    status: wrongCodeRes.status,
    body: wrongCodeBody,
  });

  const thirdAdminLogin = await loginHttp(mainAdmin.email, "change-me-now");
  const correctCode = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(enrollBody.secret),
  }).generate();
  const verifyRes = await fetch(`${BASE_URL}/api/auth/totp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken: thirdAdminLogin.body.pendingToken, code: correctCode }),
  });
  const verifyBody = await verifyRes.json();
  if (verifyRes.status !== 200) fail("correct TOTP code", { status: verifyRes.status, body: verifyBody });
  log("A correct TOTP code after the correct password creates a real session — full admin login sequence confirmed", {
    status: verifyRes.status,
    body: verifyBody,
    setCookie: verifyRes.headers.get("set-cookie"),
  });

  console.log("\n=== ALL PHASE 1 EXIT TEST STEPS PASSED ===");
}

async function cleanup() {
  const mainAdmin = await prisma.user.findFirst({ where: { isMainAdmin: true } });
  if (mainAdmin) {
    await prisma.session.deleteMany({ where: { userId: mainAdmin.id } });
    await prisma.securityEvent.deleteMany({ where: { userId: mainAdmin.id } });
    await prisma.user.update({
      where: { id: mainAdmin.id },
      data: { totpSecret: null, totpEnrolledAt: null },
    });
  }
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: cleanupUserIds } }, { adminId: { in: cleanupUserIds } }] },
  });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
}

main()
  .catch((err) => {
    console.error("\n!!! EXIT TEST THREW AN UNEXPECTED ERROR !!!");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
