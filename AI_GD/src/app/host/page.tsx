import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import { Empty } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function HostHome() {
  const user = await readSession();
  if (!user) redirect("/login");
  const discussions = await prisma.discussion.findMany({
    where: { hostId: user.id },
    orderBy: { scheduledAt: "desc" },
    include: { participants: { where: { removed: false, userId: { not: user.id } }, select: { id: true } } },
  });
  const hosted = await prisma.discussionParticipant.count({ where: { discussion: { hostId: user.id }, removed: false, userId: { not: user.id } } });
  const groups = [
    ["Live now", discussions.filter((item) => item.status === "LIVE")],
    ["Upcoming", discussions.filter((item) => item.status === "SCHEDULED")],
    ["Completed", discussions.filter((item) => item.status === "COMPLETED")],
  ] as const;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}>
        <div>
          <p className="muted">Welcome back</p>
          <h1 className="serif" style={{ margin: 0 }}>{user.name}</h1>
        </div>
        <Link className="btn btn-primary" href="/host/sessions/new">Create new GD</Link>
      </div>
      <div className="grid-stats" style={{ margin: "18px 0" }}>
        <article className="card card-pad stat"><span className="muted">Discussions</span><strong>{discussions.length}</strong></article>
        <article className="card card-pad stat"><span className="muted">Live</span><strong>{discussions.filter((item) => item.status === "LIVE").length}</strong></article>
        <article className="card card-pad stat"><span className="muted">Participants hosted</span><strong>{hosted}</strong></article>
        <article className="card card-pad stat"><span className="muted">Reports</span><strong>{discussions.filter((item) => item.status === "COMPLETED").length}</strong></article>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="serif" style={{ marginTop: 0 }}>Profile</h2>
        <p>{user.email}<br /><span className="muted">Host · speech language {user.speechLang}</span></p>
      </div>
      {groups.map(([label, items]) => (
        <section key={label} style={{ marginBottom: 18 }}>
          <h2 className="serif">{label}</h2>
          {items.length === 0 ? <Empty title={`No ${label.toLowerCase()} sessions`} body="Create a discussion when you are ready to invite people." /> : (
            <div className="list">
              {items.map((item) => (
                <Link key={item.id} href={`/host/sessions/${item.id}`} className="card row-link">
                  <span><strong>{item.title}</strong><br /><span className="muted">{item.topic} · {formatWhen(item.scheduledAt)}</span></span>
                  <span className="pill">{item.participants.length} {item.participants.length === 1 ? "participant" : "participants"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
