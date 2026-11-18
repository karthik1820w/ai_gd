"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { SeatInfo } from "../types";
import { createAssets } from "./assets";
import { CameraRig } from "./CameraRig";
import { Character } from "./Character";
import { ringRadius, seatWorldPositions, type SeatWorld, type Tier } from "./seat3d";
import { TableModel } from "./TableModel";
import { isDarkTheme, type Theme } from "./theme";

/** How long a person who has left stays on screen, shrinking away, before the chair is cleared. */
const LEAVE_MS = 450;
/** Frames are measured over this window; a slow window steps the picture down one quality tier. */
const WINDOW_SECONDS = 2;
const WARM_UP_SECONDS = 1.5;

type Leaving = { seat: SeatInfo; target: SeatWorld; until: number };

/** Measures the real frame time and asks for a cheaper tier when it is slow. Skips the first moments, which include shader compiling. */
function FrameMonitor({ onSlow }: { onSlow: () => void }) {
  const sample = useRef({ time: 0, frames: 0, sum: 0 });
  useFrame((_, delta) => {
    if (document.hidden || delta > 0.5) return;
    const s = sample.current;
    s.time += delta;
    if (s.time < WARM_UP_SECONDS) return;
    s.frames += 1;
    s.sum += delta * 1000;
    if (s.time - WARM_UP_SECONDS >= WINDOW_SECONDS) {
      const average = s.sum / Math.max(1, s.frames);
      s.time = WARM_UP_SECONDS;
      s.frames = 0;
      s.sum = 0;
      if (average > 22) onSlow();
    }
  });
  return null;
}

export function Scene({ seats, focusId, selfIndex, theme, tier, reduced, labelEls, onSlow }: {
  seats: SeatInfo[];
  focusId: string | null;
  selfIndex: number | null;
  theme: Theme;
  tier: Tier;
  reduced: boolean;
  labelEls: MutableRefObject<Map<string, HTMLElement>>;
  onSlow: () => void;
}) {
  const assets = useMemo(() => createAssets(tier), [tier]);
  useEffect(() => () => assets.dispose(), [assets]);

  const count = seats.length;
  const world = useMemo(() => seatWorldPositions(count, selfIndex), [count, selfIndex]);
  const shadows = tier === "high";
  // The lights are not taken from the theme colours (a dark theme would leave the characters black); the night mode is simply a little dimmer.
  const dark = isDarkTheme(theme);

  // People who have just left keep their chair for a moment so they shrink away instead of vanishing.
  const known = useRef(new Map<string, { seat: SeatInfo; target: SeatWorld }>());
  const sweep = useRef<number | undefined>(undefined);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  useEffect(() => () => window.clearTimeout(sweep.current), []);
  useEffect(() => {
    const present = new Set(seats.map((seat) => seat.userId));
    const now = performance.now();
    const gone: Leaving[] = [];
    known.current.forEach((entry, userId) => {
      if (!present.has(userId)) gone.push({ ...entry, until: now + LEAVE_MS });
    });
    known.current = new Map(seats.map((seat, index) => [seat.userId, { seat, target: world[index] }]));
    setLeaving((current) => {
      const kept = current.filter((entry) => !present.has(entry.seat.userId) && entry.until > now);
      const next = [...kept, ...gone];
      return next.length === current.length && next.every((entry, index) => entry === current[index]) ? current : next;
    });
    if (gone.length > 0) {
      window.clearTimeout(sweep.current);
      sweep.current = window.setTimeout(() => setLeaving((current) => current.filter((entry) => entry.until > performance.now())), LEAVE_MS + 60);
    }
  }, [seats, world]);

  const focusIndex = focusId ? seats.findIndex((seat) => seat.userId === focusId) : -1;
  const focusWorld = focusIndex >= 0 ? world[focusIndex] : null;
  const reach = ringRadius(count) + 2.5;

  return (
    <>
      <hemisphereLight args={["#f4f7f4", "#7d8a83", dark ? 1.25 : 1.55]} />
      <directionalLight
        position={[4, 9, 6]}
        intensity={dark ? 1.0 : 1.15}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
      />
      <TableModel assets={assets} theme={theme} count={count} shadows={shadows} />
      {seats.map((seat, index) => (
        <Character key={seat.userId} seat={seat} target={world[index]} assets={assets} theme={theme} reduced={reduced} shadows={shadows} labelEls={labelEls} />
      ))}
      {leaving.map((entry) => (
        <Character key={`leaving-${entry.seat.userId}`} seat={entry.seat} target={entry.target} assets={assets} theme={theme} reduced={reduced} shadows={shadows} leaving labelEls={labelEls} />
      ))}
      <CameraRig count={count} focus={focusWorld} reduced={reduced} />
      <FrameMonitor onSlow={onSlow} />
    </>
  );
}
