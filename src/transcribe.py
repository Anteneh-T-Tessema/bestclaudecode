"""
Local Whisper transcription via faster-whisper.

CLI: python -m src.transcribe <audio-file-path> [--json]

Degrades gracefully if faster-whisper is not installed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_model = None


def _get_model():
    global _model
    if _model is not None:
        return _model
    import os
    try:
        from faster_whisper import WhisperModel  # type: ignore[import]
    except ImportError:
        return None
    size = os.environ.get("LAKOORA_WHISPER_MODEL", "base")
    _model = WhisperModel(size)
    return _model


def transcribe(audio_path: str) -> dict:
    """Transcribe an audio file using the local Whisper model. Returns a dict with success/text/error keys."""
    model = _get_model()
    if model is None:
        return {"success": False, "error": "faster-whisper not installed — run: pip install faster-whisper"}
    try:
        segments, _ = model.transcribe(audio_path)
        text = " ".join(seg.text.strip() for seg in segments)
        return {"success": True, "text": text}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"success": False, "error": "Usage: python -m src.transcribe <audio-file> [--json]"}))
        sys.exit(1)

    audio_path = args[0]
    if not Path(audio_path).exists():
        print(json.dumps({"success": False, "error": f"File not found: {audio_path}"}))
        sys.exit(1)

    result = transcribe(audio_path)
    print(json.dumps(result))
    sys.exit(0 if result.get("success") else 1)
