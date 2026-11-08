import { json } from "@/lib/http";
import { aiEnabled } from "@/server/ai";

export async function GET() {
  return json({
    ai: aiEnabled(),
    media: Boolean(process.env.LIVEKIT_API_SECRET),
  });
}
