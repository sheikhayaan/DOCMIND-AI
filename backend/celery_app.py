"""Celery application shared by the API and ingestion workers.

The broker and result backend are Redis. Job progress still lives in SQLite,
so a status read never depends on Celery's result object being present.
"""

import os

from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
INGESTION_QUEUE = os.getenv("INGESTION_QUEUE_NAME", "docmind")

celery_app = Celery("docmind", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_default_queue=INGESTION_QUEUE,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    result_expires=86400,
)
