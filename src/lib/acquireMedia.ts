/**
 * Opens the microphone and camera, degrading gracefully. A missing or blocked camera
 * must not also take the microphone away, which is what asking for both in one call
 * does: the whole request fails and the person joins without being heard.
 */
export type Acquired = { stream: MediaStream; hasAudio: boolean; hasVideo: boolean; note: string };

export async function acquireMedia(audioId = "", videoId = ""): Promise<Acquired> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return { stream: new MediaStream(), hasAudio: false, hasVideo: false, note: "This browser cannot open a microphone or camera. You can still join to listen." };
  const audio = (): MediaTrackConstraints | boolean => (audioId ? { deviceId: { ideal: audioId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true });
  const video = (): MediaTrackConstraints | boolean => (videoId ? { deviceId: { ideal: videoId } } : true);
  const attempts: Array<{ audio: boolean; video: boolean; note: string }> = [
    { audio: true, video: true, note: "" },
    { audio: true, video: false, note: "No camera was available, so you will join with your microphone only." },
    { audio: false, video: true, note: "The microphone was blocked or missing. You can be seen but not heard until you allow it." },
  ];
  for (const attempt of attempts) {
    try {
      const stream = await devices.getUserMedia({ audio: attempt.audio ? audio() : false, video: attempt.video ? video() : false });
      return { stream, hasAudio: stream.getAudioTracks().length > 0, hasVideo: stream.getVideoTracks().length > 0, note: attempt.note };
    } catch {
      // Try the next, smaller request.
    }
  }
  return { stream: new MediaStream(), hasAudio: false, hasVideo: false, note: "Camera and microphone permission was denied. You can still join to listen." };
}
