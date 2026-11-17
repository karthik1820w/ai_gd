import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role !== "HOST") redirect("/participant");
  return <Shell role="host" name={user.name}>{children}</Shell>;
}
