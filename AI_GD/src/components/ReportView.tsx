"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ScoreChart({ rows }: { rows: Array<{ name: string; score: number; weight?: number }> }) {
  if (!rows.length) return <p className="muted">No chart yet.</p>;
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={rows}>
          <XAxis dataKey="name" hide={rows.length > 6} />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Bar dataKey="score" fill="#0e6b52" radius={6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
