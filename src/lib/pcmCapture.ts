import { downsample, TARGET_RATE } from "@/lib/audioChunks";

/**
 * Reads the microphone as 16 kHz mono samples (browser only). Used by the fallback transcription path.
 * Returns a function that stops it. If the browser's audio clock is below 16 kHz it does nothing.
 */
export function startPcmCapture(stream: MediaStream, onSamples: (samples: Int16Array) => void): () => void {
  const track = stream.getAudioTracks()[0];
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!track || !Context) return () => undefined;
  const context = new Context();
  if (context.sampleRate < TARGET_RATE) { void context.close().catch(() => undefined); return () => undefined; }
  const source = context.createMediaStreamSource(new MediaStream([track]));
  // ScriptProcessor is deprecated but works in every browser, and needs no separate worker file.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  processor.onaudioprocess = (event) => onSamples(downsample(event.inputBuffer.getChannelData(0), context.sampleRate));
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  void context.resume().catch(() => undefined);
  return () => {
    processor.onaudioprocess = null;
    try { source.disconnect(); processor.disconnect(); silent.disconnect(); } catch { /* already disconnected */ }
    void context.close().catch(() => undefined);
  };
}
