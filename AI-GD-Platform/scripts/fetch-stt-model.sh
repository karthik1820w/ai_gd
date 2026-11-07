#!/bin/sh
# Downloads the Whisper tiny.en model (sherpa-onnx format, ~118 MB) into ./models. Safe to re-run.
set -e; D="$(dirname "$0")/../models"; mkdir -p "$D"
[ -d "$D/sherpa-onnx-whisper-tiny.en" ] && exit 0
curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2 | tar xj -C "$D"
