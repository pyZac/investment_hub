import { prisma } from "../src/lib/prisma";
import { seedPackageTiers } from "../src/lib/packages";

async function main() {
  await seedPackageTiers();
  const count = await prisma.package.count();
  console.log(`Package tiers seeded. Total packages in DB: ${count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
