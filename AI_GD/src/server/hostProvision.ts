import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { HostConfig } from "@/lib/hostAccount";

/**
 * Create or refresh the host user from the environment. Called after the host
 * password has been verified against HOST_PASSWORD, so the stored hash always
 * follows the environment value and no one else can hold the host role.
 */
export async function provisionHost(config: Extract<HostConfig, { ok: true }>) {
  const existing = await prisma.user.findUnique({ where: { email: config.email } });
  const passwordHash = existing && (await bcrypt.compare(config.password, existing.passwordHash))
    ? existing.passwordHash
    : await bcrypt.hash(config.password, 12);
  const user = await prisma.user.upsert({
    where: { email: config.email },
    create: { email: config.email, name: "Host", role: "HOST", passwordHash },
    update: { role: "HOST", passwordHash },
  });
  await prisma.user.updateMany({ where: { role: "HOST", email: { not: config.email } }, data: { role: "PARTICIPANT" } });
  return user;
}
