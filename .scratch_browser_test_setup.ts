import { prisma } from "./src/lib/prisma";
import { registerAsRoot } from "./src/lib/users";
import { adminCreditWalletB } from "./src/lib/admin-credit";
import { createSession, sessionCookieOptions } from "./src/lib/session";

async function main() {
  const email = "browser-test@test.local";
  const password = "password123";

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await registerAsRoot({
      email,
      password,
      name: "Browser Test User",
      securityQuestions: [
        { question: "First pet's name?", answer: "Fluffy" },
        { question: "Mother's maiden name?", answer: "Smith" },
        { question: "First school?", answer: "Oakwood" },
      ],
    });
    console.log("Created user:", user.id);
  } else {
    console.log("User already exists:", user.id);
  }

  const walletB = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId: user.id, type: "B" } },
  });

  if (walletB.balance.isZero()) {
    const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "5000",
      reason: "Browser test funding.",
      idempotencyKey: `browser-test-fund:${user.id}`,
    });
    console.log("Funded Wallet B with 5000");
  } else {
    console.log("Wallet B already funded:", walletB.balance.toString());
  }

  const { token, expiresAt } = await createSession(user.id, "USER", new Date());
  console.log("\n--- Session token (paste as the 'session' cookie value) ---");
  console.log(token);
  console.log("Expires:", expiresAt.toISOString());
  console.log("Cookie options used by the app:", JSON.stringify(sessionCookieOptions));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
