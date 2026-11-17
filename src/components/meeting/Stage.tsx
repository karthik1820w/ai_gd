"use client";

import type { CSSProperties, ReactNode } from "react";
import { Hand, MicOff } from "lucide-react";
import { ringPositions, seatSizePercent, type LayoutMode } from "@/lib/stageLayout";
import type { SeatInfo } from "./types";
import { VideoSurface } from "./media";

function shortTime(ms: number) {
  const total = Math.floor(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Seat({ seat, className, style }: { seat: SeatInfo; className: string; style?: CSSProperties }) {
  const showVideo = seat.camOn && Boolean(seat.remoteVideo || seat.localStream);
  const classes = ["rt-seat", className, seat.speaking ? "speaking" : "", seat.invited ? "invited" : "", seat.connected ? "" : "away"].filter(Boolean).join(" ");
  return (
    <div className={classes} style={style} data-user={seat.userId}>
      <div className="rt-seat-ring" style={{ "--fill": seat.fill } as CSSProperties}>
        <div className="rt-seat-face">
          {showVideo
            ? <VideoSurface track={seat.remoteVideo} stream={seat.localStream} mirror={seat.isSelf} />
            : <span className="rt-avatar" aria-hidden="true">{seat.name.slice(0, 1).toUpperCase()}</span>}
          {!seat.micOn && <span className="rt-badge rt-badge-mic" title="Microphone off"><MicOff size={12} /></span>}
          {seat.hand && <span className="rt-badge rt-badge-hand" title="Hand raised"><Hand size={12} /></span>}
        </div>
        <span className={`rt-dot q-${seat.quality}`} title={`Connection: ${seat.quality}`} />
      </div>
      <div className="rt-seat-label">
        <strong>{seat.name}{seat.isSelf ? " (you)" : ""}{seat.isHost && !/^host$/i.test(seat.name) ? " · host" : ""}</strong>
        <span>{shortTime(seat.speakingMs)}</span>
      </div>
    </div>
  );
}

/**
 * The meeting stage in three layouts. Every layout renders the same flat list of seats
 * with stable keys, so a person's video keeps playing while they move, for example into
 * the centre when they start to speak.
 */
export function Stage({ seats, layout, focusId, selfIndex, center }: { seats: SeatInfo[]; layout: LayoutMode; focusId: string | null; selfIndex: number | null; center: ReactNode }) {
  if (layout === "round") {
    const size = seatSizePercent(seats.length);
    const points = ringPositions(seats.length, selfIndex);
    return (
      <div className="rt-table" role="group" aria-label="Round table">
        <div className="rt-table-ring" aria-hidden="true" />
        <div className={`rt-center${focusId ? " is-hidden" : ""}`}>{center}</div>
        {seats.map((seat, index) => {
          const focused = focusId === seat.userId;
          const style: CSSProperties = focused
            ? { left: "50%", top: "50%", width: "34%", zIndex: 3 }
            : { left: `${points[index].x}%`, top: `${points[index].y}%`, width: `${size}%` };
          return <Seat key={seat.userId} seat={seat} className={`rt-round${focused ? " is-focus" : ""}`} style={style} />;
        })}
      </div>
    );
  }
  const main = seats.find((seat) => seat.userId === focusId) ?? seats.find((seat) => !seat.isSelf) ?? seats[0];
  return (
    <div className={layout === "speaker" ? "rt-speaker" : "rt-gallery"}>
      {layout === "gallery" && <div className="rt-banner">{center}</div>}
      {seats.map((seat) => <Seat key={seat.userId} seat={seat} className={`rt-card${seat.userId === main?.userId ? " is-main" : " is-thumb"}${focusId === seat.userId ? " is-focus" : ""}`} />)}
      {layout === "speaker" && <div className="rt-banner">{center}</div>}
    </div>
  );
}
