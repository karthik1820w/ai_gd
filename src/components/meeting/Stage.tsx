"use client";

import type { CSSProperties, ReactNode } from "react";
import dynamic from "next/dynamic";
import { Hand, MicOff } from "lucide-react";
import { ringPositions, seatSizePercent, type LayoutMode } from "@/lib/stageLayout";
import type { SeatInfo } from "./types";
import { VideoSurface } from "./media";
import { seatName, shortTime } from "./seatLabel";

// The 3D table pulls in three.js, so it is loaded only when someone picks that layout. It cannot be drawn on the server.
const Table3D = dynamic(() => import("./table3d/Table3D"), {
  ssr: false,
  loading: () => <div className="rt3d-frame rt3d-loading" aria-busy="true" />,
});

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
        <strong>{seatName(seat)}</strong>
        <span>{shortTime(seat.speakingMs)}</span>
      </div>
    </div>
  );
}

type StageProps = { seats: SeatInfo[]; focusId: string | null; selfIndex: number | null; center: ReactNode };

function RoundTable({ seats, focusId, selfIndex, center }: StageProps) {
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

/**
 * The meeting stage in four layouts. Every layout is fed the same flat list of seats, the same
 * focused speaker and the same centre content, so choosing a layout changes only how the room is drawn.
 * In the 2D layouts a person's video keeps playing while they move, for example into the centre when
 * they start to speak. The 3D table draws characters instead of video, and never touches audio or video.
 */
export function Stage({ seats, layout, focusId, selfIndex, center }: StageProps & { layout: LayoutMode }) {
  if (layout === "round") return <RoundTable seats={seats} focusId={focusId} selfIndex={selfIndex} center={center} />;
  if (layout === "table3d") {
    return <Table3D seats={seats} focusId={focusId} selfIndex={selfIndex} center={center} fallback={<RoundTable seats={seats} focusId={focusId} selfIndex={selfIndex} center={center} />} />;
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
