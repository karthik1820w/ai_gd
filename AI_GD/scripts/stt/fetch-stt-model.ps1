# PowerShell script to download the Whisper tiny.en model (sherpa-onnx format, ~118 MB) into ./models
$ErrorActionPreference = "Stop"

$modelDir = Join-Path $PSScriptRoot "..\..\models"
$targetDir = Join-Path $modelDir "sherpa-onnx-whisper-tiny.en"

if (Test-Path $targetDir) {
    Write-Host "Model already exists at: $targetDir"
    exit 0
}

New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
$archivePath = Join-Path $modelDir "sherpa-onnx-whisper-tiny.en.tar.bz2"
$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2"

Write-Host "Downloading Whisper tiny.en model from $url ..."
Invoke-WebRequest -Uri $url -OutFile $archivePath

Write-Host "Extracting archive..."
tar -xjf $archivePath -C $modelDir
Remove-Item $archivePath -Force

Write-Host "Model installed successfully in $targetDir"

