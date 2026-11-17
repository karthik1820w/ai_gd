import { cookies } from "next/headers";
import { COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return json({ ok: true });
}
