# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/hf-cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Bake the MiniLM weights into the image so the first request never downloads 90 MB.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}" \
    HF_HOME=/home/app/.cache/huggingface \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    ENABLE_QUERY_REWRITE=false \
    ENABLE_RERANKER=false \
    SECURITY_DB_PATH=/app/.data/security.sqlite3 \
    DOCMIND_DATA_DIR=/app/.data \
    DOCMIND_STAGING_DIR=/app/.data/staging

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /opt/hf-cache /home/app/.cache/huggingface

WORKDIR /app
COPY --chown=app:app . .
RUN mkdir -p /app/.data/staging && chown -R app:app /app/.data

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

CMD ["sh", "-c", "gunicorn main:app -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY} -b 0.0.0.0:${PORT} --timeout 120 --graceful-timeout 30 --access-logfile - --error-logfile -"]
