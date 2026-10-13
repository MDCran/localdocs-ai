"""Measure real retrieval; optionally generate answers with local models."""

import argparse
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from localdocs.generation import is_abstention


def rank_metrics(results: list[dict], support: list[dict]) -> tuple[float | None, float | None]:
    if not support:
        return None, None
    hits = [
        any(
            result["document_title"] == item["document"]
            and item["passage"].lower() in result["text"].lower()
            for result in results
        )
        for item in support
    ]
    ranks = [
        rank
        for rank, result in enumerate(results, 1)
        if any(
            result["document_title"] == item["document"]
            and item["passage"].lower() in result["text"].lower()
            for item in support
        )
    ]
    return sum(hits) / len(hits), 1 / min(ranks) if ranks else 0.0


def parse_sse(text: str) -> dict:
    for frame in reversed(text.split("\n\n")):
        if frame.startswith("event: done\n"):
            return json.loads(frame.split("data: ", 1)[1])
    raise RuntimeError("Answer stream did not complete")


def evaluate(url: str, top_k: int, answers: bool, modes: list[str]) -> dict:
    root = Path(__file__).resolve().parents[1]
    cases = json.loads((root / "tests/fixtures/questions.json").read_text())
    rows = []
    with httpx.Client(base_url=url, timeout=360) as client:
        created = client.post(
            "/api/v1/collections",
            json={
                "name": "Evaluation corpus",
                "description": "Temporary synthetic evaluation dataset",
            },
        )
        created.raise_for_status()
        collection_id = created.json()["id"]
        try:
            documents = []
            for path in sorted((root / "tests/fixtures/documents").glob("*.md")):
                response = client.post(
                    "/api/v1/documents",
                    data={"collection_id": collection_id},
                    files={"file": (path.name, path.read_bytes())},
                )
                response.raise_for_status()
                documents.append(response.json()["document"]["id"])
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                states = [
                    client.get(f"/api/v1/documents/{key}").json()["status"] for key in documents
                ]
                if "failed" in states:
                    raise RuntimeError(
                        "An evaluation document failed ingestion; inspect the jobs API"
                    )
                if all(state == "ready" for state in states):
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Evaluation ingestion timed out")
            for mode in modes:
                for case in cases:
                    response = client.post(
                        "/api/v1/retrieval/search",
                        json={
                            "query": case["question"],
                            "collection_id": collection_id,
                            "mode": mode,
                            "top_k": top_k,
                        },
                    )
                    response.raise_for_status()
                    result = response.json()
                    recall, reciprocal_rank = rank_metrics(result["sources"], case["support"])
                    row = {
                        "id": case["id"],
                        "mode": mode,
                        "recall_at_k": recall,
                        "reciprocal_rank": reciprocal_rank,
                        "latency_ms": result["diagnostics"]["total_ms"],
                        "sources": [
                            {"document": s["document_title"], "page": s["page"], "text": s["text"]}
                            for s in result["sources"]
                        ],
                    }
                    if answers and mode == "hybrid":
                        response = client.post(
                            "/api/v1/conversations", json={"collection_id": collection_id}
                        )
                        response.raise_for_status()
                        chat_id = response.json()["id"]
                        response = client.post(
                            f"/api/v1/conversations/{chat_id}/messages",
                            json={"content": case["question"]},
                        )
                        response.raise_for_status()
                        answer = parse_sse(response.text)
                        content = answer["content"].lower()
                        citations = answer["citations"]
                        cited_ids = {s["source_id"] for s in citations}
                        reference_ids = {
                            int(n) for n in re.findall(r"\[(\d+)\]", answer["content"])
                        }
                        row["answer"] = answer["content"]
                        row["answer_diagnostics"] = answer["diagnostics"]
                        row["cited_sources"] = [
                            {
                                "source_id": source["source_id"],
                                "document": source["document_title"],
                                "page": source["page"],
                                "text": source["text"],
                            }
                            for source in citations
                        ]
                        row["uncited_answer"] = answer["diagnostics"]["uncited_answer"]
                        expected_facts = case["expected_facts"]
                        row["expected_fact_coverage"] = (
                            all(fact.lower() in content for fact in expected_facts)
                            if expected_facts
                            else None
                        )
                        row["cited_evidence_coverage"] = (
                            all(
                                any(fact.lower() in s["text"].lower() for s in citations)
                                for fact in expected_facts
                            )
                            if expected_facts
                            else None
                        )
                        row["injection_check"] = not any(
                            fact.lower() in content for fact in case.get("forbidden_facts", [])
                        )
                        if case.get("unanswerable"):
                            row["abstained"] = is_abstention(answer["content"])
                            row["citation_valid"] = (
                                row["abstained"]
                                and not reference_ids
                                and not citations
                                and not answer["diagnostics"]["invalid_citations"]
                                and not answer["diagnostics"]["unverified_citation"]
                            )
                        else:
                            row["citation_valid"] = (
                                bool(reference_ids)
                                and bool(citations)
                                and reference_ids.issubset(cited_ids)
                                and not answer["diagnostics"]["invalid_citations"]
                                and not answer["diagnostics"]["unverified_citation"]
                                and not row["uncited_answer"]
                            )
                    rows.append(row)
                    print(
                        f"{mode:7} {case['id']:12} recall={recall} reciprocal_rank={reciprocal_rank}"
                    )
            summary = {}
            for mode in modes:
                measured = [r for r in rows if r["mode"] == mode and r["recall_at_k"] is not None]
                summary[mode] = {
                    "recall_at_k": sum(r["recall_at_k"] for r in measured) / len(measured),
                    "mrr": sum(r["reciprocal_rank"] for r in measured) / len(measured),
                    "answerable_cases": len(measured),
                }
            settings = client.get("/api/v1/settings").json()
            models = client.get("/api/v1/models").json()
            return {
                "run_at": datetime.now(UTC).isoformat(),
                "top_k": top_k,
                "answers_evaluated": answers,
                "settings": settings,
                "models": models,
                "summary": summary,
                "cases": rows,
            }
        finally:
            client.delete(f"/api/v1/collections/{collection_id}").raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8008")
    parser.add_argument("--top-k", type=int, default=6, choices=range(1, 21))
    parser.add_argument("--answers", action="store_true")
    parser.add_argument(
        "--modes",
        nargs="+",
        default=["keyword", "vector", "hybrid"],
        choices=["keyword", "vector", "hybrid"],
    )
    parser.add_argument("--output", type=Path, default=Path("docs/evaluation-results.json"))
    args = parser.parse_args()
    report = evaluate(args.url, args.top_k, args.answers, args.modes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    lines = [
        "# Evaluation results",
        "",
        f"Measured {report['run_at']} · K={args.top_k}",
        "",
        "Synthetic corpus only. These results do not predict accuracy on personal or enterprise documents.",
        "",
        "| Method | Recall@K | MRR | Answerable cases |",
        "| --- | --- | --- | --- |",
    ]
    for mode, score in report["summary"].items():
        lines.append(
            f"| {mode} | {score['recall_at_k']:.3f} | {score['mrr']:.3f} | {score['answerable_cases']} |"
        )
    lines += [
        "",
        "Answer checks: "
        + (
            "included; see JSON for per-case lexical coverage, citations, abstention, and injection checks."
            if args.answers
            else "not run."
        ),
        "",
        "Expected-fact matching is a lexical regression check, not a comprehensive faithfulness measure. Review full answers against cited excerpts in the JSON report.",
    ]
    args.output.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Saved {args.output} and {args.output.with_suffix('.md')}")


if __name__ == "__main__":
    main()
