"use client";

import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Hand, MicOff } from "lucide-react";
import type { SeatInfo } from "../types";
import { seatName, shortTime } from "../seatLabel";
import { initialTier, labelDensity, nextTier, overviewPose, type Tier } from "./seat3d";
import { Scene } from "./Scene";
import { FALLBACK_THEME, readTheme, sameTheme, type Theme } from "./theme";

type Props = {
  seats: SeatInfo[];
  focusId: string | null;
  selfIndex: number | null;
  center: ReactNode;
  /** What to show when this device cannot draw 3D: the existing round table. */
  fallback: ReactNode;
};

/** A thrown error inside the canvas (a lost GPU, a driver bug) must never take the meeting room down with it. */
class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The 3D table failed; showing the round table instead.", error, info.componentStack);
    this.props.onError();
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function canDrawWebGl() {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * The "3D table" layout: the same seats, focus and centre content as the other layouts, drawn as a
 * 3D table with a cartoon character per person. It reads only props. It opens no socket, makes no
 * request and never touches audio or video, so switching to it cannot affect the meeting.
 */
export default function Table3D({ seats, focusId, selfIndex, center, fallback }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const labelEls = useRef(new Map<string, HTMLElement>());
  const [webgl, setWebgl] = useState<"checking" | "yes" | "no">("checking");
  const [broken, setBroken] = useState(false);
  const [tier, setTier] = useState<Tier>(() => initialTier(seats.length));
  const [theme, setTheme] = useState<Theme>(FALLBACK_THEME);
  const [reduced, setReduced] = useState(false);

  useEffect(() => { setWebgl(canDrawWebGl() ? "yes" : "no"); }, []);

  // Follow the room's reading mode (sage, paper, night), which is set on .rt-root as data-mode.
  useEffect(() => {
    const root = frame.current?.closest(".rt-root") ?? document.documentElement;
    const apply = () => setTheme((current) => { const next = readTheme(root); return sameTheme(current, next) ? current : next; });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-mode"] });
    return () => observer.disconnect();
  }, [webgl]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const slower = useCallback(() => setTier((current) => nextTier(current, 100)), []);

  if (webgl === "no" || broken) {
    return (
      <div className="rt3d-fallback">
        <p className="rt3d-notice" role="status">The 3D table is not available on this device, so the round table is shown instead.</p>
        {fallback}
      </div>
    );
  }

  const start = overviewPose(seats.length);

  return (
    <div className="rt3d-wrap">
      {/* The discussion's status (countdown, invitation). It sits above the picture, not over it, so it never covers a name. It fades while someone is speaking, like the centre of the 2D round table. */}
      <div className={`rt3d-banner${focusId ? " is-hidden" : ""}`}>{center}</div>
    <div className="rt3d-frame" ref={frame} data-tier={tier} data-density={labelDensity(seats.length)}>
      {webgl === "yes" && (
        <div className="rt3d-canvas" aria-hidden="true">
          <Boundary onError={() => setBroken(true)}>
            <Canvas
              dpr={[1, 1.75]}
              shadows={tier === "high" ? "percentage" : false}
              camera={{ fov: 40, near: 0.1, far: 120, position: start.position }}
              gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                // A lost GPU context cannot be drawn into: fall back to the round table.
                gl.domElement.addEventListener("webglcontextlost", (event) => { event.preventDefault(); setBroken(true); });
              }}
            >
              <Scene seats={seats} focusId={focusId} selfIndex={selfIndex} theme={theme} tier={tier} reduced={reduced} labelEls={labelEls} onSlow={slower} />
            </Canvas>
          </Boundary>
        </div>
      )}

      <div className="rt3d-labels" aria-hidden="true">
        {seats.map((seat) => (
          <div
            key={seat.userId}
            ref={(element) => { if (element) labelEls.current.set(seat.userId, element); else labelEls.current.delete(seat.userId); }}
            className={`rt3d-label${seat.speaking ? " is-speaking" : ""}${seat.connected ? "" : " is-away"}${seat.invited ? " is-invited" : ""}${seat.speaking || seat.invited || seat.hand || seat.isSelf ? " is-notable" : ""}`}
            data-user={seat.userId}
          >
            <strong>{seatName(seat)}</strong>
            <span className="rt3d-meta">
              <i className={`rt3d-dot q-${seat.quality}`} title={`Connection: ${seat.quality}`} />
              <span className="rt3d-time">{shortTime(seat.speakingMs)}</span>
              {!seat.micOn && <MicOff size={12} aria-label="Microphone off" />}
              {seat.hand && <Hand size={12} aria-label="Hand raised" />}
            </span>
          </div>
        ))}
      </div>

      {/* With reduced motion the camera cuts instead of gliding; this brief veil softens the cut. */}
      {reduced && <div key={focusId ?? "overview"} className="rt3d-cut" aria-hidden="true" />}

      <ul className="rt3d-sr" role="group" aria-label="Round table (3D)">
        {seats.map((seat) => (
          <li key={seat.userId}>
            {seatName(seat)}
            {seat.speaking ? ", speaking" : ""}
            {seat.hand ? ", hand raised" : ""}
            {seat.micOn ? "" : ", microphone off"}
            {seat.connected ? "" : ", away"}
            {seat.invited ? ", invited to speak" : ""}
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}
