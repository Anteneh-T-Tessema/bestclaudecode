"""Tests for src/screenshot_context.py."""
import base64
from pathlib import Path

import pytest

from src.screenshot_context import (
    encode_image,
    describe_screenshot,
    format_screenshot_block,
    parse_screenshot_flag,
)


# --- encode_image -----------------------------------------------------------

def _write_png(tmp_path: Path, name: str = "img.png") -> Path:
    # Minimal 1×1 white PNG (89 bytes, valid header)
    PNG_1X1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    p = tmp_path / name
    p.write_bytes(PNG_1X1)
    return p


def test_encode_image_returns_base64(tmp_path):
    p = _write_png(tmp_path)
    b64, mime = encode_image(p)
    assert mime == "image/png"
    decoded = base64.standard_b64decode(b64)
    assert decoded[:4] == b"\x89PNG"


def test_encode_image_media_type_png(tmp_path):
    p = _write_png(tmp_path)
    _, mime = encode_image(p)
    assert mime == "image/png"


def test_encode_image_media_type_jpeg(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"\xff\xd8\xff" + b"\x00" * 10)
    _, mime = encode_image(p)
    assert mime == "image/jpeg"


def test_encode_image_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        encode_image(tmp_path / "nonexistent.png")


def test_encode_image_unsupported_type(tmp_path):
    p = tmp_path / "file.bmp"
    p.write_bytes(b"BM" + b"\x00" * 10)
    with pytest.raises(ValueError, match="Unsupported"):
        encode_image(p)


# --- describe_screenshot (injected describer) --------------------------------

def test_describe_screenshot_uses_describer(tmp_path):
    p = _write_png(tmp_path)

    def fake_describer(path, b64, media_type, model):
        return "A white 1x1 PNG image."

    desc = describe_screenshot(p, describer=fake_describer)
    assert desc == "A white 1x1 PNG image."


def test_describe_screenshot_describer_receives_correct_args(tmp_path):
    p = _write_png(tmp_path)
    received = {}

    def capturing_describer(path, b64, media_type, model):
        received["path"] = path
        received["media_type"] = media_type
        received["model"] = model
        return "ok"

    describe_screenshot(p, model="claude-haiku-4-5-20251001", describer=capturing_describer)
    assert received["path"] == p
    assert received["media_type"] == "image/png"
    assert received["model"] == "claude-haiku-4-5-20251001"


def test_describe_screenshot_no_api_key_returns_placeholder(tmp_path):
    p = _write_png(tmp_path)
    desc = describe_screenshot(p, api_key="")
    assert "unavailable" in desc or "not set" in desc


# --- format_screenshot_block ------------------------------------------------

def test_format_screenshot_block_header():
    block = format_screenshot_block("A login form with an error message.", "error.png")
    assert "## Screenshot context: error.png" in block


def test_format_screenshot_block_contains_description():
    block = format_screenshot_block("A login form.", "ui.png")
    assert "A login form." in block


def test_format_screenshot_block_strips_description():
    block = format_screenshot_block("  description with spaces  ", "x.png")
    assert block.endswith("description with spaces\n")


# --- parse_screenshot_flag --------------------------------------------------

def test_parse_screenshot_flag_extracts_path():
    img, rest = parse_screenshot_flag(["--screenshot", "ui.png", "add feature"])
    assert img == Path("ui.png")
    assert rest == ["add feature"]


def test_parse_screenshot_flag_no_flag():
    img, rest = parse_screenshot_flag(["add feature"])
    assert img is None
    assert rest == ["add feature"]


def test_parse_screenshot_flag_at_start():
    img, rest = parse_screenshot_flag(["--screenshot", "err.png", "--deps", "task"])
    assert img == Path("err.png")
    assert "--deps" in rest
    assert "task" in rest


def test_parse_screenshot_flag_missing_path():
    img, rest = parse_screenshot_flag(["--screenshot"])
    assert img is None


def test_parse_screenshot_flag_empty():
    img, rest = parse_screenshot_flag([])
    assert img is None
    assert rest == []
