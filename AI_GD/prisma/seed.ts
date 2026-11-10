import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { HOST_EMAIL } from "../src/lib/roles";

const prisma = new PrismaClient();
const participantEmail = process.env.SEED_PARTICIPANT_EMAIL || "participant@quorum.local";
const password = process.env.SEED_PASSWORD;

async function upsert(email: string, name: string, role: "HOST" | "PARTICIPANT") {
  if (!password || password.length < 16 || password.startsWith("replace-with-") || password === "Quorum-demo-2026") {
    throw new Error("Set a unique SEED_PASSWORD of at least 16 characters in .env before provisioning accounts.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  if (participantEmail.toLowerCase() === HOST_EMAIL) {
    throw new Error("SEED_PARTICIPANT_EMAIL must be different from the fixed host email.");
  }
  await prisma.user.updateMany({
    where: { role: "HOST", email: { not: HOST_EMAIL } },
    data: { role: "PARTICIPANT" },
  });
  await upsert(HOST_EMAIL, "Host", "HOST");
  await upsert(participantEmail, "Rahul Iyer", "PARTICIPANT");
  console.log(`Provisioned host ${HOST_EMAIL} and participant ${participantEmail}.`);
  console.log("Password is the SEED_PASSWORD value from .env.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
