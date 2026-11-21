"""Unit tests for real-time news intelligence and collective cross-user learning."""

import os
from pathlib import Path
from news_service import clean_xml_text, detect_news_intent, format_news_for_prompt
from learning import SelfLearningStore


def test_detect_news_intent():
    """Verifies that news-related questions trigger real-time grounding intent."""
    assert detect_news_intent("What is the latest news in AI today?") is True
    assert detect_news_intent("Give me breaking updates on tech") is True
    assert detect_news_intent("What is the trend in 2026?") is True
    assert detect_news_intent("Explain the formula for compound interest") is False


def test_clean_xml_text():
    """Verifies RSS text stripping and unescaping."""
    assert clean_xml_text("<p>Breaking &amp; Important</p>") == "Breaking & Important"
    assert clean_xml_text(None) == ""


def test_format_news_for_prompt():
    """Verifies prompt block generation from news articles."""
    items = [
        {
            "title": "Quantum Sensor Breakout",
            "link": "https://example.com/quantum",
            "published": "Sat, 21 Nov 2026 12:00:00 GMT",
            "source": "Tech Wire",
        }
    ]
    formatted = format_news_for_prompt(items)
    assert "REAL-TIME WORLD KNOWLEDGE & LIVE NEWS GROUNDING" in formatted
    assert "Quantum Sensor Breakout" in formatted
    assert "Tech Wire" in formatted


def test_collective_cross_user_learning(tmp_path: Path):
    """Verifies that user interactions from multiple users build collective wisdom."""
    store = SelfLearningStore(tmp_path / "collective_test.sqlite3")

    # User 1 session
    store.record_session_qa(
        "sess-u1",
        "How do edge IoT microcontrollers sync with MQTT brokers?",
        "Edge IoT microcontrollers sync via QoS-level publish/subscribe topics over lightweight TCP/TLS channels.",
        "doc-iot-1",
    )

    # User 2 session
    store.record_session_qa(
        "sess-u2",
        "What are the security standards for industrial IoT gateways?",
        "Industrial IoT gateways enforce IEC 62443 standards with mutual TLS and hardware root-of-trust.",
        "doc-iot-2",
    )

    # Check that real-time recording already indexed them into collective wisdom
    stats = store.get_stats()
    assert stats.collective_insights >= 2
    assert stats.collective_sessions == 2

    # Distill collective wisdom across users
    synthesized = store.auto_distill_cross_user_wisdom()
    assert isinstance(synthesized, int)

    # User 3 asks an IoT sync question without having uploaded User 1's doc
    exemplars = store.get_relevant_exemplars("tell me how microcontrollers sync over mqtt", limit=2)
    assert len(exemplars) >= 1
    assert any("microcontrollers" in ex["question"].lower() for ex in exemplars)

    # Check stats reflect collective wisdom
    stats = store.get_stats()
    assert stats.collective_sessions == 2
    assert stats.collective_insights >= 1
    assert "Active" in stats.news_grounding_status
    assert "IoT Human Intelligence" in stats.intelligence_mode
