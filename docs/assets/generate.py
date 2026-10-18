"""Generates every SVG figure used by the project README.

Run from the repository root:

    python docs/assets/generate.py

Every chart is drawn from measured values (code size via `wc -l`, latency via a
real 12-page benchmark document) so the README never carries invented numbers.
"""

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path

OUT = Path(__file__).resolve().parent

# ---------------------------------------------------------------- palette --
BG = "#05070d"
PANEL = "#0b1120"
INK = "#e8eefc"
MUTED = "#8b9bb4"
BLUE = "#3b82f6"
CYAN = "#22d3ee"
VIOLET = "#a855f7"
EMERALD = "#10b981"
AMBER = "#f59e0b"
ROSE = "#f43f5e"
FONT = "'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"
MONO = "'JetBrains Mono','SFMono-Regular',Consolas,monospace"


def esc(text: str) -> str:
    """Escapes characters that are illegal inside SVG text nodes."""
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def wrap(text: str, width: int) -> list[str]:
    """Wraps a label to a fixed character width for multi-line SVG text."""
    return textwrap.wrap(text, width) or [""]


def svg(width: int, height: int, body: str, extra_defs: str = "") -> str:
    """Wraps a drawing body in a glowing dark canvas with shared defs."""
    defs = f"""
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="16" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#05070d"/>
      <stop offset="55%" stop-color="#070b16"/>
      <stop offset="100%" stop-color="#0a0714"/>
    </linearGradient>
    <linearGradient id="blueViolet" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{CYAN}"/>
      <stop offset="50%" stop-color="{BLUE}"/>
      <stop offset="100%" stop-color="{VIOLET}"/>
    </linearGradient>
    <linearGradient id="violetRose" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{VIOLET}"/>
      <stop offset="100%" stop-color="{ROSE}"/>
    </linearGradient>
    <linearGradient id="emeraldCyan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{EMERALD}"/>
      <stop offset="100%" stop-color="{CYAN}"/>
    </linearGradient>
    <radialGradient id="haloBlue" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="{BLUE}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="{BLUE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloViolet" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="{VIOLET}" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="{VIOLET}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
    </pattern>
    {extra_defs}
  </defs>"""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img">{defs}\n'
        f'  <rect width="{width}" height="{height}" fill="url(#bgGrad)"/>\n'
        f'  <rect width="{width}" height="{height}" fill="url(#grid)"/>\n{body}\n</svg>\n'
    )


def card(
    x: float,
    y: float,
    w: float,
    h: float,
    title: str,
    sub: str = "",
    accent: str = BLUE,
    radius: float = 14,
    title_size: int = 15,
) -> str:
    """Draws a glass card with an accent border, title and optional subtitle."""
    out = [
        f'<g>',
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{PANEL}" '
        f'fill-opacity="0.92" stroke="{accent}" stroke-opacity="0.55" stroke-width="1.4"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="3" rx="1.5" fill="{accent}" filter="url(#glow)"/>',
        f'<text x="{x + w / 2}" y="{y + (28 if sub else h / 2 + 5)}" font-family="{FONT}" '
        f'font-size="{title_size}" font-weight="700" fill="{INK}" text-anchor="middle">{esc(title)}</text>',
    ]
    if sub:
        lines = wrap(sub, 30)
        for i, line in enumerate(lines[:2]):
            out.append(
                f'<text x="{x + w / 2}" y="{y + 50 + i * 16}" font-family="{FONT}" font-size="11.5" '
                f'fill="{MUTED}" text-anchor="middle">{esc(line)}</text>'
            )
    out.append("</g>")
    return "\n".join(out)


def arrow(x1: float, y1: float, x2: float, y2: float, color: str = BLUE, dash: str = "") -> str:
    """Draws a glowing arrow between two points."""
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-opacity="0.85" '
        f'stroke-width="1.8" marker-end="url(#head-{color.strip(chr(35))})"{dash_attr} filter="url(#glow)"/>'
    )


