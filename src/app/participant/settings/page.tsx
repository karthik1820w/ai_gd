import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";

export default async function ParticipantSettings() {
  const user = await readSession();
  if (!user) redirect("/login");
  return <SettingsForm name={user.name} email={user.email} speechLang={user.speechLang} />;
}
