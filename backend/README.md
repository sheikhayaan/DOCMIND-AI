# Backend — RAG Pipeline & Engineering

FastAPI service for the DocMind RAG chatbot: PDF ingestion, hybrid retrieval,
reranking, and grounded answer generation with citations.

## Pipeline

```
PDF ─▶ chunk ─▶ embed (MiniLM-L6, 384d) ─▶ Pinecone (per-doc namespace)

query ─▶ rewrite (LLaMA-8b) ─▶ vector search (k=8/doc)
                             ─▶ keyword search
                             ─▶ Reciprocal Rank Fusion
                             ─▶ cross-encoder rerank ─▶ top-4 context
                             ─▶ confidence scoring
                             ─▶ answer (LLaMA-3.3-70b) + page citations
```

## Modules

| File | Purpose |
|------|---------|
| `main.py` | FastAPI routes: `/upload`, `/query`, `/session`, `/health` |
| `ingest.py` | PDF load, chunk, embed, store in Pinecone |
| `query.py` | Hybrid retrieval, RRF, confidence, answer generation |
| `rerank.py` | Cross-encoder reranking of fused candidates (graceful fallback) |
| `observability.py` | Per-query structured JSON tracing (latency, tokens, scores) |
| `evaluate.py` | LLM-as-judge eval harness (faithfulness / relevancy / precision) |
| `models.py` | Pydantic request/response schemas |

## Running

```bash
# Start the API
venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Run the test suite (offline, no API calls)
venv/Scripts/python -m pytest tests/ -v

# Evaluate RAG quality against an ingested document
venv/Scripts/python evaluate.py --doc-id <DOC_ID>
venv/Scripts/python evaluate.py --doc-id <DOC_ID> --cases my_cases.json
```

## Observability

Every `/query` emits one structured JSON line on the `rag.trace` logger, e.g.:

```json
{"trace_id":"a1b2c3d4","event":"query","total_ms":1840.2,
 "stages_ms":{"rewrite":210.1,"vector_search":120.4,"fusion":2.1,
 "rerank":380.5,"generation":1120.0},
 "vector_count":16,"fused_count":12,"final_chunk_count":4,
 "confidence":0.42,"confidence_level":"high",
 "prompt_tokens":950,"completion_tokens":180,"total_tokens":1130}
```

## Evaluation metrics

The harness scores each answer 0.0–1.0 using LLaMA-3.3-70b as judge:

- **faithfulness** — is the answer grounded in retrieved context? (hallucination check)
- **answer_relevancy** — does the answer address the question?
- **context_precision** — were the retrieved chunks relevant?

Results aggregate into `eval_report.json` plus a console summary.

## Tests

`tests/` covers the deterministic logic with no network dependency:

- `test_query.py` — cosine similarity, RRF, keyword search, confidence, history sanitisation
- `test_pipeline.py` — rerank fallbacks, trace lifecycle, token extraction
- `test_evaluate.py` — judge-score parsing and aggregation

42 tests, ~12s, fully offline.
