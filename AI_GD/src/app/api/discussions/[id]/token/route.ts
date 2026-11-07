import { prisma } from "@/lib/db";
import { fail, guardOrigin, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { createRoomToken, livekitPublicUrl } from "@/server/livekit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!discussion || discussion.status === "CANCELLED" || discussion.status === "COMPLETED") return fail("This discussion is not open.", 409);
  const membership = discussion.participants.find((person) => person.userId === user.id && !person.removed);
  const isHost = discussion.hostId === user.id;
  if (!isHost && !membership) return fail("Join from the lobby before connecting video.", 403);
  const token = await createRoomToken({
    room: discussion.meetingId,
    identity: user.id,
    name: membership?.displayName || user.name,
    admin: isHost,
  });
  return json({ token, url: livekitPublicUrl(request) });
}
