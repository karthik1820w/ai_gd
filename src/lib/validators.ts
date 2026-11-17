import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(80),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(80),
});

export const forgotSchema = z.object({
  email: z.string().trim().email(),
});

export const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(80),
});

export const discussionSchema = z.object({
  title: z.string().trim().min(3).max(120),
  topic: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(2000),
  context: z.string().trim().max(2000).nullish().transform((value) => value ?? ""),
  rules: z.string().trim().min(10).max(2000),
  date: z.string().min(8),
  time: z.string().min(4),
  durationMin: z.coerce.number().int().min(5).max(180),
  maxParticipants: z.coerce.number().int().min(2).max(40),
  speakingTimeSec: z.coerce.number().int().min(15).max(300),
  silencePromptSec: z.coerce.number().int().min(10).max(180),
  mode: z.enum(["FREE_FLOW", "AI_MODERATED"]),
  moderatorEnabled: z.boolean(),
  transcriptionEnabled: z.boolean(),
  recordingEnabled: z.boolean(),
  retentionDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  speechLang: z.string().trim().min(2).max(16),
});

export const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  nextPassword: z.string().min(8).max(80),
});

export const feedbackSchema = z.object({
  evaluationId: z.string().min(4),
  score: z.coerce.number().min(0).max(100),
  reason: z.string().trim().min(8).max(500),
});

export const inviteSchema = z.object({
  email: z.string().trim().email(),
});

export const enterSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  transcriptionConsent: z.boolean(),
  recordingConsent: z.boolean(),
  speechAvailable: z.boolean(),
  code: z.string().max(12).optional(),
});
