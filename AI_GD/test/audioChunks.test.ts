import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SpeechChunker, TARGET_RATE, downsample, encodeWav, wavInfo } from "../src/lib/audioChunks.ts";

const tone = (seconds: number, amp = 4000, rate = TARGET_RATE) => {
  const a = new Int16Array(Math.round(seconds * rate));
  for (let i = 0; i < a.length; i += 1) a[i] = Math.round(Math.sin(i / 9) * amp);
  return a;
};
const quiet = (seconds: number) => new Int16Array(Math.round(seconds * TARGET_RATE));
const join = (...parts: Int16Array[]) => { const out = new Int16Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

describe("WAV encoding", () => {
  it("writes a canonical header that the server accepts", () => {
    const wav = encodeWav(tone(2));
    const info = wavInfo(wav);
    assert.equal(info.ok, true);
    if (info.ok) { assert.equal(info.sampleRate, 16_000); assert.ok(Math.abs(info.seconds - 2) < 0.01); }
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  });
  it("rejects things that are not our clips", () => {
    assert.equal(wavInfo(new Uint8Array(10)).ok, false);
    assert.equal(wavInfo(new TextEncoder().encode("x".repeat(200))).ok, false);
    const wav = encodeWav(tone(1));
    assert.equal(wavInfo(wav.subarray(0, wav.length - 10)).ok, false, "truncated");
    assert.equal(wavInfo(encodeWav(tone(30)), { maxSeconds: 20 }).ok, false, "too long");
    assert.equal(wavInfo(encodeWav(tone(0.1))).ok, false, "too short");
  });
});

describe("downsampling", () => {
  it("halves 32 kHz to 16 kHz and keeps the loudness", () => {
    const input = new Float32Array(32_000).map((_, i) => Math.sin(i / 20) * 0.5);
    const out = downsample(input, 32_000);
    assert.equal(out.length, 16_000);
    const peak = Math.max(...out);
    assert.ok(peak > 0.4 * 32767 && peak < 0.55 * 32767, `peak ${peak}`);
  });
  it("handles 44.1 kHz and 48 kHz microphones", () => {
    assert.equal(downsample(new Float32Array(44_100), 44_100).length, 16_000);
    assert.equal(downsample(new Float32Array(48_000), 48_000).length, 16_000);
  });
  it("clips instead of wrapping on overload", () => {
    const out = downsample(new Float32Array(48).fill(3), 48_000);
    assert.ok(out.every((v) => v === 32767));
  });
});

describe("speech chunker", () => {
  it("never sends silence", () => {
    const chunker = new SpeechChunker();
    assert.equal(chunker.push(quiet(10)).length, 0);
    assert.equal(chunker.flush(), null);
  });
  it("sends one clip per spoken phrase, cut at the pause, with a little lead-in", () => {
    const chunker = new SpeechChunker();
    const clips = chunker.push(join(quiet(1), tone(3), quiet(1.2), tone(2), quiet(1.2)));
    assert.equal(clips.length, 2);
    assert.ok(clips[0].voicedMs >= 2900 && clips[0].voicedMs <= 3100);
    assert.ok(clips[0].durationMs < 3000 + 300 + 300 + 100, `first clip ${clips[0].durationMs} ms`);
    assert.ok(clips[1].voicedMs >= 1900 && clips[1].voicedMs <= 2100);
  });
  it("drops a short noise burst", () => {
    const chunker = new SpeechChunker();
    assert.equal(chunker.push(join(quiet(1), tone(0.3), quiet(2))).length, 0);
  });
  it("cuts continuous speech at the maximum length", () => {
    const chunker = new SpeechChunker({ maxMs: 5_000 });
    const clips = chunker.push(join(tone(12), quiet(1)));
    assert.ok(clips.length >= 2);
    assert.ok(clips.every((clip) => clip.durationMs <= 5_020));
  });
  it("is the same whether the audio arrives in big or tiny pieces", () => {
    const audio = join(quiet(1), tone(3), quiet(1.2));
    const whole = new SpeechChunker().push(audio);
    const small = new SpeechChunker();
    const clips = [];
    for (let i = 0; i < audio.length; i += 1000) clips.push(...small.push(audio.slice(i, i + 1000)));
    assert.equal(clips.length, whole.length);
    assert.equal(clips[0].durationMs, whole[0].durationMs);
  });
  it("flushes speech that is still in progress at the end", () => {
    const chunker = new SpeechChunker();
    chunker.push(join(quiet(0.5), tone(3)));
    const clip = chunker.flush();
    assert.ok(clip && clip.voicedMs >= 2900);
  });
});