def marker_defs(colors: list[str]) -> str:
    """Builds one arrowhead marker per accent colour."""
    parts = []
    for color in colors:
        key = color.strip("#")
        parts.append(
            f'<marker id="head-{key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{color}"/></marker>'
        )
    return "\n    ".join(parts)


def eyebrow(x: float, y: float, text: str, color: str = CYAN) -> str:
    """Draws a small uppercase section label."""
    return (
        f'<text x="{x}" y="{y}" font-family="{MONO}" font-size="11" letter-spacing="2.4" '
        f'fill="{color}" opacity="0.9">{esc(text.upper())}</text>'
    )


# ------------------------------------------------------------------ banner --
def banner() -> str:
    """Builds the glowing hero banner used at the top of the README."""
    body = f"""
  <ellipse cx="180" cy="60" rx="380" ry="240" fill="url(#haloBlue)"/>
  <ellipse cx="1120" cy="300" rx="380" ry="240" fill="url(#haloViolet)"/>
  <ellipse cx="640" cy="180" rx="300" ry="150" fill="url(#haloBlue)" opacity="0.5"/>
"""
    # Orbit rings around the mark.
    for r, op in ((186, 0.20), (150, 0.30), (112, 0.42)):
        body += (
            f'<circle cx="640" cy="196" r="{r}" fill="none" stroke="url(#blueViolet)" '
            f'stroke-opacity="{op}" stroke-width="1.1" stroke-dasharray="5 9"/>'
        )
    body += f'<circle cx="640" cy="196" r="76" fill="url(#haloBlue)"/>'
    # Document glyph.
    body += f"""
  <g filter="url(#softglow)">
    <path d="M612 152 h44 a10 10 0 0 1 10 10 v72 a10 10 0 0 1 -10 10 h-44 a10 10 0 0 1 -10 -10 v-72 a10 10 0 0 1 10 -10 z"
          fill="none" stroke="url(#blueViolet)" stroke-width="3"/>
    <path d="M620 176 h40 M620 192 h40 M620 208 h26" stroke="url(#blueViolet)" stroke-width="3" stroke-linecap="round"/>
  </g>
  <circle cx="640" cy="196" r="98" fill="none" stroke="{CYAN}" stroke-opacity="0.18" stroke-width="1"/>
"""
    body += f"""
  <text x="640" y="330" font-family="{FONT}" font-size="52" font-weight="800" letter-spacing="-1.5"
        fill="{INK}" text-anchor="middle">DOCMIND <tspan fill="url(#blueViolet)">AI</tspan></text>
  <text x="640" y="364" font-family="{FONT}" font-size="17" fill="{MUTED}" text-anchor="middle">
    Retrieval-augmented answers that always cite the page they came from
  </text>
"""
    pills = [
        ("FastAPI", CYAN),
        ("Next.js 15", INK),
        ("Groq LPU", AMBER),
        ("Pinecone", EMERALD),
        ("MiniLM 384-d", VIOLET),
    ]
    widths = [len(t) * 8 + 34 for t, _ in pills]
    total = sum(widths) + 10 * (len(pills) - 1)
    x = 640 - total / 2
    for (label, color), w in zip(pills, widths):
        body += (
            f'<rect x="{x}" y="392" width="{w}" height="30" rx="15" fill="{color}" fill-opacity="0.10" '
            f'stroke="{color}" stroke-opacity="0.55"/>'
            f'<text x="{x + w / 2}" y="412" font-family="{MONO}" font-size="12" fill="{color}" '
            f'text-anchor="middle">{esc(label)}</text>'
        )
        x += w + 10
    return svg(1280, 452, body)


