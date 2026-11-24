import { monitorEventLoopDelay } from "node:perf_hooks";
import { json } from "@/lib/http";
import { getIO } from "@/server/realtime";

/**
 * Load-test-only metrics endpoint. Disabled unless LOADTEST_METRICS=1.
 *
 * This is the single, deliberate addition made for the audit: it exposes measurements
 * that can only be taken inside the process (event-loop lag, live socket/room counts,
 * active handle/request counts as a leak signal). It changes no behaviour and is off by
 * default, so production is unaffected.
 */
export const dynamic = "force-dynamic";

type MetricsState = { histogram: ReturnType<typeof monitorEventLoopDelay> };
const globalForMetrics = globalThis as unknown as { __quorumLoadtestMetrics?: MetricsState };

function state(): MetricsState {
  if (!globalForMetrics.__quorumLoadtestMetrics) {
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    globalForMetrics.__quorumLoadtestMetrics = { histogram };
  }
  return globalForMetrics.__quorumLoadtestMetrics;
}

const toMs = (nanoseconds: number) => Math.round((nanoseconds / 1e6) * 100) / 100;

export async function GET() {
  if (process.env.LOADTEST_METRICS !== "1") return json({ error: "load-test metrics are disabled" }, 404);
  const { histogram } = state();
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();

  let sockets = 0;
  const rooms: Record<string, number> = {};
  const io = getIO();
  if (io) {
    for (const name of io.of("/").adapter.rooms.keys()) {
      if (name.startsWith("discussion:")) rooms[name.slice("discussion:".length)] = io.of("/").adapter.rooms.get(name)?.size ?? 0;
    }
    sockets = io.of("/").sockets.size;
  }

  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? null;
  const requests = (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.().length ?? null;

  return json({
    at: Date.now(),
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    // Event-loop lag in milliseconds, measured in-process since the process started.
    eventLoopMs: {
      mean: toMs(histogram.mean),
      p50: toMs(histogram.percentile(50)),
      p95: toMs(histogram.percentile(95)),
      p99: toMs(histogram.percentile(99)),
      max: toMs(histogram.max),
    },
    memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    cpuMicros: { user: cpu.user, system: cpu.system },
    sockets,
    discussionRoomSizes: rooms,
    liveDiscussions: Object.keys(rooms).length,
    activeHandles: handles,
    activeRequests: requests,
  });
}
