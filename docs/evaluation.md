# Evaluation

The versioned fixture corpus includes three focused Markdown documents and eight questions covering fact lookup, exact terms, cross document comparison, unanswerable questions, and malicious document instructions. Each expected result names its document and literal supporting passage.

Run retrieval evaluation with the downloaded local models:

```sh
uv run python scripts/evaluate.py
```

Include streamed answer checks with `uv run python scripts/evaluate.py --answers`. The script creates a temporary collection, uploads the fixture files through the API, waits for the background worker, runs each retrieval method, records timings, and queues cleanup. It writes JSON details and a Markdown summary under `docs/evaluation-results`. Reports include their run time, model names, configuration, and actual measured outcomes; generated reports are excluded from Git.

For each answerable question, Recall@K is the fraction of expected passages present in the first K results. MRR records the reciprocal rank of the first supporting passage. Unanswerable questions are reported separately and excluded from average recall. The optional answer pass records citation ID validation, lexical expected fact coverage, expected facts in cited passages, an abstention marker, and a prompt injection check.

Lexical answer checks are regression signals, not comprehensive faithfulness measures. Abstention and injection checks use phrase matching rather than human judgment. A high fixture score does not predict performance on unrelated documents. Review complete answers against their citations before drawing broader conclusions. Hardware and model versions affect answer quality and latency.

Deterministic tests use controlled model fixtures and do not download weights. The optional browser CI uses a small local Ollama protocol fixture. To verify actual local PDF extraction, embeddings, answer generation, citations, persistence, and deletion with the downloaded models, run:

```sh
uv run python scripts/smoke_live.py
```