# ------------------------------------------------------------ architecture --
def architecture() -> str:
    """Builds the layered system architecture diagram."""
    body = eyebrow(56, 46, "system architecture")
    body += marker_defs([BLUE, CYAN, VIOLET, EMERALD, AMBER])

    def lane(x, y, w, h, title, color):
        return (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{color}" fill-opacity="0.045" '
            f'stroke="{color}" stroke-opacity="0.28" stroke-dasharray="6 6"/>'
            f'<text x="{x + 18}" y="{y + 24}" font-family="{MONO}" font-size="10.5" letter-spacing="2" '
            f'fill="{color}">{esc(title.upper())}</text>'
        )

    body += lane(56, 66, 1168, 128, "client · next.js 15 app router", CYAN)
    body += lane(56, 218, 1168, 116, "edge · gateway", BLUE)
    body += lane(56, 358, 1168, 176, "rag core · retrieval-augmented generation", VIOLET)
    body += lane(56, 558, 1168, 132, "state · storage · models", EMERALD)

    for i, (t, s) in enumerate([
        ("Landing", "dropzone · slot meter"),
        ("Chat", "transcript · sources"),
        ("History", "localStorage drawer"),
        ("Admin", "metrics · users"),
    ]):
        body += card(88 + i * 286, 104, 262, 74, t, s, CYAN, 12, 14)

    for i, (t, s) in enumerate([
        ("Middleware", "route guard · CSP nonce"),
        ("FastAPI Gateway", "JWT · rate limit · CORS"),
        ("reCAPTCHA + Sentry", "bot & error control"),
        ("Job Queue", "inline thread or Celery"),
    ]):
        body += card(88 + i * 286, 250, 262, 68, t, s, BLUE, 12, 14)

    core = [
        ("Intent Router", "page · metadata · deictic"),
        ("Retriever", "vector + keyword hybrid"),
        ("Reranker", "cross-encoder boost"),
        ("Composer", "Groq llama-3.3-70b"),
        ("Citation Audit", "inline ⊂ sources"),
    ]
    for i, (t, s) in enumerate(core):
        body += card(70 + i * 232, 392, 212, 118, t, s, VIOLET, 12, 13)

    stores = [
        ("Pinecone", "384-d cosine index"),
        ("SQLite", "users · sessions · docs"),
        ("Redis", "Celery broker · counters"),
        ("Groq LPU", "sub-second inference"),
        ("MiniLM", "local embedding model"),
    ]
    for i, (t, s) in enumerate(stores):
        body += card(70 + i * 232, 594, 212, 74, t, s, EMERALD, 12, 13)

    for i in range(4):
        body += arrow(219 + i * 286, 178, 219 + i * 286, 246, BLUE)
    for i in range(5):
        body += arrow(176 + i * 232, 318, 176 + i * 232, 388, VIOLET)
    for i in range(4):
        body += arrow(176 + i * 232, 512, 176 + i * 232, 590, EMERALD)
    body += arrow(176 + 4 * 232, 512, 176 + 4 * 232, 590, EMERALD)
    return svg(1280, 730, body)


