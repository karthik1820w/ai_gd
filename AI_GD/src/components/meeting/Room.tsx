"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Room as LiveKitRoom, RoomEvent, Track, type RemoteAudioTrack, type RemoteVideoTrack } from "livekit-client";
import { io, type Socket } from "socket.io-client";
import { Hand, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { createSpeakingDetector } from "@/lib/speakingDetector";
import { FocusTracker, LAYOUTS, isLayoutMode, type LayoutMode } from "@/lib/stageLayout";
import { FIRST_INVITE_AFTER_MS, secondsUntilInvite } from "@/lib/floor";
import { buildSeats, centerMessage, connectionText, qualityLabel, spacedCode, type LiveOverride } from "@/lib/meetingView";
import { formatClock } from "@/lib/format";
import { Stage } from "./Stage";
import { RemoteAudio } from "./media";
import { Results } from "./Results";
import type { DiscussionInfo, Floor, Invite, LiveScore, MediaHealth, Peer, RosterEntry, Segment, TopicBrief } from "./types";

type Toast = { id: string; text: string };
type FloorState = { lastSpeechAt: number; inviteAfterMs: number; moderated: boolean; skew: number };
type AiAnswer = { question?: string; answer: string; sources?: string[]; by?: string; shared?: boolean };
type ReadingMode = "sage" | "paper" | "night";

const MODES: Array<{ id: ReadingMode; label: string }> = [
  { id: "sage", label: "Sage" },
  { id: "paper", label: "Paper" },
  { id: "night", label: "Night" },
];

function Bar({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rt-score">
      <span>{label}</span>
      <div className="rt-meter"><span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div>
      <b>{value == null ? "–" : Math.round(value)}</b>
    </div>
  );
}

function pointTags(segment: Segment) {
  const tags: Array<{ text: string; tone: string }> = [];
  if (segment.accuracy === "inaccurate") tags.push({ text: "Check this", tone: "bad" });
  else if (segment.accuracy === "partly_accurate") tags.push({ text: "Partly accurate", tone: "warn" });
  else if (segment.accuracy === "accurate") tags.push({ text: "Accurate", tone: "good" });
  if (segment.relevance === "IRRELEVANT") tags.push({ text: "Off topic", tone: "warn" });
  for (const concept of segment.concepts?.slice(0, 2) ?? []) tags.push({ text: concept, tone: "" });
  return tags;
}

export function Room({ discussion, user, code, displayName, initialStream, initialMic, initialCam, record, mediaHealth }: {
  discussion: DiscussionInfo;
  user: { id: string; name: string; speechLang: string };
  code?: string;
  displayName: string;
  initialStream: MediaStream | null;
  initialMic: boolean;
  initialCam: boolean;
  record: boolean;
  mediaHealth: MediaHealth;
}) {
  const isHost = discussion.isHost;

  // What the server tells us.
  const [status, setStatus] = useState(discussion.status);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [overrides, setOverrides] = useState<Record<string, LiveOverride>>({});
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [qualities, setQualities] = useState<Record<string, string>>({});
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [segments, setSegments] = useState<Segment[]>([]);
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [lastSpeechLocal, setLastSpeechLocal] = useState(0);
  const [liveScores, setLiveScores] = useState<LiveScore[]>([]);
  const [myScore, setMyScore] = useState<LiveScore | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [brief, setBrief] = useState<TopicBrief | null>(discussion.brief ?? null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState(0);

  // This person's controls.
  const [micOn, setMicOn] = useState(initialMic);
  const [camOn, setCamOn] = useState(initialCam);
  const [hand, setHand] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [locked, setLocked] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [typed, setTyped] = useState("");
  const [voice, setVoice] = useState(true);

  // Look and feel.
  const [layout, setLayout] = useState<LayoutMode>("round");
  const [mode, setMode] = useState<ReadingMode>("sage");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  // Ask the AI.
  const [aiQuestion, setAiQuestion] = useState("");
  const [shareAnswer, setShareAnswer] = useState(false);
  const [aiAnswers, setAiAnswers] = useState<AiAnswer[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const lkRef = useRef<LiveKitRoom | null>(null);
  const localRef = useRef<MediaStream>(initialStream ?? new MediaStream());
  const micRef = useRef(initialMic);
  const camRef = useRef(initialCam);
  const handRef = useRef(false);
  const screenRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceRef = useRef(true);
  const rosterRef = useRef<RosterEntry[]>([]);
  const joinedMedia = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const askedRef = useRef<string[]>([]);
  const trackerRef = useRef(new FocusTracker());
  const speakingIdsRef = useRef<Set<string>>(new Set());
  const teardownRef = useRef<(background: boolean) => void>(() => undefined);
  const uploadRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { rosterRef.current = roster; }, [roster]);

  // Remember the person's layout and reading mode.
  useEffect(() => {
    try {
      const savedLayout = window.localStorage.getItem("quorum-layout");
      if (isLayoutMode(savedLayout)) setLayout(savedLayout);
      const savedMode = window.localStorage.getItem("quorum-mode");
      if (savedMode === "sage" || savedMode === "paper" || savedMode === "night") setMode(savedMode);
    } catch { /* storage can be blocked; defaults are fine */ }
  }, []);
  function chooseLayout(next: LayoutMode) {
    setLayout(next);
    try { window.localStorage.setItem("quorum-layout", next); } catch { /* ignore */ }
  }
  function chooseMode(next: ReadingMode) {
    setMode(next);
    try { window.localStorage.setItem("quorum-mode", next); } catch { /* ignore */ }
  }

  function pushToast(text: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 12_000);
  }

  // ---- The room connection: created once per entry. ----
  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let audioContext: AudioContext | null = null;
    const clockTimer = window.setInterval(() => setTick(Date.now()), 500);
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const detector = createSpeakingDetector();

    // Ask for the media token right away, alongside the socket handshake, so joining is not a chain of waits.
    const tokenPromise = fetch(`/api/discussions/${discussion.id}/token`, { method: "POST" })
      .then(async (response) => ({ ok: response.ok, status: response.status, body: (await response.json().catch(() => ({}))) as { error?: string; token?: string; url?: string } }))
      .catch(() => ({ ok: false, status: 0, body: { error: "Could not reach the server to start video." } as { error?: string; token?: string; url?: string } }));

    function sendMedia() {
      socket.emit("media-state", { audio: micRef.current, video: camRef.current, hand: handRef.current, screen: screenRef.current });
    }

    function syncPeers(lk: LiveKitRoom) {
      const next = new Map<string, Peer>();
      const quality: Record<string, string> = {};
      lk.remoteParticipants.forEach((participant) => {
        const screen = participant.getTrackPublication(Track.Source.ScreenShare);
        const camera = participant.getTrackPublication(Track.Source.Camera);
        const microphone = participant.getTrackPublication(Track.Source.Microphone);
        const videoPublication = screen?.track ? screen : camera;
        const videoTrack = (videoPublication?.track as RemoteVideoTrack | undefined) ?? null;
        const audioTrack = (microphone?.track as RemoteAudioTrack | undefined) ?? null;
        next.set(participant.identity, {
          userId: participant.identity,
          name: participant.name || "Participant",
          videoTrack,
          audioTrack,
          camOn: Boolean(videoTrack) && !videoPublication?.isMuted,
          micOn: Boolean(audioTrack) && !microphone?.isMuted,
        });
        quality[participant.identity] = qualityLabel(String(participant.connectionQuality));
      });
      setPeers(next);
      setQualities((current) => ({ ...current, ...quality }));
    }

    async function connectMedia() {
      const result = await tokenPromise;
      if (stopped) return;
      if (!result.ok || !result.body.token || !result.body.url) {
        setFatal(result.body.error || `Video could not start (the server returned ${result.status}).`);
        return;
      }
      // adaptiveStream is safe here: every remote video is attached through track.attach() (see media.tsx).
      const lk = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      lkRef.current = lk;
      const refresh = () => syncPeers(lk);
      lk.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === "disconnected" && !stopped) socket.emit("technical", { kind: "ICE_FAILED", detail: "Media connection closed" });
      });
      lk.on(RoomEvent.TrackSubscribed, refresh);
      lk.on(RoomEvent.TrackUnsubscribed, refresh);
      lk.on(RoomEvent.TrackMuted, refresh);
      lk.on(RoomEvent.TrackUnmuted, refresh);
      lk.on(RoomEvent.TrackPublished, refresh);
      lk.on(RoomEvent.ParticipantConnected, refresh);
      lk.on(RoomEvent.ParticipantDisconnected, refresh);
      lk.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setActiveSpeakers(new Set(speakers.map((speaker) => speaker.identity).filter((id) => id !== user.id))));
      lk.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        setQualities((current) => ({ ...current, [participant.identity]: qualityLabel(String(quality)) }));
      });
      lk.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!lk.canPlaybackAudio));
      await lk.connect(result.body.url, result.body.token);
      if (stopped) { void lk.disconnect(); return; }
      refresh();
      setAudioBlocked(!lk.canPlaybackAudio);
      // Publish in parallel. A track that starts switched off is published disabled, then muted, so nothing leaks.
      await Promise.all(localRef.current.getTracks().map(async (track) => {
        const isAudio = track.kind === "audio";
        const wanted = isAudio ? micRef.current : camRef.current;
        track.enabled = wanted;
        const publication = await lk.localParticipant.publishTrack(track, { source: isAudio ? Track.Source.Microphone : Track.Source.Camera });
        if (!wanted) await publication.mute();
      }));
      sendMedia();
    }

    function enterMedia() {
      if (joinedMedia.current) return;
      joinedMedia.current = true;
      socket.emit("join-media", { audio: micRef.current, video: camRef.current, speechAvailable: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) });
      void connectMedia().catch((error) => {
        console.error(error);
        if (!stopped) setFatal("The media server did not accept the connection.");
      });
    }

    const nameOf = (userId: string) => rosterRef.current.find((person) => person.userId === userId)?.name ?? "Someone";

    socket.on("connect", () => socket.emit("watch", { meetingId: discussion.meetingId, code }));
    socket.on("room-error", (payload: { error: string }) => { if (payload.error !== "Slow down.") setFatal(payload.error); });
    socket.on("session-state", (payload: { status: string; startedAt: string | null; ai?: boolean; brief?: TopicBrief | null; serverNow?: number }) => {
      setStatus(payload.status);
      setStartedAt(payload.startedAt);
      setAiOn(Boolean(payload.ai));
      setBrief(payload.brief ?? null);
      if (payload.status === "LIVE" || (isHost && payload.status === "SCHEDULED")) enterMedia();
    });
    socket.on("session-live", (payload: { startedAt: string | null }) => { setStatus("LIVE"); setStartedAt(payload.startedAt); enterMedia(); });
    socket.on("waiting", () => setStatus("SCHEDULED"));
    socket.on("ai-brief", (payload: TopicBrief) => setBrief(payload));
    socket.on("ai-answer", (payload: AiAnswer) => {
      const question = payload.shared ? undefined : askedRef.current.shift();
      setAiAnswers((current) => [...current.slice(-4), { ...payload, question }]);
      setAiBusy(false);
    });
    socket.on("ai-error", (payload: { error: string }) => { setAiError(payload.error); setAiBusy(false); });
    socket.on("ai-note", (payload: { name: string; correction: string }) => pushToast(isHost ? `Fact-check, ${payload.name}: ${payload.correction}` : `AI note on your point: ${payload.correction}`));
    socket.on("live-scores", (payload: { scores: LiveScore[] }) => setLiveScores(payload.scores));
    socket.on("my-live-score", (payload: { score: LiveScore }) => setMyScore(payload.score));
    socket.on("transcript-history", (rows: Segment[]) => setSegments(rows));
    socket.on("segment", (row: Segment) => setSegments((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index === -1) return [...current, row];
      const next = [...current];
      next[index] = row;
      return next;
    }));
    socket.on("roster", (rows: RosterEntry[]) => { setRoster(rows); setOverrides({}); });
    socket.on("floor", (payload: Floor) => {
      setFloor({ lastSpeechAt: payload.lastSpeechAt, inviteAfterMs: payload.inviteAfterMs, moderated: payload.moderated, skew: payload.serverNow - Date.now() });
      setInvite(payload.invite ? { userId: payload.invite.userId, name: nameOf(payload.invite.userId), until: payload.invite.until } : null);
    });
    socket.on("speaking-turn", (payload: { userId: string; name: string; until: number }) => setInvite({ userId: payload.userId, name: payload.name, until: payload.until }));
    socket.on("turn-closed", (payload: { userId: string }) => setInvite((current) => (current && current.userId === payload.userId ? null : current)));
    socket.on("moderator", (row: { message: string; targetUserId?: string | null }) => {
      pushToast(row.message);
      if (voiceRef.current && (!row.targetUserId || row.targetUserId === user.id) && !speakingRef.current) window.speechSynthesis?.speak(new SpeechSynthesisUtterance(row.message));
    });
    socket.on("speaking", (payload: { userId: string; speaking: boolean }) => {
      setLastSpeechLocal(Date.now());
      setOverrides((current) => ({ ...current, [payload.userId]: { ...current[payload.userId], speaking: payload.speaking } }));
      if (payload.speaking) setInvite((current) => (current && current.userId === payload.userId ? null : current));
    });
    socket.on("media", (payload: { userId: string; audio: boolean; video: boolean; hand: boolean }) => {
      setOverrides((current) => ({ ...current, [payload.userId]: { ...current[payload.userId], audio: payload.audio, video: payload.video, hand: payload.hand } }));
    });
    socket.on("force-mute", (payload: { locked: boolean }) => {
      setLocked(payload.locked);
      if (payload.locked) {
        localRef.current.getAudioTracks().forEach((track) => { track.enabled = false; });
        micRef.current = false;
        setMicOn(false);
        void lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.mute();
      }
    });
    socket.on("removed", () => { setFatal("The host removed you from the discussion."); teardownRef.current(true); });
    socket.on("replaced", () => { setFatal("This discussion was opened in another tab."); teardownRef.current(true); });
    socket.on("meeting-ended", () => { setStatus("COMPLETED"); teardownRef.current(true); });
    socket.on("report-ready", () => setReportKey((value) => value + 1));

    // Voice activity from this microphone: it lights the seat and moves this person to the centre.
    const audioTrack = localRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioContext = new AudioContext();
      void audioContext.resume().catch(() => undefined);
      const analyser = audioContext.createAnalyser();
      audioContext.createMediaStreamSource(new MediaStream([audioTrack])).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const watch = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
        const event = detector.update(Math.sqrt(sum / data.length), micRef.current, performance.now());
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

    // Stops the media. Uploading the recording never blocks this: it carries on in the background.
    teardownRef.current = (background: boolean) => {
      void lkRef.current?.disconnect();
      lkRef.current = null;
      localRef.current.getTracks().forEach((track) => track.stop());
      if (background) void uploadRef.current();
    };

    return () => {
      stopped = true;
      window.clearInterval(clockTimer);
      cancelAnimationFrame(frame);
      void audioContext?.close().catch(() => undefined);
      socket.emit("leave");
      socket.disconnect();
      void lkRef.current?.disconnect();
      lkRef.current = null;
    };
    // The room connection is created once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussion.id]);

  // Speech is recognised in this browser and tied to this microphone (see the notes in the earlier version:
  // Chrome ends continuous recognition after a pause, so it is restarted on `onend`).
  useEffect(() => {
    if (!discussion.transcriptionEnabled || !micOn || status === "COMPLETED" || fatal) return;
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
    };
    const start = () => {
      if (stopped || active) return;
      active = true;
      try { recognition.start(); } catch { active = false; restartTimer = window.setTimeout(start, 800); }
    };
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = user.speechLang || "en-IN";
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalText += event.results[index][0]?.transcript ?? "";
      }
      if (!finalText.trim()) return;
      if (!buffer) bufferStart = new Date().toISOString();
      buffer = `${buffer} ${finalText}`.trim();
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, /[.?!]$/.test(buffer) ? 500 : 1200);
    };
    recognition.onerror = (event) => {
      active = false;
      const kind = event.error ?? "unknown";
      if (kind === "not-allowed" || kind === "service-not-allowed") { socket.emit("technical", { kind: "MIC_DENIED", detail: "Speech recognition permission denied" }); return; }
      if (kind === "no-speech" || kind === "aborted") return;
      socket.emit("technical", { kind: "SPEECH_ERROR", detail: `Speech recognition stopped: ${kind}` });
      restartTimer = window.setTimeout(start, 1000);
    };
    recognition.onend = () => { active = false; if (!stopped) restartTimer = window.setTimeout(start, 400); };
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
  }, [discussion.id, discussion.transcriptionEnabled, micOn, user.speechLang, status, fatal]);

  // Who is speaking right now, from every source: the server's voice activity, LiveKit, and this microphone.
  const speakingIds = useMemo(() => {
    const ids = new Set<string>();
    const known = new Set(roster.map((person) => person.userId));
    for (const person of roster) if (overrides[person.userId]?.speaking ?? person.speaking) ids.add(person.userId);
    for (const [userId, value] of Object.entries(overrides)) if (!known.has(userId) && value.speaking) ids.add(userId);
    activeSpeakers.forEach((id) => ids.add(id));
    if (localSpeaking) ids.add(user.id); else ids.delete(user.id);
    return ids;
  }, [roster, overrides, activeSpeakers, localSpeaking, user.id]);
  useEffect(() => { speakingIdsRef.current = speakingIds; }, [speakingIds]);

  // Whoever speaks takes the centre; it is held briefly so the layout does not jump on a cough.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = trackerRef.current.update(speakingIdsRef.current, Date.now());
      setFocusId((current) => (current === next ? current : next));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  // ---- Controls. Each updates the screen first, then tells the network, so a click never feels slow. ----
  function signalMedia(next: { audio?: boolean; video?: boolean; hand?: boolean; screen?: boolean } = {}) {
    socketRef.current?.emit("media-state", {
      audio: next.audio ?? micRef.current,
      video: next.video ?? camRef.current,
      hand: next.hand ?? handRef.current,
      screen: next.screen ?? screenRef.current,
    });
  }

  function toggleMic(next = !micRef.current) {
    if (locked && next) return;
    micRef.current = next;
    setMicOn(next);
    localRef.current.getAudioTracks().forEach((track) => { track.enabled = next; });
    if (!next) { speakingRef.current = false; setLocalSpeaking(false); socketRef.current?.emit("speaking", { speaking: false }); }
    signalMedia({ audio: next });
    const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (publication) void (next ? publication.unmute() : publication.mute()).catch(() => undefined);
  }

  function toggleCam(next = !camRef.current) {
    camRef.current = next;
    setCamOn(next);
    localRef.current.getVideoTracks().forEach((track) => { track.enabled = next; });
    signalMedia({ video: next });
    const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    if (publication) void (next ? publication.unmute() : publication.mute()).catch(() => undefined);
  }

  function toggleHand() {
    const next = !handRef.current;
    handRef.current = next;
    setHand(next);
    signalMedia({ hand: next });
  }

  function speak() {
    if (!micRef.current && !locked) toggleMic(true);
    if (handRef.current) toggleHand();
    socketRef.current?.emit("take-floor");
    setInvite((current) => (current && current.userId === user.id ? null : current));
  }

  async function shareScreen() {
    const next = !screenRef.current;
    screenRef.current = next;
    setScreenOn(next);
    signalMedia({ screen: next });
    await lkRef.current?.localParticipant.setScreenShareEnabled(next).catch(() => { screenRef.current = !next; setScreenOn(!next); signalMedia({ screen: !next }); });
  }

  function addTyped(event: FormEvent) {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    const now = new Date().toISOString();
    socketRef.current?.emit("transcript", { text, startedAt: now, endedAt: now });
    setTyped("");
  }

  async function uploadRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    if (recorder.state !== "inactive") await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); });
    if (!chunks.current.length) return;
    const body = new FormData();
    body.set("audio", new Blob(chunks.current, { type: "audio/webm" }), "microphone.webm");
    chunks.current = [];
    await fetch(`/api/discussions/${discussion.id}/recordings`, { method: "POST", body }).catch(() => undefined);
  }
  uploadRef.current = uploadRecording;

  function endForEveryone() {
    if (!confirm("End the discussion for everyone and score it?")) return;
    // Tell the server first. Everything else (stopping media, saving the recording) follows in the background.
    socketRef.current?.emit("end-meeting");
    setStatus("COMPLETED");
    teardownRef.current(true);
  }

  async function leave() {
    if (!confirm(isHost ? "Leave without ending it for the others?" : "Leave the discussion?")) return;
    setLeaving(true);
    socketRef.current?.emit("leave");
    teardownRef.current(false);
    await uploadRecording();
    window.location.href = isHost ? `/host/sessions/${discussion.id}` : "/participant";
  }

  function askAi(event: FormEvent) {
    event.preventDefault();
    const question = aiQuestion.trim();
    if (!question || aiBusy) return;
    setAiError("");
    setAiBusy(true);
    askedRef.current.push(question);
    socketRef.current?.emit("ask-ai", { question, share: shareAnswer });
    setAiQuestion("");
  }

  // ---- What to draw. ----
  const finished = status === "COMPLETED";
  const skew = floor?.skew ?? 0;
  const elapsed = startedAt ? tick + skew - new Date(startedAt).getTime() : 0;
  const remaining = Math.max(0, discussion.durationMin * 60_000 - elapsed);

  const { seats, selfIndex } = useMemo(() => buildSeats({
    roster,
    overrides,
    self: { userId: user.id, name: displayName, isHost },
    local: { camOn, micOn, hand, speaking: localSpeaking, stream: localRef.current },
    peers,
    qualities,
    layout,
    focusId,
    inviteUserId: invite?.userId ?? null,
    activeSpeakers,
  }), [roster, overrides, user.id, displayName, isHost, camOn, micOn, hand, localSpeaking, peers, qualities, layout, focusId, invite, activeSpeakers]);

  let secondsToInvite: number | null = null;
  if (status === "LIVE" && floor?.moderated && !invite && speakingIds.size === 0) {
    const lastSpeech = Math.max(floor.lastSpeechAt - floor.skew, lastSpeechLocal);
    const untilFirst = Math.ceil((FIRST_INVITE_AFTER_MS - elapsed) / 1000);
    secondsToInvite = Math.max(secondsUntilInvite(lastSpeech, tick, floor.inviteAfterMs), untilFirst, 0);
  }
  const message = centerMessage({
    status, isHost, moderated: Boolean(floor?.moderated), invite, selfId: user.id,
    inviteSeconds: invite ? Math.ceil((invite.until - (tick + skew)) / 1000) : 0,
    secondsToInvite,
  });
  const center = <><h2>{message.title}</h2><p>{message.sub}</p></>;

  const guests = roster.filter((person) => !person.isHost);
  const me = roster.find((person) => person.userId === user.id);
  const myQuality = qualityLabel(qualities[user.id]);
  const weak = guests.filter((person) => person.connected && qualityLabel(qualities[person.userId] ?? person.q) !== "good").length;
  const scoreOf = (userId: string) => liveScores.find((score) => score.userId === userId);
  const keywords = brief?.status === "ready" ? (brief.key_concepts ?? []).slice(0, 4).map((concept) => concept.term) : [];
  const remoteAudio = [...peers.values()].filter((peer) => peer.audioTrack);

  const primer = (
    <>
      <h3>Topic primer</h3>
      {aiOn && brief?.status === "pending" && <p className="muted">Preparing the briefing…</p>}
      {aiOn && brief?.status === "failed" && <p className="muted">The AI briefing is unavailable.</p>}
      {aiOn && brief?.status === "ready"
        ? <>
          <p style={{ margin: 0 }}>{brief.summary}</p>
          <details><summary>Key concepts</summary>{brief.key_concepts?.map((concept) => <p key={concept.term}><strong>{concept.term}</strong>: {concept.definition}</p>)}</details>
          <details><summary>Arguments</summary>
            {brief.arguments_for?.map((item, index) => <p key={`f-${index}`}>For: {item}</p>)}
            {brief.arguments_against?.map((item, index) => <p key={`a-${index}`}>Against: {item}</p>)}
            {isHost && brief.rubric?.map((item, index) => <p key={`r-${index}`}>Rubric: {item}</p>)}
          </details>
        </>
        : !aiOn && <p style={{ margin: 0 }}>{discussion.description || discussion.topic}</p>}
    </>
  );

  return (
    <div className="rt-root" data-mode={mode}>
      <header className="rt-top">
        <span className="rt-brand">Quorum</span>
        <div className="rt-top-right">
          {status === "LIVE" && <span>{formatClock(elapsed)} elapsed · {formatClock(remaining)} left</span>}
          <label>Reading mode{" "}
            <select className="rt-select" value={mode} onChange={(event) => chooseMode(event.target.value as ReadingMode)}>
              {MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {!finished && <button className="rt-btn" onClick={() => void leave()} aria-label="Leave meeting"><PhoneOff size={16} /> Leave</button>}
        </div>
      </header>

      <div className="rt-toasts" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className="rt-toast">{toast.text}</div>)}</div>
      {remoteAudio.map((peer) => <RemoteAudio key={peer.userId} track={peer.audioTrack as RemoteAudioTrack} />)}

      <main className="rt-main">
        {/* Left: the host's control panel, or the participant's own session. */}
        <aside className="rt-panel">
          {isHost ? (
            <>
              <span className="muted">Room code</span>
              <p className="rt-code" aria-label={`Room code ${discussion.roomCode ?? ""}`}>{discussion.roomCode ? spacedCode(discussion.roomCode) : "–"}</p>
              <p className="rt-note">Share this code. Participants take a seat when they join.</p>
              {!finished && <button className="rt-btn primary" onClick={endForEveryone}>End and evaluate</button>}
              <div className="rt-row"><span>Weak connections</span><strong>{weak}</strong></div>
              <h3>Live scores</h3>
              {guests.length === 0 && <p className="muted">Nobody has joined yet.</p>}
              {guests.map((person) => {
                const score = scoreOf(person.userId);
                return (
                  <div key={person.userId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <strong style={{ fontSize: 14 }}>{person.name}</strong>
                    <Bar label="Know" value={score?.knowledge} />
                    <Bar label="Part" value={score?.participation} />
                    <Bar label="Think" value={score?.thinking} />
                  </div>
                );
              })}
              {keywords.length > 0 && <><h3>Focus keywords</h3><div className="rt-chips">{keywords.map((word) => <span key={word} className="rt-chip">{word}</span>)}</div></>}
            </>
          ) : (
            <>
              <h3>Your session</h3>
              <div className="rt-row"><span>Speaking time</span><strong>{formatClock(me?.speakingMs ?? 0)}</strong></div>
              <div className="rt-row"><span>Turns taken</span><strong>{me?.contributions ?? 0}</strong></div>
              <div className="rt-row"><span>AI invitations</span><strong>{me?.invites ?? 0}</strong></div>
              <div className="rt-row"><span>Connection</span><strong>{connectionText(myQuality)}</strong></div>
              <h3>Your running scores</h3>
              <Bar label="Know" value={myScore?.knowledge} />
              <Bar label="Part" value={myScore?.participation} />
              <Bar label="Think" value={myScore?.thinking} />
            </>
          )}
          {primer}
          <p className="rt-note">The ring around each seat fills as that person reaches a fair share of the talking time. The dot shows connection quality.</p>
        </aside>

        {/* Centre: the table. */}
        <section className="rt-stagebox">
          <div className="rt-titlebar">
            <h1>{discussion.title}</h1>
            <span className={`rt-status ${finished ? "done" : "live"}`}>{finished ? "Finished" : status === "LIVE" ? "Live" : "Waiting"}</span>
          </div>
          {!mediaHealth.ready && <p className="rt-note" role="alert">Video and audio may be unavailable: {mediaHealth.error || "the media server is not responding."}</p>}
          {audioBlocked && <button className="rt-sound" onClick={() => void lkRef.current?.startAudio().then(() => setAudioBlocked(false))}>Click to turn on sound</button>}
          <div className="rt-layouts" role="group" aria-label="Layout">
            {LAYOUTS.map((item) => <button key={item.id} aria-pressed={layout === item.id} onClick={() => chooseLayout(item.id)}>{item.label}</button>)}
          </div>
          <div className="rt-stage-wrap"><Stage seats={seats} layout={layout} focusId={focusId} selfIndex={selfIndex} center={center} /></div>
          {!finished && (
            <>
              <div className="rt-controls">
                <button className={`rt-btn${micOn ? "" : " on"}`} aria-pressed={micOn} disabled={locked} onClick={() => toggleMic()}>{micOn ? <Mic size={16} /> : <MicOff size={16} />} {micOn ? "Mic on" : "Mic off"}</button>
                <button className={`rt-btn${camOn ? "" : " on"}`} aria-pressed={camOn} onClick={() => toggleCam()}>{camOn ? <Video size={16} /> : <VideoOff size={16} />} {camOn ? "Camera on" : "Camera off"}</button>
                {!isHost && <button className="rt-btn primary" onClick={speak}>Speak</button>}
                {!isHost && <button className={`rt-btn${hand ? " on" : ""}`} aria-pressed={hand} onClick={toggleHand}><Hand size={16} /> {hand ? "Lower hand" : "Raise hand"}</button>}
                <button className={`rt-btn${screenOn ? " on" : ""}`} aria-pressed={screenOn} onClick={() => void shareScreen()} aria-label="Share screen"><MonitorUp size={16} /></button>
              </div>
              {locked && <p className="rt-hint">The host has muted your microphone.</p>}
              {!isHost && discussion.transcriptionEnabled && (
                <form className="rt-typed" onSubmit={addTyped}>
                  <input className="rt-input" value={typed} maxLength={500} placeholder="No mic? Type your point" aria-label="Type your point" onChange={(event) => setTyped(event.target.value)} />
                  <button className="rt-btn" disabled={!typed.trim()}>Add point</button>
                </form>
              )}
              <p className="rt-hint">Moderator voice <button className="rt-btn" style={{ minHeight: 28, padding: "0 10px" }} onClick={() => { setVoice((value) => !value); if (voice) window.speechSynthesis?.cancel(); }}>{voice ? "on" : "off"}</button></p>
            </>
          )}
        </section>

        {/* Right: points raised, and Ask the AI. */}
        <aside className="rt-panel">
          <h3>{isHost ? "Points raised" : "Your points"}</h3>
          {segments.length === 0 && <p className="muted">{!discussion.transcriptionEnabled ? "Transcription is off for this discussion." : !micOn ? "Turn your microphone on to be transcribed." : "Points appear here as people speak."}</p>}
          <div className="rt-points">
            {segments.slice(-40).map((segment) => (
              <div key={segment.id} className="rt-point">
                <strong>{segment.name}</strong>
                <p>{segment.text}</p>
                <div className="rt-chips">{pointTags(segment).map((tag) => <span key={tag.text} className={`rt-chip ${tag.tone}`}>{tag.text}</span>)}</div>
              </div>
            ))}
          </div>
          {aiOn && (
            <>
              <h3>Ask the AI</h3>
              <form onSubmit={askAi} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="rt-input" value={aiQuestion} maxLength={500} placeholder="Ask anything about the topic" aria-label="Ask the AI" onChange={(event) => setAiQuestion(event.target.value)} />
                  <button className="rt-btn" disabled={aiBusy || !aiQuestion.trim()}>{aiBusy ? "…" : "Ask"}</button>
                </div>
                <label className="rt-note"><input type="checkbox" checked={shareAnswer} onChange={(event) => setShareAnswer(event.target.checked)} /> Share the answer with everyone</label>
              </form>
              {aiError && <p className="rt-note" role="alert">{aiError}</p>}
              {aiAnswers.map((answer, index) => (
                <div key={`${index}-${answer.answer.slice(0, 20)}`} className="rt-answer">
                  {answer.question && <strong>You asked: {answer.question}</strong>}
                  {!answer.question && answer.by && <strong>{answer.by} asked the AI</strong>}
                  <p style={{ margin: "4px 0 0" }}>{answer.answer}</p>
                </div>
              ))}
            </>
          )}
        </aside>
      </main>

      {finished && <Results discussionId={discussion.id} refreshKey={reportKey} />}

      {(fatal || leaving) && (
        <div className="rt-overlay" role="alertdialog" aria-modal="true">
          <div className="rt-modal">
            <h2>{leaving ? "Leaving" : "Discussion closed"}</h2>
            <p>{leaving ? "Saving your recording before you go…" : fatal}</p>
            {!leaving && <a className="rt-btn primary" href={isHost ? `/host/sessions/${discussion.id}` : "/participant"}>Continue</a>}
          </div>
        </div>
      )}
    </div>
  );
}
