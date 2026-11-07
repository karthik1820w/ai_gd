import { readSession } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { getIceServers } from "@/server/ice";

export async function GET() {
  const user = await readSession();
  if (!user) return fail("Sign in required.", 401);
  const iceServers = getIceServers(user.id);
  return json({ iceServers });
}
