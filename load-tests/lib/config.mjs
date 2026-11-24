/**
 * Shared configuration for the Quorum load-test harness.
 * Nothing here touches production: every value is a local/test value.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LT = path.join(ROOT, "load-tests");
export const RESULTS = path.join(LT, "results");

export const APP_PORT = Number(process.env.LT_APP_PORT || 3100);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const PG_PORT = Number(process.env.LT_PG_PORT || 55432);
export const GEMINI_MOCK_PORT = Number(process.env.LT_MOCK_PORT || 8788);
export const GEMINI_MOCK_URL = `http://127.0.0.1:${GEMINI_MOCK_PORT}`;

export const DB_NAME = "quorum_loadtest";
export const DB_USER = "postgres";
export const DB_PASSWORD = "postgres";
export const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}?sslmode=disable`;

// Deterministic, local-only secrets. Never reuse these anywhere real.
export const JWT_SECRET = "loadtest-jwt-secret-0000000000000000000000000000000000";
export const HOST_EMAIL = "host@loadtest.local";
export const HOST_PASSWORD = "loadtest-pass-123";
export const LIVEKIT_API_KEY = "loadtestkey";
export const LIVEKIT_API_SECRET = "loadtest-livekit-secret-0000000000000000000000000";
export const LIVEKIT_URL = `ws://127.0.0.1:7880`;

/** Environment handed to the application process under test. */
export function appEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    DATABASE_URL,
    JWT_SECRET,
    HOST_EMAIL,
    HOST_PASSWORD,
    LIVEKIT_URL: process.env.LT_USE_LIVEKIT_CLOUD === "1" ? process.env.LIVEKIT_URL : LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LT_USE_LIVEKIT_CLOUD === "1" ? process.env.LIVEKIT_API_KEY : LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LT_USE_LIVEKIT_CLOUD === "1" ? process.env.LIVEKIT_API_SECRET : LIVEKIT_API_SECRET,
    LIVEKIT_HOST: `http://127.0.0.1:7880`,
    // All AI traffic goes to the local mock; no real provider is ever called.
    AI_ENABLED: "on",
    GEMINI_API_KEY: "mock-key-not-real",
    GEMINI_FLASH_API_KEY: "mock-key-not-real",
    GEMINI_BASE_URL: GEMINI_MOCK_URL,
    GEMINI_CONCURRENCY: process.env.GEMINI_CONCURRENCY || "4",
    GEMINI_REQUESTS_PER_MINUTE: process.env.GEMINI_REQUESTS_PER_MINUTE || "60",
    GEMINI_REQUEST_BURST: process.env.GEMINI_REQUEST_BURST || "5",
    // In-process metrics endpoint.
    LOADTEST_METRICS: "1",
    // Keep the app's own scratch files out of the repo, inside the test results folder.
    DATA_DIR: path.join(RESULTS, "appdata"),
    SPEAKING_TURN_MS: process.env.SPEAKING_TURN_MS || "60000",
    ...extra,
  };
}

export function newId(prefix = "lt") {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}
