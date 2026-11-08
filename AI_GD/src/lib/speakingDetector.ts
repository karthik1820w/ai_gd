type SpeakingDetectorOptions = {
  startThreshold?: number;
  stopThreshold?: number;
  attackMs?: number;
  releaseMs?: number;
  maxEventsPerSecond?: number;
};

export function createSpeakingDetector(options: SpeakingDetectorOptions = {}) {
  const startThreshold = options.startThreshold ?? 0.045;
  const stopThreshold = options.stopThreshold ?? 0.025;
  const attackMs = options.attackMs ?? 150;
  const releaseMs = options.releaseMs ?? 600;
  const minimumEventIntervalMs = 1000 / (options.maxEventsPerSecond ?? 2);
  let speaking = false;
  let candidateSince: number | null = null;
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let lastEmitted = false;
  let pending: boolean | null = null;

  return {
    update(rms: number, enabled: boolean, now: number): boolean | null {
      const desired = enabled && rms >= (speaking ? stopThreshold : startThreshold);
      if (desired === speaking) {
        candidateSince = null;
      } else {
        if (candidateSince === null) candidateSince = now;
        const duration = desired ? attackMs : releaseMs;
        if (now - candidateSince >= duration) {
          speaking = desired;
          candidateSince = null;
          pending = speaking === lastEmitted ? null : speaking;
        }
      }

      if (pending === null || now - lastEmittedAt < minimumEventIntervalMs) return null;
      lastEmittedAt = now;
      lastEmitted = pending;
      const event = pending;
      pending = null;
      return event;
    },
  };
}
