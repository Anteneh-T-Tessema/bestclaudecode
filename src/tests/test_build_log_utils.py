from src.build_log_utils import double, normalize_step_name
import pytest


def test_normalizes_typical_step_name_to_kebab_case():
    assert normalize_step_name("CLAUDE.md") == "claude-md"


def test_strips_whitespace_and_lowercases():
    assert normalize_step_name("  Subagents  ") == "subagents"


def test_raises_on_input_that_produces_empty_slug():
    with pytest.raises(ValueError):
        normalize_step_name("   ...   ")


def test_double_returns_twice_the_input():
    assert double(21) == 42