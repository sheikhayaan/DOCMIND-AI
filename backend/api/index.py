"""Vercel Serverless Function entrypoint exporting the FastAPI app."""

import sys
from pathlib import Path

# Adds the backend directory to sys.path so sibling modules import cleanly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402
