import { prisma } from "../src/lib/prisma";
import { config } from "../src/lib/config";
import { hashPassword } from "../src/lib/password";

async function main() {
  const existing = await prisma.user.findFirst({ where: { isMainAdmin: true } });
  if (existing) {
    console.log(`Main admin already exists (${existing.email}) — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(config.SEED_ADMIN_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: config.SEED_ADMIN_EMAIL,
      passwordHash,
      name: "Main Admin",
      role: "ADMIN",
      isMainAdmin: true,
    },
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
