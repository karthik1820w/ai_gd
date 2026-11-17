/** Shown the instant a page is clicked, while its data loads. Plain markup: no JavaScript, nothing to wait for. */
export function PageSkeleton({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      <div className="skeleton" style={{ height: 14, width: 120, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 30, width: "40%", marginBottom: 20 }} />
      {Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton card" style={{ height: 76, marginBottom: 12 }} />)}
      <span className="sr-only">{label}…</span>
    </div>
  );
}
