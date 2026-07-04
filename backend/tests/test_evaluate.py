"""Tests for the evaluation harness scoring helpers.

The LLM-judge calls themselves require Groq + an ingested document, so they are
not exercised here. We test the deterministic parsing/aggregation that decides
whether a judge reply becomes a valid score.
"""
from evaluate import _mean, _parse_score


def test_parse_plain_float():
    assert _parse_score("0.8") == 0.8


def test_parse_embedded_in_text():
    assert _parse_score("Score: 0.95 out of 1") == 0.95


def test_parse_integer():
    assert _parse_score("1") == 1.0
    assert _parse_score("0") == 0.0


def test_parse_clamps_above_one():
    assert _parse_score("1.5") == 1.0


def test_parse_clamps_below_zero():
    # Regex captures the unsigned number; clamp keeps it in range.
    assert 0.0 <= _parse_score("0.0") <= 1.0


def test_parse_garbage_returns_zero():
    assert _parse_score("no number here") == 0.0
    assert _parse_score("") == 0.0
    assert _parse_score(None) == 0.0


def test_mean_empty_is_zero():
    assert _mean([]) == 0.0


def test_mean_rounds_to_three_places():
    assert _mean([0.1, 0.2, 0.3]) == 0.2
    assert _mean([1.0, 0.0]) == 0.5
