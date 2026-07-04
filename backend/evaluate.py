"""RAG evaluation harness — LLM-as-judge quality metrics.

Runs a set of evaluation cases through the live retrieval+generation pipeline
(answer_question) and scores each result on three RAGAS-style dimensions using
Groq LLaMA as the judge:

  - faithfulness:       is the answer grounded in the retrieved context?
                        (penalises hallucination)
  - answer_relevancy:   does the answer actually address the question?
  - context_precision:  were the retrieved chunks relevant to the question?

Each metric is scored 0.0-1.0 by the judge model. Results are aggregated into a
report printed to stdout and written to eval_report.json.

Usage:
    python evaluate.py --doc-id <DOC_ID>
    python evaluate.py --doc-id <DOC_ID> --cases my_cases.json

Cases file format (JSON):
    [{"question": "What is the refund policy?"}, ...]

If no cases file is given, DEFAULT_CASES is used. This harness makes real Groq
calls (judge + pipeline) and requires a document already ingested in Pinecone.
"""
import argparse
import json
import os
import statistics
import sys
import time

from dotenv import load_dotenv

load_dotenv()

from langchain_groq import ChatGroq

from query import answer_question, get_llm_content

JUDGE_MODEL = "llama-3.3-70b-versatile"

# Generic questions that work against most documents. Replace with domain
# specific cases (and optional reference answers) for sharper evaluation.
DEFAULT_CASES = [
    {"question": "What is the main topic of this document?"},
    {"question": "Summarize the key points in three sentences."},
    {"question": "What conclusions or recommendations does the document make?"},
    {"question": "Are there any dates, numbers, or figures mentioned? List them."},
    {"question": "Who is the intended audience of this document?"},
]

FAITHFULNESS_PROMPT = (
    "You are a strict evaluator. Given CONTEXT and an ANSWER, rate how well the "
    "ANSWER is supported by the CONTEXT. Score 1.0 if every claim is directly "
    "supported, 0.0 if the answer is fabricated or contradicts the context. "
    "Penalise any claim not present in the context. "
    "Respond with ONLY a number between 0 and 1."
)
RELEVANCY_PROMPT = (
    "You are a strict evaluator. Given a QUESTION and an ANSWER, rate how "
    "directly the ANSWER addresses the QUESTION. Score 1.0 if it fully answers "
    "the question, 0.0 if it is off-topic or evasive. "
    "Respond with ONLY a number between 0 and 1."
)
PRECISION_PROMPT = (
    "You are a strict evaluator. Given a QUESTION and a set of retrieved CONTEXT "
    "chunks, rate what fraction of the context is relevant to answering the "
    "question. Score 1.0 if all chunks are relevant, 0.0 if none are. "
    "Respond with ONLY a number between 0 and 1."
)
# JUDGE_PLACEHOLDER
def _judge_client() -> ChatGroq:
    return ChatGroq(
        model=JUDGE_MODEL,
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0,
        max_tokens=10,
    )


def _parse_score(raw: str) -> float:
    """Extracts the first float in [0,1] from the judge's reply; 0.0 on failure."""
    import re

    match = re.search(r"\d*\.?\d+", raw or "")
    if not match:
        return 0.0
    try:
        return max(0.0, min(1.0, float(match.group())))
    except ValueError:
        return 0.0


def _score(client: ChatGroq, system_prompt: str, user_content: str) -> float:
    try:
        response = client.invoke(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]
        )
        return _parse_score(get_llm_content(response))
    except Exception as exc:
        print(f"  ! judge call failed: {exc}", file=sys.stderr)
        return 0.0


def evaluate_case(client: ChatGroq, case: dict, doc_ids: list[str]) -> dict:
    """Runs one question through the pipeline and scores the three metrics."""
    question = case["question"]
    started = time.perf_counter()
    result = answer_question(question, doc_ids)
    latency_ms = round((time.perf_counter() - started) * 1000, 1)

    answer = result.get("answer", "")
    sources = result.get("sources", [])
    context = "\n\n".join(s.get("text", "") for s in sources)

    faithfulness = _score(
        client,
        FAITHFULNESS_PROMPT,
        f"CONTEXT:\n{context}\n\nANSWER:\n{answer}",
    )
    relevancy = _score(
        client,
        RELEVANCY_PROMPT,
        f"QUESTION:\n{question}\n\nANSWER:\n{answer}",
    )
    precision = _score(
        client,
        PRECISION_PROMPT,
        f"QUESTION:\n{question}\n\nCONTEXT:\n{context}",
    )

    return {
        "question": question,
        "answer": answer,
        "confidence": result.get("confidence"),
        "confidence_score": result.get("confidence_score"),
        "source_count": len(sources),
        "latency_ms": latency_ms,
        "faithfulness": faithfulness,
        "answer_relevancy": relevancy,
        "context_precision": precision,
    }


def _mean(values: list[float]) -> float:
    return round(statistics.mean(values), 3) if values else 0.0


def run(doc_ids: list[str], cases: list[dict]) -> dict:
    client = _judge_client()
    results = []
    print(f"\nRunning {len(cases)} evaluation case(s) against doc(s): {doc_ids}\n")
    for i, case in enumerate(cases, start=1):
        print(f"[{i}/{len(cases)}] {case['question']}")
        case_result = evaluate_case(client, case, doc_ids)
        results.append(case_result)
        print(
            f"    faithfulness={case_result['faithfulness']:.2f}  "
            f"relevancy={case_result['answer_relevancy']:.2f}  "
            f"precision={case_result['context_precision']:.2f}  "
            f"({case_result['latency_ms']:.0f}ms)"
        )

    aggregate = {
        "cases": len(results),
        "faithfulness": _mean([r["faithfulness"] for r in results]),
        "answer_relevancy": _mean([r["answer_relevancy"] for r in results]),
        "context_precision": _mean([r["context_precision"] for r in results]),
        "avg_latency_ms": _mean([r["latency_ms"] for r in results]),
    }
    aggregate["overall"] = _mean(
        [aggregate["faithfulness"], aggregate["answer_relevancy"], aggregate["context_precision"]]
    )

    report = {"aggregate": aggregate, "results": results}
    print("\n" + "=" * 52)
    print("  RAG EVALUATION REPORT")
    print("=" * 52)
    print(f"  Cases evaluated     : {aggregate['cases']}")
    print(f"  Faithfulness        : {aggregate['faithfulness']:.3f}")
    print(f"  Answer relevancy    : {aggregate['answer_relevancy']:.3f}")
    print(f"  Context precision   : {aggregate['context_precision']:.3f}")
    print(f"  Overall quality     : {aggregate['overall']:.3f}")
    print(f"  Avg latency         : {aggregate['avg_latency_ms']:.0f} ms")
    print("=" * 52)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG evaluation harness (LLM-as-judge).")
    parser.add_argument("--doc-id", required=True, help="Ingested document id (Pinecone namespace).")
    parser.add_argument("--cases", help="Path to a JSON file of {'question': ...} cases.")
    parser.add_argument("--out", default="eval_report.json", help="Output report path.")
    args = parser.parse_args()

    if not os.getenv("GROQ_API_KEY"):
        print("GROQ_API_KEY is not set.", file=sys.stderr)
        return 1

    cases = DEFAULT_CASES
    if args.cases:
        with open(args.cases, encoding="utf-8") as fh:
            cases = json.load(fh)
        if not isinstance(cases, list) or not cases:
            print("Cases file must be a non-empty JSON array.", file=sys.stderr)
            return 1

    report = run([args.doc_id], cases)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nReport written to {args.out}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
