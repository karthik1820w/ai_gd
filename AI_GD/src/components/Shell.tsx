"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, History, LogOut, Plus, Settings, UserRound, Video } from "lucide-react";

const hostLinks = [
  { href: "/host", label: "Overview", icon: History },
  { href: "/host/sessions/new", label: "New discussion", icon: Plus },
  { href: "/host/settings", label: "Settings", icon: Settings },
];
const participantLinks = [
  { href: "/participant", label: "Overview", icon: History },
  { href: "/participant/join", label: "Join", icon: Video },
  { href: "/participant/settings", label: "Settings", icon: Settings },
];

export function Shell({ role, name, children }: { role: "host" | "participant"; name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const links = role === "host" ? hostLinks : participantLinks;
  const [notes, setNotes] = useState<Array<{ id: string; title: string; body: string; href: string; readAt: string | null }>>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/notifications").then((res) => res.json()).then((data) => { if (!stop && Array.isArray(data)) setNotes(data); }).catch(() => undefined);
    load();
    const timer = setInterval(load, 20000);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  const unread = notes.filter((note) => !note.readAt).length;
  return (
    <div className="app-shell" data-role={role}>
      <a className="sr-only" href="#content">Skip to content</a>
      <aside className="sidebar">
        <Link href={role === "host" ? "/host" : "/participant"} className="brand"><span className="mark">Q</span> Quorum</Link>
        <p className="muted" style={{ fontSize: 13, margin: "8px 12px 18px" }}>{role === "host" ? "Host workspace" : "Participant workspace"}</p>
        <nav>
          {links.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return <Link key={link.href} href={link.href} className={`nav-link${active ? " active" : ""}`}><Icon size={16} />{link.label}</Link>;
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <strong>{name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>{role === "host" ? "You organise the discussion." : "You join with a code and speak for yourself."}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={16} /> {unread > 0 ? unread : "Alerts"}</button>
            <button className="btn btn-ghost" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); }}><LogOut size={16} /> Log out</button>
          </div>
        </header>
        {open && (
          <div className="content">
            <div className="card card-pad list">
              {notes.length === 0 && <p className="muted">No notifications yet.</p>}
              {notes.map((note) => (
                <a key={note.id} href={note.href || "#"} className="row-link card" onClick={() => fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [note.id] }) })}>
                  <span><strong>{note.title}</strong><br /><span className="muted">{note.body}</span></span>
                  {!note.readAt && <span className="pill">New</span>}
                </a>
              ))}
            </div>
          </div>
        )}
        <div id="content" className="content">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="card card-pad"><h2 className="serif" style={{ margin: "0 0 6px" }}>{title}</h2><p className="muted">{body}</p>{action}</div>;
}

export function Person({ name }: { name: string }) {
  return <span className="brand" style={{ gap: 8 }}><UserRound size={16} />{name}</span>;
}
