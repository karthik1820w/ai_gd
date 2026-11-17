export default function Loading() {
  return (
    <div className="rt-root" data-mode="sage" role="status" aria-live="polite">
      <header className="rt-top"><span className="rt-brand">Quorum</span></header>
      <main style={{ padding: "18px 22px" }}>
        <div className="skeleton" style={{ height: 30, width: "45%", marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 280, maxWidth: 640 }} />
        <span className="sr-only">Opening the meeting…</span>
      </main>
    </div>
  );
}
