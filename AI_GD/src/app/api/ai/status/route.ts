import { json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { aiStatus } from "@/server/ai";

export async function GET() {
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  return json(aiStatus());
}
