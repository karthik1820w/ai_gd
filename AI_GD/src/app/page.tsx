import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <header className="topbar" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
        <nav style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-ghost" href="/login">Sign in</Link>
          <Link className="btn btn-primary" href="/register">Create account</Link>
        </nav>
      </header>
      <section className="content" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <p className="pill">Group discussion, with a record you can explain</p>
        <h1 className="serif" style={{ fontSize: "clamp(40px, 6vw, 72px)", lineHeight: 1.02, maxWidth: 760, marginBottom: 12 }}>Every voice stays attached to the person who spoke.</h1>
        <p className="muted" style={{ fontSize: 18, maxWidth: 640 }}>Hosts open a discussion, share a link and access code, and run a live audio and video room. Quorum transcribes each microphone separately, checks what was said against the topic, and writes a report a participant can actually read.</p>
        <div style={{ display: "flex", gap: 10, margin: "22px 0 36px" }}>
          <Link className="btn btn-primary" href="/register">Create participant account</Link>
          <Link className="btn btn-ghost" href="/login">I have an account</Link>
        </div>
        <div className="grid-stats">
          {[
            ["1", "Create", "Set the topic, rules, time, and whether the moderator offers speaking turns."],
            ["2", "Meet", "People join with a code. Video goes through a media server, with mute, camera, chat, and screen share."],
            ["3", "Transcribe", "Each browser converts that person's microphone to text, so the speaker is known."],
            ["4", "Report", "Scores use six published weights and quotes from the transcript. Download a PDF."],
          ].map(([step, title, body]) => (
            <article key={step} className="card card-pad"><span className="pill">{step}</span><h2 className="serif" style={{ marginBottom: 6 }}>{title}</h2><p className="muted">{body}</p></article>
          ))}
        </div>
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <h2 className="serif">How a score is built</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["Topic relevance", "25%"],
                ["Communication and clarity", "20%"],
                ["Knowledge and content quality", "20%"],
                ["Participation and initiative", "15%"],
                ["Logical reasoning", "10%"],
                ["Listening and constructive engagement", "10%"],
              ].map(([name, weight]) => (
                <tr key={name}><td style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>{name}</td><td style={{ textAlign: "right" }}>{weight}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Appearance, accent, gender, and personality are not inputs. A muted invitation is not punished after someone has already taken a fair share of the discussion. If the microphone or speech recognition never worked, the report says the score is incomplete instead of inventing a low mark.</p>
        </div>
      </section>
    </main>
  );
}
