"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Room as LiveKitRoom, RoomEvent, Track, type RemoteAudioTrack, type RemoteVideoTrack } from "livekit-client";
import { io, type Socket } from "socket.io-client";
import { Hand, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { createSpeakingDetector } from "@/lib/speakingDetector";
import { FocusTracker, LAYOUTS, isLayoutMode, type LayoutMode } from "@/lib/stageLayout";
import { FIRST_INVITE_AFTER_MS, SPEAKING_HEARTBEAT_MS, secondsUntilInvite } from "@/lib/floor";
import { buildSeats, centerMessage, clockLabel, connectionText, qualityLabel, spacedCode, type LiveOverride } from "@/lib/meetingView";
import { formatClock } from "@/lib/format";
import { SpeechChunker, encodeWav } from "@/lib/audioChunks";
import { startPcmCapture } from "@/lib/pcmCapture";
import { SpeechAssembler, type CaptureLine } from "@/lib/speechCapture";
import { Stage } from "./Stage";
import { RemoteAudio } from "./media";
import { Results } from "./Results";
import type { DiscussionInfo, Floor, Invite, LiveScore, MediaHealth, Peer, RosterEntry, Segment, TopicBrief } from "./types";

type Toast = { id: string; text: string };
type FloorState = { lastSpeechAt: number; inviteAfterMs: number; moderated: boolean; skew: number };
type HandEntry = { userId: string; name: string; raisedAt: number; position: number; speakingMs: number; contributions: number };
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
  // Words being spoken right now (not final yet), by speaker. Shown only to that speaker and the host.
  const [interims, setInterims] = useState<Record<string, { name: string; text: string; at: number }>>({});
  const [transcriptFilter, setTranscriptFilter] = useState<string>("all");
  const pointsRef = useRef<HTMLDivElement | null>(null);
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
  const [camLocked, setCamLocked] = useState(false);
  const [speechIssue, setSpeechIssue] = useState("");
  const [captureIssue, setCaptureIssue] = useState("");
  const [savedLines, setSavedLines] = useState(0);
  const [audioMode, setAudioMode] = useState(false);
  const [lockOverrides, setLockOverrides] = useState<Record<string, { mic?: boolean; cam?: boolean }>>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [typed, setTyped] = useState("");
  const [voice, setVoice] = useState(true);
  // Floor etiquette: nobody is talked over, the host sees who asked to speak first, and the AI covers for a host who drops.
  const [hostAway, setHostAway] = useState(false);
  const [handQueue, setHandQueue] = useState<{ queue: HandEntry[]; skew: number }>({ queue: [], skew: 0 });
  const [myPlace, setMyPlace] = useState<{ position: number; of: number } | null>(null);

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
  const pendingVoiceRef = useRef<{ text: string; at: number } | null>(null);
  const rosterRef = useRef<RosterEntry[]>([]);
  const joinedMedia = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const askedRef = useRef<string[]>([]);
  const trackerRef = useRef(new FocusTracker());
  const speakingIdsRef = useRef<Set<string>>(new Set());
  const teardownRef = useRef<(background: boolean) => void>(() => undefined);
  const uploadRef = useRef<() => Promise<void>>(async () => undefined);
  const watchedRef = useRef(false);
  const queueRef = useRef<Array<{ text: string; startedAt: string; endedAt: string }>>([]);
  const savedRef = useRef(0);
  const aiRef = useRef(false);
  // True when the server can turn audio into text (Gemini or offline Whisper): the audio fallback needs it.
  const sttRef = useRef(false);
  const speechAtSaveRef = useRef(0);
  const audioModeRef = useRef(false);
  const speechMsRef = useRef(0);
  const speakStartRef = useRef(0);
  const recogFailures = useRef(0);

  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => {
    const box = pointsRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [segments.length, interims, transcriptFilter]);
  useEffect(() => { aiRef.current = aiOn; }, [aiOn]);
  useEffect(() => { audioModeRef.current = audioMode; }, [audioMode]);

  // ---- Saving spoken lines. Every line is acknowledged: saved, or the reason it was not. ----
  const noteAckRef = useRef<(result?: { ok: boolean; message?: string; benign?: boolean }) => void>(() => undefined);
  noteAckRef.current = (result) => {
    if (result?.ok) {
      savedRef.current += 1;
      speechAtSaveRef.current = speechMsRef.current + (speakStartRef.current ? Date.now() - speakStartRef.current : 0);
      setSavedLines(savedRef.current);
      setCaptureIssue("");
    } else if (result && !result.benign) {
      setCaptureIssue(result.message || "Your words could not be saved.");
    }
  };
  function sendLine(line: { text: string; startedAt: string; endedAt: string }) {
    const socket = socketRef.current;
    if (!socket) return;
    // Before the room is joined the server would drop the line, so hold it until it can be saved.
    if (!watchedRef.current) { queueRef.current.push(line); return; }
    socket.emit("transcript", line, (result?: { ok: boolean; reason?: string; message?: string; benign?: boolean }) => {
      noteAckRef.current(result);
      // The server had not (re)joined this connection yet: keep the line and send it once it has.
      if (result && !result.ok && result.reason === "not-joined") { watchedRef.current = false; queueRef.current.push(line); }
    });
  }
  function useAudioFallback(reason: string) {
    // Sticky for the session, so the two transcription paths never both send the same words.
    if (audioModeRef.current || !sttRef.current || isHost) return;
    audioModeRef.current = true;
    setAudioMode(true);
    setSpeechIssue("");
    socketRef.current?.emit("technical", { kind: "SPEECH_FALLBACK", detail: reason });
    pushToast("Your browser cannot transcribe, so short audio clips are being turned into text instead.");
  }
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

    socket.on("connect", () => { watchedRef.current = false; socket.emit("watch", { meetingId: discussion.meetingId, code }); });
    socket.on("room-error", (payload: { error: string }) => { if (payload.error !== "Slow down.") setFatal(payload.error); });
    socket.on("session-state", (payload: { status: string; startedAt: string | null; ai?: boolean; stt?: boolean; brief?: TopicBrief | null; serverNow?: number }) => {
      setStatus(payload.status);
      setStartedAt(payload.startedAt);
      setAiOn(Boolean(payload.ai));
      aiRef.current = Boolean(payload.ai);
      sttRef.current = Boolean(payload.stt ?? payload.ai);
      setBrief(payload.brief ?? null);
      // The room is joined: send any lines that were spoken before this moment.
      watchedRef.current = true;
      for (const line of queueRef.current.splice(0)) socket.emit("transcript", line, noteAckRef.current);
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
    socket.on("interim", (row: { userId: string; name: string; text: string; at: number }) => setInterims((current) => {
      if (!row.text) { const { [row.userId]: _gone, ...rest } = current; return rest; }
      return { ...current, [row.userId]: { name: row.name, text: row.text, at: Date.now() } };
    }));
    socket.on("segment", (row: Segment) => setSegments((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index === -1) return [...current, row];
      const next = [...current];
      next[index] = row;
      return next;
    }));
    socket.on("segment", (row: Segment) => setInterims((current) => {
      if (!current[row.userId]) return current;
      const { [row.userId]: _saved, ...rest } = current;
      return rest;
    }));
    socket.on("roster", (rows: RosterEntry[]) => { setRoster(rows); setOverrides({}); setLockOverrides({}); });
    socket.on("floor", (payload: Floor & { hostAway?: boolean }) => {
      setHostAway(Boolean(payload.hostAway));
      setFloor({ lastSpeechAt: payload.lastSpeechAt, inviteAfterMs: payload.inviteAfterMs, moderated: payload.moderated, skew: payload.serverNow - Date.now() });
      setInvite(payload.invite ? { userId: payload.invite.userId, name: nameOf(payload.invite.userId), until: payload.invite.until } : null);
    });
    socket.on("speaking-turn", (payload: { userId: string; name: string; until: number }) => setInvite({ userId: payload.userId, name: payload.name, until: payload.until }));
    socket.on("turn-closed", (payload: { userId: string }) => setInvite((current) => (current && current.userId === payload.userId ? null : current)));
    // The AI voice never talks over a person. If anyone is speaking the message waits (and is dropped if it
    // has gone stale), and the moment anyone starts speaking, a message already being read is cut off.
    const anyoneSpeaking = () => speakingRef.current || [...speakingIdsRef.current].some((id) => id !== user.id);
    const sayAloud = (text: string) => { try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice available */ } };
    const flushVoice = () => {
      const pending = pendingVoiceRef.current;
      if (!pending || anyoneSpeaking()) return;
      pendingVoiceRef.current = null;
      if (Date.now() - pending.at < 25_000 && voiceRef.current) sayAloud(pending.text);
    };
    socket.on("moderator", (row: { message: string; targetUserId?: string | null }) => {
      pushToast(row.message);
      if (!voiceRef.current || (row.targetUserId && row.targetUserId !== user.id)) return;
      pendingVoiceRef.current = { text: row.message, at: Date.now() };
      flushVoice();
    });
    socket.on("host-status", (payload: { away: boolean }) => setHostAway(Boolean(payload.away)));
    socket.on("hand-queue", (payload: { serverNow: number; queue: HandEntry[] }) => setHandQueue({ queue: payload.queue, skew: payload.serverNow - Date.now() }));
    socket.on("hand-position", (payload: { position: number; of: number }) => setMyPlace({ position: payload.position, of: payload.of }));
    socket.on("hand-lowered", () => {
      handRef.current = false;
      setHand(false);
      setMyPlace(null);
    });
    socket.on("floor-busy", (payload: { holderId?: string; reason?: string }) => {
      const holder = payload.holderId ? nameOf(payload.holderId) : "Someone";
      if (payload.reason === "mic-blocked") {
        // The server refused to open the microphone: bring this browser back in line.
        micRef.current = false;
        setMicOn(false);
        localRef.current.getAudioTracks().forEach((track) => { track.enabled = false; });
        void lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.mute();
        pushToast(`${holder} is speaking. Raise your hand and wait for your turn.`);
      } else pushToast(`${holder} has the floor. Please wait for them to finish. The host has been told.`);
    });
    socket.on("interruption", (payload: { name: string; holderId?: string }) => pushToast(`${payload.name} is speaking over ${payload.holderId ? nameOf(payload.holderId) : "another speaker"}. You can mute them from the People list.`));
    socket.on("host-notice", (payload: { message: string }) => pushToast(payload.message));
    socket.on("speaking", (payload: { userId: string; speaking: boolean }) => {
      if (payload.speaking) {
        window.speechSynthesis?.cancel();
      } else {
        window.setTimeout(flushVoice, 700);
      }
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
        pushToast("The host muted your microphone.");
      } else pushToast("The host allowed your microphone again.");
    });
    socket.on("force-camera", (payload: { locked: boolean }) => {
      setCamLocked(payload.locked);
      if (payload.locked) {
        camRef.current = false;
        setCamOn(false);
        localRef.current.getVideoTracks().forEach((track) => { track.enabled = false; });
        void lkRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.mute();
        pushToast("The host turned off your camera.");
      } else pushToast("The host allowed your camera again.");
    });
    socket.on("removed", (payload?: { message?: string }) => { setFatal(payload?.message || "The host removed you from this discussion. This is recorded in your report."); teardownRef.current(true); });
    socket.on("replaced", () => { setFatal("This discussion was opened in another tab."); teardownRef.current(true); });
    socket.on("meeting-ended", (payload?: { reason?: string }) => {
      window.speechSynthesis?.cancel();
      if (payload?.reason === "time") pushToast("Time is up. The discussion has ended automatically.");
      else if (!isHost) pushToast("The host ended the discussion.");
      setStatus("COMPLETED");
      teardownRef.current(true);
    });
    socket.on("report-ready", () => setReportKey((value) => value + 1));

    // Voice activity from this microphone: it lights the seat and moves this person to the centre.
    const audioTrack = localRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioContext = new AudioContext();
      void audioContext.resume().catch(() => undefined);
      const analyser = audioContext.createAnalyser();
      audioContext.createMediaStreamSource(new MediaStream([audioTrack])).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let lastBeat = 0;
      const watch = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
        const event = detector.update(Math.sqrt(sum / data.length), micRef.current, performance.now());
        if (event !== null) {
          if (event) speakStartRef.current = Date.now();
          else if (speakStartRef.current) { speechMsRef.current += Date.now() - speakStartRef.current; speakStartRef.current = 0; }
          speakingRef.current = event;
          setLocalSpeaking(event);
          socket.emit("speaking", { speaking: event });
          lastBeat = performance.now();
        } else if (speakingRef.current && performance.now() - lastBeat > SPEAKING_HEARTBEAT_MS) {
          // Still talking: say so, so the floor is never released from under a long speaker.
          socket.emit("speaking", { speaking: true });
          lastBeat = performance.now();
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

  // Speech is recognised in this browser and tied to this microphone. The assembler turns the recogniser's events
  // into finished lines (no repeats, real start times) and the poll below sends them within a fraction of a second.
  // A recognition session ends by itself after a pause, so a fresh one is started straight away.
  useEffect(() => {
    // The host moderates and is never transcribed.
    if (isHost || !discussion.transcriptionEnabled || !micOn || status === "COMPLETED" || fatal || audioMode) return;
    const socket = socketRef.current;
    if (!socket) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      socket.emit("technical", { kind: "SPEECH_UNSUPPORTED", detail: "This browser has no SpeechRecognition API" });
      if (sttRef.current) useAudioFallback("This browser has no SpeechRecognition API");
      else setSpeechIssue("This browser cannot transcribe speech, so your words will not be scored. Open the discussion in Chrome or Edge, or type your points below.");
      return;
    }
    setSpeechIssue("");
    const assembler = new SpeechAssembler();
    let recognition: SpeechRecognition | null = null;
    let lang = user.speechLang || "en-IN";
    let stopped = false;
    let active = false;
    let restartTimer = 0;
    let lastCaptionAt = 0;

    const ship = (line: CaptureLine | null) => {
      if (!line || audioModeRef.current) return;
      sendLine({ text: line.text, startedAt: new Date(line.startedAt).toISOString(), endedAt: new Date(line.endedAt).toISOString() });
    };
    const showCaption = (text: string) => {
      const now = Date.now();
      if (!text || now - lastCaptionAt < 300 || !watchedRef.current) return;
      lastCaptionAt = now;
      socket.emit("interim", { text });
    };
    const start = () => {
      if (stopped || active) return;
      active = true;
      assembler.newSession();
      const next = new Recognition();
      recognition = next;
      next.continuous = true;
      next.interimResults = true;
      next.lang = lang;
      next.onresult = (event) => {
        const pieces = Array.from({ length: event.results.length }, (_, index) => ({ transcript: event.results[index][0]?.transcript ?? "", isFinal: event.results[index].isFinal }));
        const { caption } = assembler.push(pieces, Date.now());
        if (pieces.some((piece) => piece.isFinal && piece.transcript.trim())) { recogFailures.current = 0; setSpeechIssue(""); }
        showCaption(caption);
        ship(assembler.due(Date.now()));
      };
      next.onerror = (event) => {
        const kind = event.error ?? "unknown";
        if (kind === "no-speech" || kind === "aborted") return;
        if (kind === "language-not-supported" && lang !== "en-US") {
          // Some browsers do not offer the regional variant; plain English still understands Indian English.
          lang = "en-US";
          return;
        }
        recogFailures.current += 1;
        const hard = kind === "not-allowed" || kind === "service-not-allowed" || kind === "audio-capture" || kind === "network" || kind === "language-not-supported";
        socket.emit("technical", { kind: kind === "not-allowed" || kind === "service-not-allowed" ? "MIC_DENIED" : "SPEECH_ERROR", detail: `Speech recognition stopped: ${kind}` });
        if (hard && recogFailures.current >= 2 && sttRef.current) { useAudioFallback(`Speech recognition kept failing: ${kind}`); return; }
        if (kind === "not-allowed" || kind === "service-not-allowed") { stopped = true; setSpeechIssue("Speech recognition was blocked. Allow the microphone for this site, or type your points below."); }
        else if (kind === "network") setSpeechIssue("Speech recognition could not reach its service. Check your connection, or type your points below.");
        else if (kind === "audio-capture") setSpeechIssue("No microphone was available to the speech recogniser. Check which microphone is selected, or type your points below.");
      };
      next.onend = () => {
        active = false;
        ship(assembler.drain(Date.now()));
        // Start again at once: every pause before the next session is speech that would be lost.
        if (!stopped) restartTimer = window.setTimeout(start, recogFailures.current > 0 ? 800 : 40);
      };
      try { next.start(); } catch { active = false; restartTimer = window.setTimeout(start, 800); }
    };
    // Lines go out as soon as they are due, not when the next recogniser event happens to arrive.
    const poll = window.setInterval(() => ship(assembler.due(Date.now())), 100);
    start();

    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearTimeout(restartTimer);
      ship(assembler.drain(Date.now()));
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.stop(); } catch { /* already stopped */ }
      }
    };
  }, [discussion.id, discussion.transcriptionEnabled, micOn, user.speechLang, status, fatal, isHost, audioMode]);

  // Fallback: cut the microphone into spoken clips and have the server turn them into text.
  useEffect(() => {
    if (!audioMode || isHost || !micOn || status === "COMPLETED" || fatal || !discussion.transcriptionEnabled) return;
    const chunker = new SpeechChunker();
    let chain: Promise<void> = Promise.resolve();
    const upload = (clip: { samples: Int16Array; durationMs: number }) => {
      const wav = encodeWav(clip.samples);
      chain = chain.then(async () => {
        try {
          const response = await fetch(`/api/discussions/${discussion.id}/audio`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as unknown as BodyInit });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) { setCaptureIssue(body.error || "A clip could not be transcribed."); return; }
          noteAckRef.current(body.empty ? { ok: false, benign: true } : { ok: Boolean(body.ok), message: body.message, benign: body.benign });
        } catch {
          setCaptureIssue("Could not reach the server to transcribe your speech. Check your connection.");
        }
      });
    };
    const stop = startPcmCapture(localRef.current, (samples) => { for (const clip of chunker.push(samples)) upload(clip); });
    return () => {
      stop();
      const rest = chunker.flush();
      if (rest) upload(rest);
    };
  }, [audioMode, isHost, micOn, status, fatal, discussion.id, discussion.transcriptionEnabled]);

  // Watchdog: the person has clearly been talking, yet recognition has saved nothing new. Switch to the fallback.
  useEffect(() => {
    if (isHost || !discussion.transcriptionEnabled || audioMode || status === "COMPLETED") return;
    const timer = window.setInterval(() => {
      const spoken = speechMsRef.current + (speakStartRef.current ? Date.now() - speakStartRef.current : 0);
      const unsaved = spoken - speechAtSaveRef.current;
      if (!sttRef.current) return;
      if (savedRef.current === 0 && unsaved >= 6_000) useAudioFallback("Heard speech for 6 seconds but saved no words");
      else if (savedRef.current > 0 && unsaved >= 20_000) useAudioFallback("Heard 20 seconds of speech with no new words saved");
    }, 2_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, discussion.transcriptionEnabled, audioMode, status]);

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

  // Anyone else speaking right now? Then nobody (except the host) may open a microphone and talk over them.
  function floorBusy() {
    if (isHost) return false;
    return [...speakingIdsRef.current].some((id) => id !== user.id);
  }

  function toggleMic(next = !micRef.current) {
    if (locked && next) return;
    if (next && floorBusy()) {
      pushToast("Someone is speaking. Raise your hand and wait for your turn.");
      return;
    }
    micRef.current = next;
    setMicOn(next);
    localRef.current.getAudioTracks().forEach((track) => { track.enabled = next; });
    if (!next) { speakingRef.current = false; setLocalSpeaking(false); socketRef.current?.emit("speaking", { speaking: false }); }
    signalMedia({ audio: next });
    const publication = lkRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (publication) void (next ? publication.unmute() : publication.mute()).catch(() => undefined);
  }

  function toggleCam(next = !camRef.current) {
    if (camLocked && next) return;
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
    if (floorBusy()) {
      pushToast("Someone is speaking. Raise your hand and wait for your turn.");
      return;
    }
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
    sendLine({ text, startedAt: now, endedAt: now });
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

  // Host moderation. The screen updates first; the server records it for that person's report.
  function hostMute(person: RosterEntry) {
    const locked = !(lockOverrides[person.userId]?.mic ?? person.micLocked);
    setLockOverrides((current) => ({ ...current, [person.userId]: { ...current[person.userId], mic: locked } }));
    socketRef.current?.emit("host-mute", { userId: person.userId, locked });
  }
  function hostGiveFloor(userId: string) {
    socketRef.current?.emit("host-grant-floor", { userId });
  }
  function hostRemove(person: RosterEntry) {
    const reason = window.prompt(`Remove ${person.name} from the discussion?\n\nThey will see this reason, cannot rejoin, and it is recorded in their report.`, "Disruptive behaviour");
    if (reason === null) return;
    socketRef.current?.emit("host-remove", { userId: person.userId, reason: reason.trim() || "Disruptive behaviour" });
  }

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
  const wasRemoved = Boolean(fatal && /removed you/i.test(fatal));
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

  // The transcript rows only change when a line arrives, not on every clock tick, so they are built once per change.
  const transcriptRows = useMemo(() => segments.filter((segment) => transcriptFilter === "all" || segment.userId === transcriptFilter).slice(-200).map((segment) => {
    const offset = startedAt ? (new Date(segment.startedAt).getTime() - new Date(startedAt).getTime()) / 1000 : null;
    return (
      <div key={segment.id} className="rt-point">
        <strong>{isHost ? segment.name : "You"}{offset != null && <span className="rt-time"> · {clockLabel(Math.max(0, offset))}</span>}</strong>
        <p>{segment.text}</p>
        <div className="rt-chips">{pointTags(segment).map((tag) => <span key={tag.text} className={`rt-chip ${tag.tone}`}>{tag.text}</span>)}</div>
      </div>
    );
  }), [segments, transcriptFilter, startedAt, isHost]);

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

  // What the person should know about their own transcription, right now.
  const captureProblem = Boolean(captureIssue || speechIssue);
  const captureText = captureIssue || speechIssue
    || (!micOn ? "Turn your microphone on to be transcribed."
      : audioMode ? `Transcribing with the AI audio fallback · ${savedLines} ${savedLines === 1 ? "line" : "lines"} saved`
      : savedLines > 0 ? `Transcribing · ${savedLines} ${savedLines === 1 ? "line" : "lines"} saved. Only you and the host can see them.`
      : "Listening. Speak, and your words appear under Your points.");

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

      {hostAway && !finished && <div className="rt-away" role="status">The host has lost their connection. The AI moderator is keeping the discussion running and will hand it back when the host returns.</div>}
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
              <h3>Hand queue</h3>
              {handQueue.queue.length === 0 && <p className="muted">Nobody has a hand up.</p>}
              {handQueue.queue.length > 0 && (
                <ol className="rt-queue" aria-label="Hands raised, first to raise at the top">
                  {handQueue.queue.map((entry: HandEntry) => (
                    <li key={entry.userId} className="rt-queue-row">
                      <span className="rt-queue-pos" aria-hidden="true">{entry.position}</span>
                      <span className="rt-queue-name"><strong>{entry.name}</strong><span className="rt-note">waiting {Math.max(0, Math.round((tick + handQueue.skew - entry.raisedAt) / 1000))}s · {Math.round(entry.speakingMs / 1000)}s spoken</span></span>
                      <button className="rt-btn small primary" disabled={speakingIds.size > 0} title={speakingIds.size > 0 ? "Wait until the current speaker finishes" : "Give this person the floor"} onClick={() => hostGiveFloor(entry.userId)}>Give floor</button>
                    </li>
                  ))}
                </ol>
              )}
              <h3>People</h3>
              {guests.filter((person) => person.connected).length === 0 && <p className="muted">Nobody has joined yet.</p>}
              {guests.filter((person) => person.connected).map((person) => {
                const micOff = lockOverrides[person.userId]?.mic ?? person.micLocked;
                return (
                  <div key={person.userId} className="rt-person-row">
                    <strong style={{ fontSize: 14 }}>{person.name}</strong>
                    <span className="rt-note">{(overrides[person.userId]?.audio ?? person.audio) ? "Mic on" : "Mic off"} · {(overrides[person.userId]?.video ?? person.video) ? "Camera on" : "Camera off"} · {person.contributions} {person.contributions === 1 ? "line" : "lines"} transcribed</span>
                    {person.speechAvailable === false && person.contributions === 0 && <span className="rt-chip warn">Browser cannot transcribe{aiOn ? " (AI fallback)" : ""}</span>}
                    {person.speechAvailable !== false && person.contributions === 0 && person.speakingMs > 10_000 && <span className="rt-chip warn">Heard speaking, no words captured yet</span>}
                    <div className="rt-actions">
                      <button className={`rt-btn small${micOff ? " on" : ""}`} aria-pressed={micOff} onClick={() => hostMute(person)}>{micOff ? "Allow mic" : "Mute"}</button>
                      <button className="rt-btn small danger" onClick={() => hostRemove(person)}>Remove</button>
                    </div>
                  </div>
                );
              })}
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
                <button className={`rt-btn${micOn ? "" : " on"}`} aria-pressed={micOn} disabled={locked || (!micOn && floorBusy())} title={!micOn && floorBusy() ? "Someone is speaking" : undefined} onClick={() => toggleMic()}>{micOn ? <Mic size={16} /> : <MicOff size={16} />} {micOn ? "Mic on" : "Mic off"}</button>
                <button className={`rt-btn${camOn ? "" : " on"}`} aria-pressed={camOn} disabled={camLocked} onClick={() => toggleCam()}>{camOn ? <Video size={16} /> : <VideoOff size={16} />} {camOn ? "Camera on" : "Camera off"}</button>
                {!isHost && <button className="rt-btn primary" onClick={speak}>Speak</button>}
                {!isHost && <button className={`rt-btn${hand ? " on" : ""}`} aria-pressed={hand} onClick={toggleHand}><Hand size={16} /> {hand ? "Lower hand" : "Raise hand"}</button>}
                <button className={`rt-btn${screenOn ? " on" : ""}`} aria-pressed={screenOn} onClick={() => void shareScreen()} aria-label="Share screen"><MonitorUp size={16} /></button>
              </div>
              {locked && <p className="rt-hint">The host has muted your microphone.</p>}
              {!isHost && !micOn && !locked && floorBusy() && <p className="rt-hint">Someone is speaking. Your microphone can be switched on when they finish.</p>}
              {!isHost && hand && myPlace && <p className="rt-hint">Your hand is up. You are number {myPlace.position} in the queue.</p>}
              {!isHost && discussion.transcriptionEnabled && (
                <p className="rt-note" role={captureProblem ? "alert" : "status"} style={{ textAlign: "center", color: captureProblem ? "var(--rt-bad)" : undefined }}>{captureText}</p>
              )}
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

        {/* Right: the live transcript, and Ask the AI. */}
        <aside className="rt-panel">
          <h3>{isHost ? "Live transcript" : "Your transcript"}</h3>
          {isHost && guests.length > 1 && (
            <select className="rt-input" aria-label="Show transcript for" value={transcriptFilter} onChange={(event) => setTranscriptFilter(event.target.value)}>
              <option value="all">Everyone</option>
              {guests.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
            </select>
          )}
          {segments.length === 0 && <p className="muted">{!discussion.transcriptionEnabled ? "Transcription is off for this discussion." : isHost ? "Participants' lines appear here as they speak. The host is not transcribed." : !micOn ? "Turn your microphone on to be transcribed." : "Your own words appear here once they are captured. Only you and the host can see them."}</p>}
          <div className="rt-points" ref={pointsRef} aria-live="polite">
            {transcriptRows}
            {Object.entries(interims)
              .filter(([userId, caption]) => tick - caption.at < 6000 && (transcriptFilter === "all" || userId === transcriptFilter))
              .map(([userId, caption]) => (
                <div key={`live-${userId}`} className="rt-point rt-interim" aria-hidden="true">
                  <strong>{isHost ? caption.name : "You"}<span className="rt-time"> · speaking now</span></strong>
                  <p>{caption.text}…</p>
                </div>
              ))}
          </div>
          {segments.length > 0 && (
            <div className="rt-actions">
              <a className="rt-btn" href={`/api/discussions/${discussion.id}/transcript?format=txt&download=1${isHost && transcriptFilter !== "all" && segments.find((segment) => segment.userId === transcriptFilter)?.participantId ? `&speaker=${encodeURIComponent(segments.find((segment) => segment.userId === transcriptFilter)!.participantId!)}` : ""}`}>{isHost ? "Download transcript so far (.txt)" : "Download my transcript so far (.txt)"}</a>
            </div>
          )}
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
            <h2>{leaving ? "Leaving" : wasRemoved ? "You were removed from this discussion" : "Discussion closed"}</h2>
            <p>{leaving ? "Saving your recording before you go…" : fatal}</p>
            {!leaving && <div className="rt-actions">
              {wasRemoved && !isHost && <a className="rt-btn primary" href={`/participant/reports/${discussion.id}`}>View my report</a>}
              <a className={`rt-btn${wasRemoved ? "" : " primary"}`} href={isHost ? `/host/sessions/${discussion.id}` : "/participant"}>{wasRemoved ? "Back to my discussions" : "Continue"}</a>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}
