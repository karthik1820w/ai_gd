import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { formatClock, formatWhen } from "@/lib/format";
import { Empty } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function ParticipantHome() {
  const user = await readSession();
  if (!user) redirect("/login");
  const memberships = await prisma.discussionParticipant.findMany({
    where: { userId: user.id, removed: false },
    include: { discussion: true, evaluation: true },
    orderBy: { createdAt: "desc" },
  });
  const upcoming = memberships.filter((item) => item.discussion.status === "SCHEDULED" || item.discussion.status === "LIVE");
  const past = memberships.filter((item) => item.discussion.status === "COMPLETED");
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}>
        <div>
          <p className="muted">Welcome</p>
          <h1 className="serif" style={{ margin: 0 }}>{user.name}</h1>
        </div>
        <Link className="btn btn-primary" href="/participant/join">Join GD</Link>
      </div>
      <div className="card card-pad" style={{ margin: "16px 0" }}>
        <h2 className="serif" style={{ marginTop: 0 }}>Profile</h2>
        <p>{user.email}<br /><span className="muted">Participant · speech language {user.speechLang}</span></p>
      </div>
      <h2 className="serif">Upcoming and live</h2>
      {upcoming.length === 0 ? <Empty title="Nothing scheduled" body="Join with a meeting link or access code when a host invites you." action={<Link className="btn btn-ghost" href="/participant/join">Join</Link>} /> : (
        <div className="list">{upcoming.map((item) => <SessionRow key={item.id} item={item} />)}</div>
      )}
      <h2 className="serif">Previous discussions</h2>
      {past.length === 0 ? <Empty title="No past discussions" body="Reports appear here after a host ends a session you attended." /> : (
        <div className="list">{past.map((item) => <SessionRow key={item.id} item={item} />)}</div>
      )}
    </>
  );
}

function SessionRow({ item }: { item: { id: string; discussion: { id: string; title: string; topic: string; status: string; scheduledAt: Date; meetingId: string }; evaluation: { overallScore: number | null; adjustedScore: number | null; category: string; speakingMs: number } | null } }) {
  const score = item.evaluation?.adjustedScore ?? item.evaluation?.overallScore;
  return (
    <Link href={item.discussion.status === "COMPLETED" ? `/participant/reports/${item.discussion.id}` : `/meeting/${item.discussion.meetingId}`} className="card row-link">
      <span><strong>{item.discussion.title}</strong><br /><span className="muted">{item.discussion.topic} · {formatWhen(item.discussion.scheduledAt)}</span></span>
      <span className="pill">{item.discussion.status === "COMPLETED" ? (score == null ? item.evaluation?.category ?? "Report" : `${score.toFixed(0)} / 100`) : item.discussion.status}{item.evaluation ? ` · ${formatClock(item.evaluation.speakingMs)}` : ""}</span>
    </Link>
  );
}
