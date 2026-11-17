"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Horizontal bars, one per criterion. Long criterion names sit on the left where they always fit,
 * so no label is dropped (the vertical version hid some names when they collided).
 */
export function ScoreChart({ rows }: { rows: Array<{ name: string; score: number; weight?: number }> }) {
  if (!rows.length) return <p className="muted">No chart yet.</p>;
  return (
    <div style={{ width: "100%", height: Math.max(120, rows.length * 40 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
          <YAxis type="category" dataKey="name" width={200} interval={0} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="score" radius={6} label={{ position: "right", fontSize: 12 }}>
            {rows.map((row) => <Cell key={row.name} fill="#0e6b52" />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
