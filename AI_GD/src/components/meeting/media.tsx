"use client";

import { useEffect, useRef } from "react";
import type { RemoteAudioTrack, RemoteVideoTrack } from "livekit-client";

/**
 * Shows a video. A remote LiveKit track must be attached with `track.attach()`: that is how
 * LiveKit learns the video is on screen. Attaching the raw MediaStreamTrack by hand leaves
 * LiveKit believing nobody is watching, and with adaptive streaming it then pauses the video.
 */
export function VideoSurface({ track, stream, mirror }: { track?: RemoteVideoTrack | null; stream?: MediaStream | null; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (track) {
      track.attach(element);
      void element.play().catch(() => undefined);
      return () => { track.detach(element); };
    }
    if (stream) {
      if (element.srcObject !== stream) element.srcObject = stream;
      void element.play().catch(() => undefined);
      return () => { element.srcObject = null; };
    }
  }, [track, stream]);
  // Always muted: sound comes from <RemoteAudio>, so a person is never heard twice.
  return <video ref={ref} autoPlay playsInline muted className="rt-video" style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}

/** Plays one remote person's microphone. Renders nothing visible. */
export function RemoteAudio({ track }: { track: RemoteAudioTrack }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = track.attach();
    element.style.display = "none";
    host.current?.appendChild(element);
    void element.play?.().catch(() => undefined);
    return () => { track.detach(element); element.remove(); };
  }, [track]);
  return <span ref={host} aria-hidden="true" />;
}
