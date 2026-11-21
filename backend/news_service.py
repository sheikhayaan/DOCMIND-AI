"""Real-time news intelligence and world knowledge grounding engine using Python standard library."""

import html
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from threading import Lock
from typing import Any

# News queries cache with 15-minute TTL to ensure sub-millisecond retrieval on common topics
_NEWS_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_LOCK = Lock()
_CACHE_TTL_SECONDS = 900


def clean_xml_text(raw_text: str | None) -> str:
    """Strips HTML tags and unescapes entities from RSS item contents."""
    if not raw_text:
        return ""
    stripped = re.sub(r"<[^>]+>", "", raw_text)
    return html.unescape(stripped).strip()


def detect_news_intent(question: str) -> bool:
    """Identifies if a user prompt is asking about current affairs, breaking updates, or real-time news."""
    if not question:
        return False
    triggers = (
        r"\b(latest|breaking|today|current|recent|news|update|updates|headline|headlines|2026|now|trend|trending)\b"
    )
    return bool(re.search(triggers, question.lower()))


def fetch_latest_news(query: str = "", max_items: int = 3) -> list[dict[str, str]]:
    """Fetches real-time headlines and article summaries from Google News RSS using standard library."""
    clean_q = query.strip()
    cache_key = f"{clean_q.lower()}_{max_items}"
    now = time.time()

    with _CACHE_LOCK:
        cached = _NEWS_CACHE.get(cache_key)
        if cached and (now - cached["timestamp"] < _CACHE_TTL_SECONDS):
            return cached["items"]

    encoded = urllib.parse.quote(clean_q) if clean_q else ""
    if encoded:
        url = f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"
    else:
        url = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"

    items: list[dict[str, str]] = []
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
            },
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            xml_data = resp.read()
            root = ET.fromstring(xml_data)
            for item in root.findall("./channel/item")[:max_items]:
                title = clean_xml_text(item.findtext("title"))
                link = clean_xml_text(item.findtext("link"))
                pub_date = clean_xml_text(item.findtext("pubDate"))
                source = clean_xml_text(item.findtext("source"))
                if title:
                    items.append(
                        {
                            "title": title,
                            "link": link,
                            "published": pub_date,
                            "source": source or "Live News Network",
                        }
                    )
    except Exception:
        # Fall back gracefully without blocking the query pipeline
        items = []

    with _CACHE_LOCK:
        _NEWS_CACHE[cache_key] = {"timestamp": now, "items": items}

    return items


def format_news_for_prompt(news_items: list[dict[str, str]]) -> str:
    """Formats fetched news items into a structured prompt grounding context."""
    if not news_items:
        return ""
    lines = [
        "### REAL-TIME WORLD KNOWLEDGE & LIVE NEWS GROUNDING",
        "The following real-time breaking news feeds were fetched live to ground your answer with the latest world intelligence:",
    ]
    for idx, item in enumerate(news_items, 1):
        lines.append(f"{idx}. [{item['source']}] {item['title']} (Published: {item['published']})")
    lines.append("Integrate relevant real-time news facts into your explanation where applicable.")
    return "\n".join(lines)
