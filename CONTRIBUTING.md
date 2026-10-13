# Contributing

LocalDocs AI is maintained by its owner. Focused issues and pull requests are welcome.

## Development

1. Install Python 3.12+, Node.js 24+, Docker Desktop, and Ollama.
2. Follow the [local setup guide](docs/setup.md).
3. Run `uv run ruff check .`, `uv run mypy`, `uv run python scripts/test.py`, and `cd apps/web && npm ci && npm run lint && npm test && npm run build`.
4. For browser tests, start the app and Ollama, then run `cd apps/web && npx playwright install chromium && npm run test:e2e`.
5. Keep public errors concise and sample documents synthetic.

Do not commit uploaded documents, private settings, API keys, database dumps, downloaded model weights, or evaluation results that were not produced by a recorded run.
