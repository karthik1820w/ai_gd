import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export default async function ParticipantLayout({ children }: { children: React.ReactNode }) {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role !== "PARTICIPANT") redirect("/host");
  return <Shell role="participant" name={user.name}>{children}</Shell>;
}
