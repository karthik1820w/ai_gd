"""Offline STT worker. Protocol on stdin: [u32 id][u32 nbytes][16 kHz mono int16 PCM]; stdout: one JSON line per request.
Engine: Whisper via sherpa-onnx when STT_MODEL_DIR points at a sherpa-onnx whisper model, else pocketsphinx (much less accurate)."""
import sys, struct, json, os, glob
MODEL = os.environ.get('STT_MODEL_DIR')
if MODEL:
    import numpy as np, sherpa_onnx
    pick = lambda pat: sorted(glob.glob(os.path.join(MODEL, pat)))[0]
    enc = pick('*encoder.int8.onnx') if glob.glob(os.path.join(MODEL, '*encoder.int8.onnx')) else pick('*encoder.onnx')
    dec = pick('*decoder.int8.onnx') if glob.glob(os.path.join(MODEL, '*decoder.int8.onnx')) else pick('*decoder.onnx')
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=enc, decoder=dec, tokens=pick('*tokens.txt'), language='en', task='transcribe', num_threads=int(os.environ.get('STT_THREADS', '2')))
    def transcribe(pcm):
        s = rec.create_stream(); s.accept_waveform(16000, np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0); rec.decode_stream(s); return s.result.text.strip()
else:
    try:
        from pocketsphinx import Decoder  # optional low-accuracy fallback (pip install pocketsphinx)
    except Exception:
        sys.stderr.write('STT: no model (set STT_MODEL_DIR; run scripts/fetch-stt-model.sh) and pocketsphinx not installed\n'); sys.exit(3)
    d = Decoder(samprate=16000, loglevel='FATAL')
    def transcribe(pcm):
        d.start_utt(); d.process_raw(pcm, False, True); d.end_utt(); h = d.hyp(); return h.hypstr if h else ''
def read(n):
    b = b''
    while len(b) < n:
        c = sys.stdin.buffer.read(n - len(b))
        if not c: return None
        b += c
    return b
while True:
    h = read(8)
    if not h: break
    rid, n = struct.unpack('>II', h); pcm = read(n)
    if pcm is None: break
    print(json.dumps({'id': rid, 'text': transcribe(pcm)}), flush=True)
