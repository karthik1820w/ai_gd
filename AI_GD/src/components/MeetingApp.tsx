"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { acquireMedia } from "@/lib/acquireMedia";
import { Room } from "@/components/meeting/Room";
import { Results } from "@/components/meeting/Results";
import type { DiscussionInfo, MediaHealth, TopicBrief } from "@/components/meeting/types";

/**
 * Entry point for /meeting/[id]: a lobby (consent, devices, preview), then the room.
 * A discussion that has already finished shows its results instead.
 */
export function MeetingApp({ discussion, user, code }: { discussion: DiscussionInfo; user: { id: string; name: string; speechLang: string }; code?: string }) {
  const [stage, setStage] = useState<"lobby" | "room">("lobby");
  const [displayName, setDisplayName] = useState(discussion.displayName || user.name);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [consentT, setConsentT] = useState(false);
  const [consentR, setConsentR] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [joining, setJoining] = useState(false);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [aiOn, setAiOn] = useState(Boolean(discussion.aiEnabled));
  const [brief] = useState<TopicBrief | null>(discussion.brief ?? null);
  const [mediaHealth, setMediaHealth] = useState<MediaHealth>({ ready: false, error: "Checking media server status…" });
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micRef = useRef(true);
  const camRef = useRef(true);
  const stageRef = useRef(stage);
  const finished = discussion.status === "COMPLETED";

  useEffect(() => { stageRef.current = stage; }, [stage]);

  // Open the chosen devices. Runs again when the person picks a different microphone or camera.
  useEffect(() => {
    if (finished || stage !== "lobby") return;
    let closed = false;
    let frame = 0;
    let context: AudioContext | null = null;
    void (async () => {
      const result = await acquireMedia(audioId, videoId);
      if (closed) { result.stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = result.stream;
      result.stream.getAudioTracks().forEach((track) => { track.enabled = micRef.current; });
      result.stream.getVideoTracks().forEach((track) => { track.enabled = camRef.current; });
      if (previewRef.current) previewRef.current.srcObject = result.stream;
      setNote(result.note);
      if (!result.hasAudio) { micRef.current = false; setMicOn(false); }
      if (!result.hasVideo) { camRef.current = false; setCamOn(false); }
      setDevices(await navigator.mediaDevices.enumerateDevices().catch(() => []));
      const audio = result.stream.getAudioTracks()[0];
      if (audio) {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        context.createMediaStreamSource(new MediaStream([audio])).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (closed) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
          setLevel(Math.min(100, Math.sqrt(sum / data.length) * 400));
          frame = requestAnimationFrame(tick);
        };
        tick();
      }
    })();
    return () => { closed = true; cancelAnimationFrame(frame); void context?.close().catch(() => undefined); };
  }, [audioId, videoId, finished, stage]);

  // Release the camera if the person leaves the page without joining.
  useEffect(() => () => {
    if (stageRef.current === "lobby") streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (finished) return;
    let active = true;
    void fetch("/api/config")
      .then((response) => response.json())
      .then((data: { ai?: boolean }) => { if (active) setAiOn(Boolean(data.ai)); })
      .catch(() => { if (active) setAiOn(false); });
    return () => { active = false; };
  }, [finished]);

  // Check the media server once, and keep checking only while it is not ready.
  useEffect(() => {
    if (finished || stage !== "lobby") return;
    let active = true;
    let timer = 0;
    const check = () => {
      void fetch("/api/media-status")
        .then(async (response) => {
          const result = await response.json() as { ready?: boolean; error?: string | null };
          const ready = response.ok && Boolean(result.ready);
          if (!active) return;
          setMediaHealth({ ready, error: result.error ?? null });
          if (!ready) timer = window.setTimeout(check, 5000);
        })
        .catch(() => {
          if (!active) return;
          setMediaHealth({ ready: false, error: "Could not check the media server. Check the server logs and try again." });
          timer = window.setTimeout(check, 5000);
        });
    };
    check();
    return () => { active = false; window.clearTimeout(timer); };
  }, [finished, stage]);

  function togglePreview(kind: "audio" | "video", on: boolean) {
    streamRef.current?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = on; });
    if (kind === "audio") { micRef.current = on; setMicOn(on); } else { camRef.current = on; setCamOn(on); }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (joining) return;
    setError("");
    if (discussion.transcriptionEnabled && !consentT) return setError("Consent to transcription before joining.");
    if (discussion.recordingEnabled && !consentR) return setError("Consent to audio recording before joining.");
    setJoining(true);
    const speechAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    try {
      const response = await fetch(`/api/discussions/${discussion.id}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, transcriptionConsent: consentT || !discussion.transcriptionEnabled, recordingConsent: consentR || !discussion.recordingEnabled, speechAvailable, code }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not enter."); setJoining(false); return; }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setJoining(false);
      return;
    }
    const stream = streamRef.current ?? new MediaStream();
    stream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
    stream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
    streamRef.current = stream;
    setStage("room");
  }

  if (finished) {
    return (
      <div className="rt-root" data-mode="sage">
        <header className="rt-top"><span className="rt-brand">Quorum</span></header>
        <main style={{ padding: "18px 22px 0" }}>
          <div className="rt-titlebar" style={{ justifyContent: "flex-start" }}>
            <h1>{discussion.title}</h1>
            <span className="rt-status done">Finished</span>
          </div>
          <p className="muted">Topic: {discussion.topic}</p>
        </main>
        <Results discussionId={discussion.id} refreshKey={0} />
      </div>
    );
  }

  if (stage === "lobby") {
    return (
      <main className="content" style={{ maxWidth: 880, margin: "0 auto", paddingTop: 32 }}>
        <p className="pill">{discussion.mode === "AI_MODERATED" ? "AI-moderated" : "Free-flow"}</p>
        <h1 className="serif" style={{ fontSize: 40, marginBottom: 4 }}>{discussion.title}</h1>
        <p className="muted">Topic: {discussion.topic}</p>
        {!mediaHealth.ready && <section className="media-down" role="alert">
          <strong>Video and audio are unavailable</strong>
          <p>{mediaHealth.error || "Check the media server configuration before joining."}</p>
        </section>}
        {aiOn && <section className="card card-pad" style={{ marginBottom: 16 }}>
          <h2 className="serif">Topic primer</h2>
          {brief?.status === "pending" && <p className="muted">Preparing the briefing…</p>}
          {brief?.status === "failed" && <p className="muted">The AI briefing is unavailable.</p>}
          {brief?.status === "ready" && <><p>{brief.summary}</p>{brief.key_concepts?.map((concept) => <p key={concept.term}><strong>{concept.term}</strong>: {concept.definition}</p>)}</>}
        </section>}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 16 }}>
          <div className="card" style={{ overflow: "hidden", minHeight: 280, background: "#121a17", position: "relative" }}>
            <video ref={previewRef} autoPlay muted playsInline style={{ width: "100%", height: 320, objectFit: "cover", transform: "scaleX(-1)" }} />
            {!camOn && <div className="avatar-fallback" style={{ color: "white" }}>{displayName.slice(0, 1)}</div>}
          </div>
          <form onSubmit={join} className="card card-pad list">
            <label className="field">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} /></label>
            <label className="field">Microphone
              <select value={audioId} onChange={(event) => setAudioId(event.target.value)}>
                <option value="">Default</option>
                {devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
              </select>
            </label>
            <label className="field">Camera
              <select value={videoId} onChange={(event) => setVideoId(event.target.value)}>
                <option value="">Default</option>
                {devices.filter((device) => device.kind === "videoinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}
              </select>
            </label>
            <div className="meter" aria-label="Microphone level"><span style={{ width: `${level}%` }} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => togglePreview("audio", !micOn)}>{micOn ? "Mic on" : "Mic off"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => togglePreview("video", !camOn)}>{camOn ? "Camera on" : "Camera off"}</button>
            </div>
            {note && <p className="muted" role="note">{note}</p>}
            {discussion.transcriptionEnabled && <label><input type="checkbox" checked={consentT} onChange={(event) => setConsentT(event.target.checked)} /> I agree to live transcription of my microphone and to storing the text for evaluation.</label>}
            {discussion.recordingEnabled && <label><input type="checkbox" checked={consentR} onChange={(event) => setConsentR(event.target.checked)} /> I agree to an audio recording of my microphone being stored for the host.</label>}
            {aiOn && <p className="muted" role="note">AI analysis is enabled. Your transcript may be sent to Google Gemini for analysis and evaluation.</p>}
            <p className="muted">Speech is recognised in this browser and attributed to you. Only you and the host can see your transcript and your scores.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={joining}>{joining ? "Joining…" : "Join meeting"}</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <Room
      discussion={discussion}
      user={user}
      code={code}
      displayName={displayName}
      initialStream={streamRef.current}
      initialMic={micOn}
      initialCam={camOn}
      record={discussion.recordingEnabled && consentR}
      mediaHealth={mediaHealth}
    />
  );
}
