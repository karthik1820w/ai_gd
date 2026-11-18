import type { SeatInfo } from "./types";

/** Talk time as the seat labels show it: "42s", then "1:05". Shared by the 2D seats and the 3D table. */
export function shortTime(ms: number) {
  const total = Math.floor(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The name line of a seat: "(you)" for the viewer and "· host" for the host, unless the name already says host. */
export function seatName(seat: Pick<SeatInfo, "name" | "isSelf" | "isHost">) {
  return `${seat.name}${seat.isSelf ? " (you)" : ""}${seat.isHost && !/^host$/i.test(seat.name) ? " · host" : ""}`;
}
