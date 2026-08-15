import { prisma } from "../src/lib/prisma";
import { config } from "../src/lib/config";
import { hashPassword } from "../src/lib/password";
import { createWalletsForUser } from "../src/lib/wallets";

async function main() {
  const existing = await prisma.user.findFirst({ where: { isMainAdmin: true } });
  if (existing) {
    console.log(`Main admin already exists (${existing.email}) — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(config.SEED_ADMIN_PASSWORD);

  const admin = await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        email: config.SEED_ADMIN_EMAIL,
        passwordHash,
        name: "Main Admin",
        role: "ADMIN",
        isMainAdmin: true,
      },
    });

    await createWalletsForUser(tx, admin.id);

    return admin;
  });

  console.log(`Main admin created: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