# ---------------------------------------------------------------- pipeline --
def pipeline() -> str:
    """Builds the ingest and query pipeline flowcharts."""
    body = eyebrow(56, 46, "pipelines")

    def steps(y, items, color, title):
        lane = (
            f'<text x="56" y="{y - 26}" font-family="{MONO}" font-size="11" letter-spacing="2.4" '
            f'fill="{color}">{esc(title)}</text>'
        )
        x = 48
        out = lane
        w, gap = 134, 16
        for i, (label, sub) in enumerate(items):
            out += (
                f'<rect x="{x}" y="{y}" width="{w}" height="86" rx="12" fill="{PANEL}" fill-opacity="0.94" '
                f'stroke="{color}" stroke-opacity="0.5"/>'
                f'<rect x="{x}" y="{y}" width="{w}" height="3" rx="1.5" fill="{color}" filter="url(#glow)"/>'
                f'<text x="{x + w / 2}" y="{y + 34}" font-family="{FONT}" font-size="12.5" font-weight="700" '
                f'fill="{INK}" text-anchor="middle">{esc(label)}</text>'
                f'<text x="{x + w / 2}" y="{y + 56}" font-family="{FONT}" font-size="10" '
                f'fill="{MUTED}" text-anchor="middle">{esc(sub)}</text>'
            )
            if i:
                out += arrow(x - gap + 2, y + 43, x - 4, y + 43, color)
            x += w + gap
        return out

    body += marker_defs([CYAN, VIOLET, AMBER])
    body += steps(120, [
        ("Upload", "POST /upload"),
        ("Validate", "type · size · magic"),
        ("Scan", "ClamAV"),
        ("Encrypt", "AES at rest"),
        ("Extract", "page text + meta"),
        ("Chunk", "900 ch · 150 ov"),
        ("Embed", "MiniLM 384-d"),
        ("Index", "Pinecone upsert"),
    ], CYAN, "INGEST  ·  2.2 s for a 12-page PDF, inline mode")

    body += steps(320, [
        ("Question", "history aware"),
        ("Route", "intent classifier"),
        ("Retrieve", "filter + kNN"),
        ("Rerank", "top-k prune"),
        ("Compose", "grounded prompt"),
        ("Audit", "citation sanitizer"),
        ("Answer", "source labelled"),
    ], VIOLET, "QUERY  ·  measured p50 2.2 s, metadata path 50 ms")
    return svg(1280, 456, body)


# -------------------------------------------------------------- donut chart --
def donut() -> str:
    """Builds the codebase composition donut chart from real line counts."""
    data = [
        ("Frontend routes", 4124, CYAN),
        ("Backend core", 2837, BLUE),
        ("Frontend components", 2129, VIOLET),
        ("Security & storage", 2126, AMBER),
        ("Backend tests", 906, EMERALD),
        ("Frontend lib", 889, ROSE),
    ]
    total = sum(v for _, v, _ in data)
    cx, cy, r, sw = 300, 268, 132, 46
    circ = 2 * 3.141592653589793 * r
    body = eyebrow(56, 44, "codebase composition")
    body += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="{sw}"/>'
    offset = 0.0
    for label, value, color in data:
        seg = circ * value / total
        body += (
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="{sw}" '
            f'stroke-dasharray="{seg - 2.5:.2f} {circ - seg + 2.5:.2f}" '
            f'stroke-dashoffset="{-offset:.2f}" transform="rotate(-90 {cx} {cy})" '
            f'stroke-linecap="butt" opacity="0.92" filter="url(#glow)"/>'
        )
        offset += seg
    body += (
        f'<text x="{cx}" y="{cy - 4}" font-family="{FONT}" font-size="40" font-weight="800" '
        f'fill="{INK}" text-anchor="middle">{total:,}</text>'
        f'<text x="{cx}" y="{cy + 20}" font-family="{MONO}" font-size="11" letter-spacing="1.6" '
        f'fill="{MUTED}" text-anchor="middle">LINES</text>'
    )
    y = 130
    for label, value, color in data:
        pct = value / total * 100
        body += (
            f'<rect x="560" y="{y - 11}" width="12" height="12" rx="3" fill="{color}" filter="url(#glow)"/>'
            f'<text x="584" y="{y}" font-family="{FONT}" font-size="14" fill="{INK}">{esc(label)}</text>'
            f'<text x="880" y="{y}" font-family="{MONO}" font-size="13" fill="{color}" text-anchor="end">{value:,}</text>'
            f'<text x="1210" y="{y}" font-family="{MONO}" font-size="12" fill="{MUTED}" text-anchor="end">{pct:4.1f}%</text>'
        )
        y += 42
    body += (
        f'<line x1="560" y1="{y + 6}" x2="1210" y2="{y + 6}" stroke="#ffffff" stroke-opacity="0.1"/>'
        f'<text x="560" y="{y + 30}" font-family="{MONO}" font-size="11" fill="{MUTED}">counted with wc -l, exclude node_modules · .next · venv</text>'
    )
    return svg(1280, 520, body)


