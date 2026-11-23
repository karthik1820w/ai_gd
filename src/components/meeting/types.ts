import type { RemoteAudioTrack, RemoteVideoTrack } from "livekit-client";

export type TopicBrief = {
  status: "pending" | "ready" | "failed" | "off";
  source?: string;
  model?: string;
  summary?: string;
  key_concepts?: Array<{ term: string; definition: string }>;
  key_facts?: string[];
  arguments_for?: string[];
  arguments_against?: string[];
  rubric?: string[];
};

export type DiscussionInfo = {
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
  /** Host only. */
  roomCode?: string;
};

export type Segment = {
  id: string;
  participantId?: string;
  userId: string;
  name: string;
  text: string;
  startedAt: string;
  endedAt?: string;
  relevance: string;
  relevanceReason: string;
  analysisSource: string;
  accuracy?: string | null;
  correction?: string;
  concepts?: string[];
  gist?: string;
};

export type RosterEntry = {
  userId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  audio: boolean;
  video: boolean;
  hand: boolean;
  speaking: boolean;
  micLocked: boolean;
  camLocked?: boolean;
  /** False when this person's browser cannot transcribe speech. */
  speechAvailable?: boolean;
  speakingMs: number;
  contributions: number;
  invites: number;
  q: string;
  /** Host only (roster-admin). */
  relevant?: number;
  irrelevant?: number;
  missed?: number;
  technical?: number;
};

export type LiveScore = { participantId: string; userId: string; name: string; knowledge: number | null; participation: number; thinking: number | null; overall: number | null; source: string; sttIssue: boolean };
export type MediaHealth = { ready: boolean; error: string | null };
export type Floor = { serverNow: number; lastSpeechAt: number; inviteAfterMs: number; openFloorAt: number | null; moderated: boolean; invite: { userId: string; until: number } | null };
export type Invite = { userId: string; name: string; until: number };

/** A remote person's tracks as LiveKit currently reports them. */
export type Peer = {
  userId: string;
  name: string;
  videoTrack: RemoteVideoTrack | null;
  audioTrack: RemoteAudioTrack | null;
  camOn: boolean;
  micOn: boolean;
};

export type SeatInfo = {
  userId: string;
  name: string;
  isSelf: boolean;
  isHost: boolean;
  connected: boolean;
  camOn: boolean;
  micOn: boolean;
  hand: boolean;
  speaking: boolean;
  invited: boolean;
  quality: string;
  speakingMs: number;
  fill: number;
  remoteVideo: RemoteVideoTrack | null;
  localStream: MediaStream | null;
};

export type ResultsPerson = {
  participantId: string;
  name: string;
  score: number | null;
  category: string;
  incomplete: boolean;
  incompleteReason: string | null;
  sttIssue: boolean;
  status: "scored" | "incomplete" | "insufficient_data";
  speakingMs: number;
  contributions: number;
  parameters: Array<{ key: string; label: string; weight: number; score: number | null; evidenceIds: string[]; confidence: number | null; explanation: string }>;
  moderation: Array<{ kind: string; text: string; at: string }>;
  removed: { reason: string; at: string | null } | null;
  strengths: string[];
  improvements: string[];
  covered: string[];
  missed: string[];
};

export type Results = {
  ready: boolean;
  running?: boolean;
  error?: string;
  role?: "host" | "participant";
  evaluatedBy?: string;
  formula?: string;
  summary?: { source: string; conclusion: string; quality: string | null; keyInsights: string[]; agreements: string[]; disagreements: string[]; missedTopics: string[]; bestContribution: string | null } | null;
  people?: ResultsPerson[];
  transcript?: { turns: Array<{ index: number; speakerId: string; speaker: string; offsetSec: number; text: string; source: string }> };
};
