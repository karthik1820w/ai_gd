import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readHostConfig } from "../src/lib/hostAccount";

// Optional: the host account is also created automatically the first time the host signs in.
const prisma = new PrismaClient();

async function main() {
  const config = readHostConfig();
  if (!config.ok) throw new Error(config.error);
  const passwordHash = await bcrypt.hash(config.password, 12);
  await prisma.user.upsert({
    where: { email: config.email },
    create: { email: config.email, name: "Host", role: "HOST", passwordHash },
    update: { role: "HOST", passwordHash },
  });
  await prisma.user.updateMany({ where: { role: "HOST", email: { not: config.email } }, data: { role: "PARTICIPANT" } });
  console.log(`Host account ready: ${config.email}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
