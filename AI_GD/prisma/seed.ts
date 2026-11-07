import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const hostEmail = process.env.SEED_HOST_EMAIL || "host@quorum.local";
const participantEmail = process.env.SEED_PARTICIPANT_EMAIL || "participant@quorum.local";
const password = process.env.SEED_PASSWORD || "Quorum-demo-2026";

async function upsert(email: string, name: string, role: "HOST" | "PARTICIPANT") {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  await upsert(hostEmail, "Asha Menon", "HOST");
  await upsert(participantEmail, "Rahul Iyer", "PARTICIPANT");
  console.log(`Seeded host ${hostEmail} and participant ${participantEmail}.`);
  console.log("Password is the SEED_PASSWORD value from .env.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
