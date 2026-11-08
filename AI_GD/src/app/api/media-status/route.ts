import { json } from "@/lib/http";
import { getMediaStatus } from "@/server/media";

export async function GET() {
  const status = await getMediaStatus();
  return json({ ready: status.ready, error: status.error }, status.ready ? 200 : 503);
}