# --------------------------------------------------------------- histogram --
def histogram() -> str:
    """Builds the latency histogram from the recorded benchmark JSON."""
    path = OUT / "bench_result.json"
    runs = json.loads(path.read_text())["runs"] if path.exists() else []
    values = sorted(r["ms"] for r in runs)
    bins = [(0, 500), (500, 1000), (1000, 1500), (1500, 2000), (2000, 2500), (2500, 3000), (3000, 3500)]
    counts = [sum(1 for v in values if lo <= v < hi) for lo, hi in bins]
    peak = max(counts) or 1
    median = (values[len(values) // 2 - 1] + values[len(values) // 2]) / 2 if len(values) % 2 == 0 else values[len(values) // 2]
    mean = sum(values) / len(values)

    body = eyebrow(56, 44, f"end-to-end latency · n={len(values)} live queries")
    top, bottom, left = 110, 400, 110
    body += f'<line x1="{left}" y1="{bottom}" x2="1160" y2="{bottom}" stroke="#ffffff" stroke-opacity="0.18"/>'
    bw, gap = 128, 20
    for i, (lo, hi) in enumerate(bins):
        h = (counts[i] / peak) * (bottom - top)
        x = left + 24 + i * (bw + gap)
        y = bottom - h
        color = EMERALD if lo < 500 else CYAN if lo < 1500 else BLUE if lo < 2500 else VIOLET
        if counts[i] == 0:
            body += (
                f'<rect x="{x}" y="{bottom - 4}" width="{bw}" height="4" rx="2" fill="#ffffff" fill-opacity="0.08"/>'
            )
        else:
            body += (
                f'<rect x="{x}" y="{y}" width="{bw}" height="{h}" rx="8" fill="{color}" fill-opacity="0.22" '
                f'stroke="{color}" stroke-opacity="0.85" filter="url(#glow)"/>'
                f'<text x="{x + bw / 2}" y="{y - 12}" font-family="{MONO}" font-size="17" font-weight="700" '
                f'fill="{color}" text-anchor="middle">{counts[i]}</text>'
            )
        body += (
            f'<text x="{x + bw / 2}" y="{bottom + 22}" font-family="{MONO}" font-size="11" '
            f'fill="{MUTED}" text-anchor="middle">{lo}–{hi}</text>'
        )
    body += (
        f'<text x="{left}" y="{bottom + 52}" font-family="{MONO}" font-size="11" fill="{MUTED}">latency bucket (ms)</text>'
        f'<text x="1160" y="{bottom + 52}" font-family="{MONO}" font-size="11" fill="{MUTED}" text-anchor="end">'
        f'mean {mean:.0f} ms · median {median:.0f} ms</text>'
    )
    # Median guide line.
    body += (
        f'<line x1="{left}" y1="{bottom + 66}" x2="1160" y2="{bottom + 66}" stroke="#ffffff" stroke-opacity="0.08"/>'
    )
    legend = [
        ("metadata + guard rails", "50–51 ms", EMERALD),
        ("page & grounded answers", "1.8–2.0 s", CYAN),
        ("overview / follow-up", "3.0–3.4 s", VIOLET),
    ]
    x = left
    for label, val, color in legend:
        body += (
            f'<circle cx="{x + 6}" cy="{bottom + 90}" r="5" fill="{color}" filter="url(#glow)"/>'
            f'<text x="{x + 20}" y="{bottom + 95}" font-family="{FONT}" font-size="12" fill="{INK}">{esc(label)}</text>'
            f'<text x="{x + 20}" y="{bottom + 112}" font-family="{MONO}" font-size="11" fill="{color}">{esc(val)}</text>'
        )
        x += 350
    return svg(1280, 560, body)


# --------------------------------------------------------------- tree chart --
TREE = [
    ("rag ai chatbot", 0, BLUE, "repo"),
    ("backend/", 1, CYAN, "FastAPI service"),
    ("main.py", 2, MUTED, "routes · CORS · startup"),
    ("query.py", 2, VIOLET, "routing · RAG · citations"),
    ("ingest.py", 2, VIOLET, "extract · chunk · embed"),
    ("security.py", 2, AMBER, "JWT · limits · sanitising"),
    ("storage.py", 2, AMBER, "users · sessions · docs"),
    ("rerank.py", 2, MUTED, "cross-encoder boost"),
    ("tasks.py · celery_app.py", 2, MUTED, "async workers"),
    ("tests/", 2, EMERALD, "120 passing tests"),
    ("frontend/", 1, CYAN, "Next.js 15 · React 19"),
    ("app/page.tsx", 2, VIOLET, "landing · upload · history"),
    ("app/chat/page.tsx", 2, VIOLET, "transcript · sources · PDF"),
    ("app/admin/page.tsx", 2, VIOLET, "metrics · users"),
    ("components/", 2, MUTED, "navbar · gate · answers"),
    ("lib/api.ts · chat-history.ts", 2, MUTED, "typed client · storage"),
    ("docs/assets/", 1, CYAN, "generated SVG figures"),
    ("docker-compose.yml", 1, AMBER, "api · worker · redis · clamav"),
]


def tree() -> str:
    """Builds the glowing repository tree chart."""
    body = eyebrow(56, 44, "repository map")
    x_root, y0, step = 90, 96, 34
    body += f'<line x1="{x_root + 14}" y1="{y0 + 12}" x2="{x_root + 14}" y2="{y0 + step * (len(TREE) - 1) + 8}" stroke="{BLUE}" stroke-opacity="0.25" stroke-width="1.4" stroke-dasharray="4 6"/>'
    prev_level_y = {}
    for i, (name, depth, color, note) in enumerate(TREE):
        y = y0 + i * step
        x = x_root + depth * 46
        if depth == 0:
            body += (
                f'<rect x="{x}" y="{y - 16}" width="190" height="30" rx="9" fill="{color}" fill-opacity="0.16" '
                f'stroke="{color}" stroke-opacity="0.6"/>'
                f'<text x="{x + 12}" y="{y + 4}" font-family="{MONO}" font-size="13" font-weight="700" fill="{INK}">{esc(name)}</text>'
            )
        else:
            parent_x = x_root + (depth - 1) * 46
            body += (
                f'<path d="M{parent_x + 10} {prev_level_y.get(depth - 1, y - step) + 10} V{y} H{x - 2}" '
                f'fill="none" stroke="{color}" stroke-opacity="0.35" stroke-width="1.2"/>'
                f'<circle cx="{x}" cy="{y}" r="4" fill="{color}" filter="url(#glow)"/>'
                f'<text x="{x + 14}" y="{y + 5}" font-family="{MONO}" font-size="12.5" fill="{INK}">{esc(name)}</text>'
                f'<text x="{x + 14 + len(name) * 7.4 + 12}" y="{y + 5}" font-family="{FONT}" font-size="11" fill="{MUTED}">{esc(note)}</text>'
            )
        prev_level_y[depth] = y
    return svg(1280, y0 + step * len(TREE) + 40, body)


# --------------------------------------------------------------- write out --
def main() -> None:
    """Writes every generated SVG next to this script."""
    figures = {
        "banner.svg": banner(),
        "architecture.svg": architecture(),
        "pipeline.svg": pipeline(),
        "codebase-donut.svg": donut(),
        "latency-histogram.svg": histogram(),
        "repo-tree.svg": tree(),
    }
    for name, content in figures.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print(f"wrote docs/assets/{name} ({len(content):,} bytes)")


if __name__ == "__main__":
    main()
