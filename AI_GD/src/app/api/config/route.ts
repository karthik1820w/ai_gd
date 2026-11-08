import { json } from "@/lib/http";
import { aiEnabled } from "@/server/ai";
import { getMediaStatus } from "@/server/media";

export async function GET() {
  const media = await getMediaStatus();
  return json({
    ai: aiEnabled(),
    media: media.ready,
  });
}
