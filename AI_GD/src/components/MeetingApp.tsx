"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Room as LiveKitRoom, RoomEvent, Track } from "livekit-client";
import { io, Socket } from "socket.io-client";
import { Captions, Hand, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Settings, Users, Video, VideoOff } from "lucide-react";
import { formatClock } from "@/lib/format";
import { createSpeakingDetector } from "@/lib/speakingDetector";

type DiscussionInfo = {
  id: string;
  meetingId: string;
  title: string;
  topic: string;
  description: string;
  rules: string;
  mode: string;
  status: string;
  durationMin: number;
  speakingTimeSec: number;
  moderatorEnabled: boolean;
  transcriptionEnabled: boolean;
  recordingEnabled: boolean;
  aiEnabled?: boolean;
  brief?: TopicBrief | null;
  isHost: boolean;
  displayName: string;
};

type Segment = { id: string; userId: string; name: string; text: string; startedAt: string; relevance: string; relevanceReason: string; analysisSource: string; accuracy?: string; correction?: string; concepts?: string[]; gist?: string };
type Peer = { socketId: string; userId: string; name: string; stream: MediaStream; audio: boolean; video: boolean; hand: boolean; speaking: boolean };
type RosterEntry = { userId: string; name: string; isHost: boolean; connected: boolean; audio: boolean; video: boolean; hand: boolean; speaking: boolean; micLocked: boolean; speakingMs: number; contributions: number; relevant: number; irrelevant: number; missed: number; technical: number; q?: "good" | "fair" | "poor" | string };
type TopicBrief = { status: "pending" | "ready" | "failed" | "off"; source?: string; model?: string; summary?: string; key_concepts?: Array<{ term: string; definition: string }>; key_facts?: string[]; arguments_for?: string[]; arguments_against?: string[]; rubric?: string[] };
type LiveScore = { participantId: string; userId: string; name: string; knowledge: number; participation: number; thinking: number; overall: number; source: string };
type MediaHealth = { ready: boolean; error: string | null };

