FROM python:3.11-slim

# Install runtime dependencies listed in requirements.txt, including CPU-only torch.
RUN useradd -m -u 1000 user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    PORT=7860 \
    ENABLE_QUERY_REWRITE=false \
    ENABLE_RERANKER=false

WORKDIR $HOME/app
USER user

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .

EXPOSE 7860

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