export function MeetingApp({ discussion, user, code }: { discussion: DiscussionInfo; user: { id: string; name: string; speechLang: string }; code?: string }) {
  const [stage, setStage] = useState<"lobby" | "room">("lobby");
  const [displayName, setDisplayName] = useState(discussion.displayName || user.name);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [consentT, setConsentT] = useState(false);
  const [consentR, setConsentR] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [aiOn, setAiOn] = useState(Boolean(discussion.aiEnabled));
  const [brief] = useState<TopicBrief | null>(discussion.brief ?? null);
  const [mediaHealth, setMediaHealth] = useState<MediaHealth>({ ready: false, error: "Checking media server status…" });
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let meter = 0;
    let closed = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (closed) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
        const audio = stream.getAudioTracks()[0];
        if (audio) {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          context.createMediaStreamSource(new MediaStream([audio])).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            if (closed) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
            setLevel(Math.min(100, Math.sqrt(sum / data.length) * 400));
            meter = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch {
        setError("Camera or microphone permission was denied. You can still join to listen.");
        setMicOn(false);
        setCamOn(false);
      }
    })();
    return () => { closed = true; cancelAnimationFrame(meter); };
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/config")
      .then((response) => response.json())
      .then((data: { ai?: boolean }) => { if (active) setAiOn(Boolean(data.ai)); })
      .catch(() => { if (active) setAiOn(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const check = () => {
      void fetch("/api/media-status")
        .then(async (response) => {
          const result = await response.json() as { ready?: boolean; error?: string | null };
          if (active) setMediaHealth({ ready: response.ok && Boolean(result.ready), error: result.error ?? null });
        })
        .catch(() => {
          if (active) setMediaHealth({ ready: false, error: "Could not check the media server. Check the server logs and try again." });
        });
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function togglePreview(kind: "audio" | "video", on: boolean) {
    streamRef.current?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = on; });
    if (kind === "audio") setMicOn(on);
    else setCamOn(on);
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (discussion.transcriptionEnabled && !consentT) return setError("Consent to transcription before joining.");
    if (discussion.recordingEnabled && !consentR) return setError("Consent to audio recording before joining.");
    const speechAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const response = await fetch(`/api/discussions/${discussion.id}/enter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, transcriptionConsent: consentT || !discussion.transcriptionEnabled, recordingConsent: consentR || !discussion.recordingEnabled, speechAvailable, code }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Could not enter.");
    const stream = streamRef.current ?? new MediaStream();
    stream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
    stream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
    streamRef.current = stream;
    setStage("room");
  }

  if (stage === "lobby") {
    return (
      <main className="content" style={{ maxWidth: 880, margin: "0 auto", paddingTop: 32 }}>
        <p className="pill">{discussion.mode === "AI_MODERATED" ? "AI-moderated" : "Free-flow"}</p>
        <h1 className="serif" style={{ fontSize: 40, marginBottom: 4 }}>{discussion.title}</h1>
        <p className="muted">Topic: {discussion.topic}</p>
        {!mediaHealth.ready && <section className="media-down" role="alert">
          <strong>Video and audio are unavailable</strong>
          <p>{mediaHealth.error || "Start LiveKit or check its configuration before joining."}</p>
        </section>}
        {aiOn && <section className="card card-pad" style={{ marginBottom: 16 }}>
          <h2 className="serif">Topic primer</h2>
          {brief?.status === "pending" && <p className="muted">Preparing the briefing…</p>}
          {brief?.status === "failed" && <p className="muted">Gemini briefing unavailable.</p>}
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
            {discussion.transcriptionEnabled && <label><input type="checkbox" checked={consentT} onChange={(event) => setConsentT(event.target.checked)} /> I agree to live transcription of my microphone and to storing the text for evaluation.</label>}
            {discussion.recordingEnabled && <label><input type="checkbox" checked={consentR} onChange={(event) => setConsentR(event.target.checked)} /> I agree to an audio recording of my microphone being stored for the host.</label>}
            {aiOn && <p className="muted" role="note">AI analysis is enabled. Your transcript may be sent to Google Gemini for analysis and evaluation.</p>}
            <p className="muted">Speech is recognised in this browser and attributed to you, because the audio never mixes with anyone else before transcription.</p>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary">Join meeting</button>
          </form>
        </div>
      </main>
    );
  }

  return <Room discussion={discussion} user={user} code={code} displayName={displayName} initialStream={streamRef.current} initialMic={micOn} initialCam={camOn} record={discussion.recordingEnabled && consentR} mediaHealth={mediaHealth} />;
}

function Room({ discussion, user, code, displayName, initialStream, initialMic, initialCam, record, mediaHealth }: { discussion: DiscussionInfo; user: { id: string; speechLang: string }; code?: string; displayName: string; initialStream: MediaStream | null; initialMic: boolean; initialCam: boolean; record: boolean; mediaHealth: MediaHealth }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [chat, setChat] = useState<Array<{ id: string; userId: string; name: string; text: string }>>([]);
  const [prompts, setPrompts] = useState<Array<{ id: string; message: string; source: string }>>([]);
  const [panel, setPanel] = useState<"transcript" | "people" | "chat" | "monitor" | "ai">("transcript");
  const [micOn, setMicOn] = useState(initialMic);
  const [camOn, setCamOn] = useState(initialCam);
  const [hand, setHand] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState(discussion.status);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [linkState, setLinkState] = useState("Connecting");
  const [captions, setCaptions] = useState(true);
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState("");
  const [ended, setEnded] = useState<string | null>(null);
  const [voice, setVoice] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  const [brief, setBrief] = useState<TopicBrief | null>(discussion.brief ?? null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [shareAnswer, setShareAnswer] = useState(false);
  const [aiAnswers, setAiAnswers] = useState<Array<{ answer: string; sources?: string[]; by?: string; shared?: boolean }>>([]);
  const [aiNotes, setAiNotes] = useState<Array<{ name: string; correction: string; speakerId: string }>>([]);
  const [liveScores, setLiveScores] = useState<LiveScore[]>([]);
  const [myLiveScore, setMyLiveScore] = useState<LiveScore | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lkRef = useRef<LiveKitRoom | null>(null);
  const localRef = useRef<MediaStream>(initialStream ?? new MediaStream());
  const micRef = useRef(initialMic);
  const camRef = useRef(initialCam);
  const handRef = useRef(false);
  const speakingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const joinedMedia = useRef(false);
  const voiceRef = useRef(true);

  useEffect(() => {
    micRef.current = micOn;
    camRef.current = camOn;
    handRef.current = hand;
  }, [micOn, camOn, hand]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    let stopped = false;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const speakingDetector = createSpeakingDetector();

    function sendMedia() {
      const sharing = Boolean(lkRef.current?.localParticipant.isScreenShareEnabled);
      socket.emit("media-state", { audio: micRef.current, video: camRef.current, hand: handRef.current, screen: sharing });
    }
    const buckets = new Map<string, { name: string; tracks: Map<Track.Source, MediaStreamTrack> }>();
    function rebuild(identity: string) {
      const bucket = buckets.get(identity);
      setPeers((current) => {
        if (!bucket || bucket.tracks.size === 0) return current.filter((peer) => peer.userId !== identity);
        const video = bucket.tracks.get(Track.Source.ScreenShare) || bucket.tracks.get(Track.Source.Camera);
        const audio = bucket.tracks.get(Track.Source.Microphone);
        const stream = new MediaStream([video, audio].filter((item): item is MediaStreamTrack => Boolean(item)));
        const found = current.find((peer) => peer.userId === identity);
        const next: Peer = {
          socketId: identity,
          userId: identity,
          name: bucket.name,
          stream,
          audio: Boolean(audio),
          video: Boolean(video),
          hand: found?.hand ?? false,
          speaking: found?.speaking ?? false,
        };
        return [...current.filter((peer) => peer.userId !== identity), next];
      });
    }
    async function connectMedia() {
      const response = await fetch(`/api/discussions/${discussion.id}/token`, { method: "POST" });
      const data: { error?: string; token?: string; url?: string } = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEnded(data.error || `Video could not start (server returned ${response.status}).`);
        return;
      }
      if (!data.token || !data.url) {
        setEnded("Video could not start because the media server returned an invalid response.");
        return;
      }
      const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      lkRef.current = room;
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        setLinkState(state);
        if (state === "disconnected" && !stopped) socket.emit("technical", { kind: "ICE_FAILED", detail: "Media connection closed" });
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        const bucket = buckets.get(participant.identity) ?? { name: participant.name || "Participant", tracks: new Map() };
        bucket.name = participant.name || bucket.name;
        bucket.tracks.set(publication.source, track.mediaStreamTrack);
        buckets.set(participant.identity, bucket);
        rebuild(participant.identity);
      });
      room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
        buckets.get(participant.identity)?.tracks.delete(publication.source);
        rebuild(participant.identity);
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        buckets.delete(participant.identity);
        setPeers((current) => current.filter((peer) => peer.userId !== participant.identity));
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const ids = new Set(speakers.map((speaker) => speaker.identity));
        setPeers((current) => current.map((peer) => ({ ...peer, speaking: ids.has(peer.userId) })));
      });
      await room.connect(data.url, data.token);
      for (const track of localRef.current.getTracks()) {
        track.enabled = track.kind === "audio" ? micRef.current : camRef.current;
        await room.localParticipant.publishTrack(track, { source: track.kind === "audio" ? Track.Source.Microphone : Track.Source.Camera });
      }
      if (!localRef.current.getAudioTracks().length && micRef.current) await room.localParticipant.setMicrophoneEnabled(true);
      if (!localRef.current.getVideoTracks().length && camRef.current) await room.localParticipant.setCameraEnabled(true);
      setLinkState("connected");
    }
    function enterMedia() {
      if (joinedMedia.current) return;
      joinedMedia.current = true;
      socket.emit("join-media", { audio: micRef.current, video: camRef.current, speechAvailable: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) });
      void connectMedia().catch((error) => {
        console.error(error);
        setEnded("The media server did not accept the connection.");
      });
    }

    socket.on("connect", () => { setLinkState("Connected"); socket.emit("watch", { meetingId: discussion.meetingId, code }); });
    socket.on("room-error", (payload: { error: string }) => setEnded(payload.error));
    socket.on("session-state", (payload: { status: string; startedAt: string | null; ai?: boolean; brief?: TopicBrief | null }) => {
      setStatus(payload.status);
      setStartedAt(payload.startedAt);
      setAiOn(Boolean(payload.ai));
      setBrief(payload.brief ?? null);
      if (payload.status === "LIVE" || discussion.isHost) enterMedia();
    });
    socket.on("ai-brief", (payload: TopicBrief) => setBrief(payload));
    socket.on("ai-answer", (payload: { answer: string; sources?: string[]; by?: string; shared?: boolean }) => {
      setAiAnswers((current) => [...current.slice(-4), payload]);
      setAiBusy(false);
    });
    socket.on("ai-error", (payload: { error: string }) => {
      setAiError(payload.error);
      setAiBusy(false);
    });
    socket.on("ai-note", (payload: { name: string; correction: string; speakerId: string }) => {
      setAiNotes((current) => [...current.slice(-3), payload]);
    });
    socket.on("live-scores", (payload: { scores: LiveScore[] }) => setLiveScores(payload.scores));
    socket.on("my-live-score", (payload: { score: LiveScore }) => setMyLiveScore(payload.score));
    socket.on("session-live", (payload: { startedAt: string | null }) => {
      setStatus("LIVE");
      setStartedAt(payload.startedAt);
      enterMedia();
    });
    socket.on("waiting", () => setStatus("SCHEDULED"));
    socket.on("transcript-history", (rows: Segment[]) => setSegments(rows));
    socket.on("segment", (row: Segment) => setSegments((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index === -1) return [...current, row];
      const next = [...current];
      next[index] = row;
      return next;
    }));
    socket.on("chat-history", (rows: Array<{ id: string; userId: string; name: string; text: string }>) => setChat(rows));
    socket.on("chat", (row: { id: string; userId: string; name: string; text: string }) => setChat((current) => [...current, row]));
    socket.on("moderator-history", (rows: Array<{ id: string; message: string; source: string }>) => setPrompts(rows));
    socket.on("moderator", (row: { id: string; message: string; source: string; targetUserId?: string | null }) => {
      setPrompts((current) => [...current.slice(-12), row]);
      if (voiceRef.current && (!row.targetUserId || row.targetUserId === user.id) && !speakingRef.current) window.speechSynthesis?.speak(new SpeechSynthesisUtterance(row.message));
    });
    socket.on("roster", (rows: RosterEntry[]) => setRoster(rows));
    socket.on("speaking", (payload: { userId: string; speaking: boolean }) => setPeers((current) => current.map((peer) => peer.userId === payload.userId ? { ...peer, speaking: payload.speaking } : peer)));
    socket.on("media", (payload: { userId: string; audio: boolean; video: boolean; hand: boolean }) => setPeers((current) => current.map((peer) => peer.userId === payload.userId ? { ...peer, audio: payload.audio, video: payload.video, hand: payload.hand } : peer)));
    socket.on("force-mute", (payload: { locked: boolean }) => {
      setLocked(payload.locked);
      const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (payload.locked) {
        localRef.current.getAudioTracks().forEach((track) => { track.enabled = false; });
        void publication?.mute();
        setMicOn(false);
      }
    });
    socket.on("removed", () => setEnded("The host removed you from the discussion."));
    socket.on("replaced", () => setEnded("This discussion was opened in another tab."));
    socket.on("meeting-ended", (payload: { summary?: { conclusion?: string }; summaryError?: string }) => {
      setEnded(payload.summaryError || payload.summary?.conclusion || "The discussion has ended. Your report is being prepared.");
      setStatus("COMPLETED");
    });

    const audioTrack = localRef.current.getAudioTracks().find((track) => track.enabled);
    if (audioTrack) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(new MediaStream([audioTrack])).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const watch = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
        const event = speakingDetector.update(Math.sqrt(sum / data.length), micRef.current, performance.now());
        if (event !== null) {
          speakingRef.current = event;
          setLocalSpeaking(event);
          socket.emit("speaking", { speaking: event });
        }
        frame = requestAnimationFrame(watch);
      };
      watch();
    }

    if (record) {
      const audioOnly = new MediaStream(localRef.current.getAudioTracks());
      if (audioOnly.getAudioTracks().length && typeof MediaRecorder !== "undefined") {
        const recorder = new MediaRecorder(audioOnly);
        chunks.current = [];
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
        recorder.start(4000);
        recorderRef.current = recorder;
      }
    }
    sendMedia();

    return () => {
      stopped = true;
      socket.emit("leave");
      socket.disconnect();
      void lkRef.current?.disconnect();
      lkRef.current = null;
    };
    // The room connection is created once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussion.id]);

  // Speech is recognised in this browser, so transcription is tied to the local
  // microphone: it runs only while transcription is on, the mic is open and the
  // discussion has not ended. Restarting on `onend` is what keeps it alive,
  // because Chrome stops `continuous` recognition after a pause in speech.
  useEffect(() => {
    if (!discussion.transcriptionEnabled || !micOn || ended) return;
    const socket = socketRef.current;
    if (!socket) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      socket.emit("technical", { kind: "SPEECH_UNSUPPORTED", detail: "This browser has no SpeechRecognition API" });
      return;
    }

    const recognition = new Recognition();
    let stopped = false;
    let active = false;
    let buffer = "";
    let bufferStart = "";
    let flushTimer = 0;
    let restartTimer = 0;

    const flush = () => {
      if (buffer) socket.emit("transcript", { text: buffer, startedAt: bufferStart, endedAt: new Date().toISOString() });
      buffer = "";
      setInterim("");
    };

    const start = () => {
      if (stopped || active) return;
      active = true;
      try {
        recognition.start();
      } catch {
        active = false;
        restartTimer = window.setTimeout(start, 800);
      }
    };

    const release = () => { active = false; };

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = user.speechLang || "en-IN";
    recognition.onresult = (event) => {
      let finalText = "";
      let live = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) finalText += piece;
        else live += piece;
      }
      setInterim(live);
      if (!finalText.trim()) return;
      if (!buffer) bufferStart = new Date().toISOString();
      buffer = `${buffer} ${finalText}`.trim();
      window.clearTimeout(flushTimer);
      // Short turns in a discussion rarely end on punctuation, so flush early.
      flushTimer = window.setTimeout(flush, /[.?!]$/.test(buffer) ? 500 : 1200);
    };
    recognition.onerror = (event) => {
      release();
      const kind = event.error ?? "unknown";
      if (kind === "not-allowed" || kind === "service-not-allowed") {
        socket.emit("technical", { kind: "MIC_DENIED", detail: "Speech recognition permission denied" });
        return;
      }
      if (kind === "no-speech" || kind === "aborted") return;
      socket.emit("technical", { kind: "SPEECH_ERROR", detail: `Speech recognition stopped: ${kind}` });
      restartTimer = window.setTimeout(start, 1000);
    };
    recognition.onend = () => {
      release();
      if (!stopped) restartTimer = window.setTimeout(start, 400);
    };
    start();

    return () => {
      stopped = true;
      window.clearTimeout(flushTimer);
      window.clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch { /* already stopped */ }
    };
  }, [discussion.id, discussion.transcriptionEnabled, micOn, user.speechLang, ended]);

  function signalMedia(audio: boolean, video: boolean, screen: boolean) {
    socketRef.current?.emit("media-state", { audio, video, hand: handRef.current, screen });
  }

  async function replaceAudio(enabled: boolean) {
    if (locked && enabled) return;
    localRef.current.getAudioTracks().forEach((track) => { track.enabled = enabled; });
    const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (publication) {
      if (enabled) await publication.unmute();
      else await publication.mute();
    }
    setMicOn(enabled);
    if (!enabled) {
      speakingRef.current = false;
      setLocalSpeaking(false);
      socketRef.current?.emit("speaking", { speaking: false });
    }
    signalMedia(enabled, camRef.current, Boolean(lkRef.current?.localParticipant.isScreenShareEnabled));
  }

  async function replaceVideo(enabled: boolean) {
    localRef.current.getVideoTracks().forEach((track) => { track.enabled = enabled; });
    const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    if (publication) {
      if (enabled) await publication.unmute();
      else await publication.mute();
    }
    setCamOn(enabled);
    signalMedia(micRef.current, enabled, Boolean(lkRef.current?.localParticipant.isScreenShareEnabled));
  }

  async function shareScreen() {
    const next = !screenOn;
    await lkRef.current?.localParticipant.setScreenShareEnabled(next);
    setScreenOn(next);
    signalMedia(micRef.current, camRef.current, next);
  }

  async function leave(endForAll = false) {
    if (recorderRef.current && chunks.current.length) {
      const recorder = recorderRef.current;
      await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); });
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      const body = new FormData();
      body.set("audio", blob, "microphone.webm");
      await fetch(`/api/discussions/${discussion.id}/recordings`, { method: "POST", body }).catch(() => undefined);
    }
    if (endForAll) socketRef.current?.emit("end-meeting");
    await lkRef.current?.disconnect();
    localRef.current.getTracks().forEach((track) => track.stop());
    if (!endForAll) window.location.href = discussion.isHost ? `/host/sessions/${discussion.id}` : "/participant";
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.key === "m") void replaceAudio(!micRef.current);
      if (event.key === "v") void replaceVideo(!camRef.current);
      if (event.key === "h") { setHand((value) => !value); handRef.current = !handRef.current; socketRef.current?.emit("media-state", { audio: micRef.current, video: camRef.current, hand: handRef.current, screen: Boolean(lkRef.current?.localParticipant.isScreenShareEnabled) }); }
      if (event.key === "c") setPanel("chat");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const elapsed = startedAt ? now - new Date(startedAt).getTime() : 0;
  const remaining = Math.max(0, discussion.durationMin * 60_000 - elapsed);
  const latest = [...segments].reverse().find((segment) => segment.relevance !== "PENDING") ?? segments.at(-1);
  const waiting = status !== "LIVE" && !discussion.isHost;

  return (
    <div className="meet">
      <header className="meet-top">
        <div>
          <strong>{discussion.title}</strong>
          <div className="muted">Topic: {discussion.topic}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="pill">{linkState}</span>
          {discussion.transcriptionEnabled && <span className="pill">Transcript on</span>}
          {record && <span className="pill warn">Audio recording</span>}
          <span>{status === "LIVE" ? `${formatClock(elapsed)} elapsed · ${formatClock(remaining)} left` : status === "SCHEDULED" ? "Waiting for the host" : status}</span>
        </div>
      </header>
      <div className="meet-body">
        <section className="meet-stage">
          {!mediaHealth.ready && <div className="media-down" role="alert"><strong>Video and audio are unavailable</strong><p>{mediaHealth.error || "Check the LiveKit server and reconnect."}</p></div>}
          {waiting && <div className="toast">The host has not started yet. You will enter automatically.</div>}
          {aiNotes.slice(-1).map((note) => <div key={`${note.speakerId}-${note.correction}`} className="toast" role="status">{discussion.isHost ? `Fact-check, ${note.name}: ${note.correction}` : `AI note on your point: ${note.correction}`}</div>)}
          {prompts.slice(-1).map((prompt) => <div key={prompt.id} className="toast" aria-live="polite">{prompt.message} <span className="muted">({prompt.source === "gemini" || prompt.source === "model" ? "Gemini" : "moderator template"})</span></div>)}
          <div className="tile-grid">
            <Tile name={`${displayName} (you)`} stream={localRef.current} muted speaking={localSpeaking} audio={micOn} video={camOn} hand={hand} self />
            {peers.map((peer) => <Tile key={peer.socketId} name={roster.find((person) => person.userId === peer.userId)?.name || peer.name || "Participant"} stream={peer.stream} speaking={peer.speaking || roster.some((person) => person.userId === peer.userId && person.speaking)} audio={peer.audio} video={peer.video} hand={peer.hand} />)}
          </div>
          {captions && <div className="caption" aria-live="polite">{interim || latest ? `${(interim ? displayName : latest?.name) ?? ""}: ${interim || latest?.text || ""}` : "Captions appear when someone speaks."}</div>}
        </section>
        <aside className="side">
          <div className="side-tabs" role="tablist">
            {(["transcript", "people", "chat", ...(discussion.isHost ? ["monitor"] : []), ...(aiOn ? ["ai"] : [])] as const).map((tab) => (
              <button key={tab} role="tab" aria-selected={panel === tab} onClick={() => setPanel(tab as "transcript" | "people" | "chat" | "monitor" | "ai")}>{tab}</button>
            ))}
          </div>
          <div className="side-body">
            {!discussion.isHost && myLiveScore && <section className="toast" aria-live="polite">
              <strong>Your running scores</strong>
              <p>Knowledge {myLiveScore.knowledge} · Participation {myLiveScore.participation} · Thinking {myLiveScore.thinking}</p>
            </section>}
            {panel === "transcript" && segments.length === 0 && (
              <p className="muted">
                {!discussion.transcriptionEnabled
                  ? "Transcription is off for this discussion."
                  : !micOn
                    ? "Turn your microphone on to be transcribed."
                    : "Listening. Your speech appears here as you talk."}
              </p>
            )}
            {panel === "transcript" && segments.map((segment) => (
              <article key={segment.id}>
                <strong>{segment.name}</strong> <span className="muted">{new Date(segment.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                <span className={`pill ${segment.relevance === "IRRELEVANT" ? "bad" : segment.relevance === "PARTIALLY_RELEVANT" ? "warn" : segment.relevance === "PENDING" ? "neutral" : ""}`} style={{ marginLeft: 6 }}>{segment.relevance.replaceAll("_", " ").toLowerCase()}</span>
                <p style={{ margin: "4px 0" }}>{segment.text}</p>
                {segment.accuracy && segment.accuracy !== "unverifiable" && <span className={`pill ${segment.accuracy === "inaccurate" ? "bad" : segment.accuracy === "partly_accurate" ? "warn" : ""}`}>{segment.accuracy.replaceAll("_", " ")}</span>}
                {segment.concepts?.slice(0, 3).map((concept) => <span className="pill" key={concept}>{concept}</span>)}
                {segment.relevanceReason && <p className="muted" style={{ fontSize: 12 }}>{segment.relevanceReason} · {segment.analysisSource === "gemini" ? "Gemini" : segment.analysisSource === "heuristic" || segment.analysisSource === "lexical" ? "heuristic" : "analysing"}</p>}
              </article>
            ))}
            {panel === "people" && roster.map((person) => (
              <div key={person.userId} className="toast">
                <strong>{person.name}</strong> {person.isHost && <span className="pill">Host</span>} {person.hand && <Hand size={14} />}
                <div className="muted">{person.connected ? (person.audio ? "Mic on" : "Mic off") : "Not connected"} · {formatClock(person.speakingMs)} · {person.contributions} lines</div>
                {discussion.isHost && !person.isHost && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button className="btn btn-ghost" onClick={() => socketRef.current?.emit("host-mute", { userId: person.userId, locked: !person.micLocked })}>{person.micLocked ? "Allow mic" : "Mute"}</button>
                    <button className="btn btn-ghost" onClick={() => { if (confirm(`Remove ${person.name}?`)) socketRef.current?.emit("host-remove", { userId: person.userId }); }}>Remove</button>
                  </div>
                )}
              </div>
            ))}
            {panel === "chat" && (
              <>
                {chat.map((message) => <p key={message.id}><strong>{message.name}: </strong>{message.text}</p>)}
                <form onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; socketRef.current?.emit("chat", { text: draft.trim() }); setDraft(""); }}>
                  <label className="field">Message<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
                </form>
              </>
            )}
            {panel === "monitor" && (
              <>
                <p>{roster.filter((person) => person.connected && !person.isHost).length} participants connected. Speaking now: {roster.filter((person) => person.speaking).map((person) => person.name).join(", ") || "nobody"}.</p>
                <p>Yet to speak: {roster.filter((person) => !person.isHost && person.contributions === 0).map((person) => person.name).join(", ") || "everyone has a line."}</p>
                {roster.filter((person) => !person.isHost).map((person) => (
                  <div key={person.userId}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>{person.name}</span><span>{formatClock(person.speakingMs)}</span></div>
                    <div className="meter"><span style={{ width: `${Math.min(100, person.speakingMs / 1000)}%` }} /></div>
                    <p className="muted">{person.relevant} relevant · {person.irrelevant} irrelevant · {person.missed} missed turns{person.technical ? ` · ${person.technical} technical notes` : ""}</p>
                    {liveScores.filter((score) => score.userId === person.userId).map((score) => <p key={score.userId} className="muted">Know {score.knowledge} · Part {score.participation} · Think {score.thinking} · {score.source}</p>)}
                  </div>
                ))}
                {prompts.map((prompt) => <p key={prompt.id} className="muted">{prompt.message}</p>)}
              </>
            )}
            {panel === "ai" && aiOn && (
              <div className="list">
                <h3 className="serif">Topic primer</h3>
                {brief?.status === "pending" && <p className="muted">Preparing the briefing…</p>}
                {brief?.status === "failed" && <p className="muted">Gemini briefing unavailable.</p>}
                {brief?.status === "ready" && (
                  <>
                    <p>{brief.summary}</p>
                    <details>
                      <summary>Key concepts and arguments</summary>
                      {brief.key_concepts?.map((concept) => <p key={concept.term}><strong>{concept.term}</strong>: {concept.definition}</p>)}
                      {brief.key_facts?.map((fact, index) => <p key={`fact-${index}`}>{fact}</p>)}
                      {brief.arguments_for?.map((item, index) => <p key={`for-${index}`}>For: {item}</p>)}
                      {brief.arguments_against?.map((item, index) => <p key={`against-${index}`}>Against: {item}</p>)}
                      {discussion.isHost && brief.rubric?.map((item, index) => <p key={`rubric-${index}`}>Rubric: {item}</p>)}
                    </details>
                  </>
                )}
                <hr />
                <h3 className="serif">Ask Gemini</h3>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  if (!aiQuestion.trim() || aiBusy) return;
                  setAiError("");
                  setAiBusy(true);
                  socketRef.current?.emit("ask-ai", { question: aiQuestion.trim(), share: shareAnswer });
                  setAiQuestion("");
                }}>
                  <label className="field">Question<input value={aiQuestion} maxLength={500} onChange={(event) => setAiQuestion(event.target.value)} /></label>
                  <label><input type="checkbox" checked={shareAnswer} onChange={(event) => setShareAnswer(event.target.checked)} /> Share with everyone</label>
                  <button className="btn btn-primary" disabled={aiBusy || !aiQuestion.trim()}>{aiBusy ? "Thinking…" : "Ask"}</button>
                </form>
                {aiError && <p className="error">{aiError}</p>}
                {aiAnswers.map((answer, index) => <article key={`${index}-${answer.answer}`}><strong>{answer.by || "Gemini"}</strong><p>{answer.answer}</p>{answer.sources?.map((source) => <p className="muted" key={source}>{source}</p>)}</article>)}
              </div>
            )}
          </div>
        </aside>
      </div>
      <footer className="meet-bar">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="mbtn" aria-pressed={!micOn} aria-label="Microphone" disabled={locked} onClick={() => replaceAudio(!micOn)}>{micOn ? <Mic size={18} /> : <MicOff size={18} />}</button>
          <button className="mbtn" aria-pressed={!camOn} aria-label="Camera" onClick={() => replaceVideo(!camOn)}>{camOn ? <Video size={18} /> : <VideoOff size={18} />}</button>
          <button className="mbtn" aria-pressed={screenOn} aria-label="Share screen" onClick={() => shareScreen().catch(() => undefined)}><MonitorUp size={18} /></button>
          <button className="mbtn" aria-pressed={hand} aria-label="Raise hand" onClick={() => { const next = !hand; setHand(next); handRef.current = next; socketRef.current?.emit("media-state", { audio: micOn, video: camOn, hand: next, screen: screenOn }); }}><Hand size={18} /></button>
          <button className="mbtn" aria-label="Chat" onClick={() => setPanel("chat")}><MessageSquare size={18} /></button>
          <button className="mbtn" aria-label="People" onClick={() => setPanel("people")}><Users size={18} /></button>
          <button className="mbtn" aria-pressed={captions} aria-label="Captions" onClick={() => setCaptions((value) => !value)}><Captions size={18} /></button>
          <button className="mbtn" aria-label="Settings" onClick={() => setSettings((value) => !value)}><Settings size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {discussion.isHost && <button className="btn btn-danger" onClick={() => { if (confirm("End the discussion for everyone and generate reports?")) void leave(true); }}>End for everyone</button>}
          <button className="mbtn danger" aria-label="Leave meeting" onClick={() => { if (confirm(discussion.isHost ? "Leave without ending it for the others?" : "Leave the discussion?")) void leave(false); }}><PhoneOff size={18} /></button>
        </div>
      </footer>
      {settings && <div className="toast" style={{ position: "fixed", bottom: 84, left: 16, maxWidth: 320 }}>Keyboard: M microphone, V camera, H hand, C chat. Moderator voice <button className="btn btn-ghost" onClick={() => { setVoice((value) => !value); if (voice) window.speechSynthesis?.cancel(); }}>{voice ? "on" : "off"}</button><p className="muted">{discussion.rules}</p></div>}
      {ended && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "grid", placeItems: "center", padding: 24 }}>
          <div className="card card-pad" style={{ maxWidth: 560 }}>
            <h2 className="serif">Discussion closed</h2>
            <p>{ended}</p>
            <a className="btn btn-primary" href={discussion.isHost ? `/host/sessions/${discussion.id}` : "/participant"}>Open reports</a>
          </div>
        </div>
      )}
      {remaining < 120_000 && status === "LIVE" && <span className="sr-only">Less than two minutes remain.</span>}
    </div>
  );
}

function Tile({ name, stream, speaking, audio, video, hand, muted, self }: { name: string; stream: MediaStream; speaking: boolean; audio: boolean; video: boolean; hand: boolean; muted?: boolean; self?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) { ref.current.srcObject = stream; void ref.current.play().catch(() => undefined); } }, [stream]);
  return (
    <div className={`tile${speaking ? " speaking" : ""}`}>
      <video ref={ref} autoPlay playsInline muted={muted} style={self ? { transform: "scaleX(-1)" } : undefined} />
      {!video && <div className="avatar-fallback">{name.slice(0, 1)}</div>}
      <div className="name">{!audio && <MicOff size={14} />} {hand && <Hand size={14} />} {name}</div>
    </div>
  );
}
