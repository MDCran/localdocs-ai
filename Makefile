.PHONY: setup up down logs test lint web evaluate
setup:
	uv sync --frozen
	uv run python scripts/setup.py
up:
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs -f api worker
test:
	uv run python scripts/test.py -q
	cd apps/web && npm test
lint:
	uv run ruff check .
	uv run mypy
	cd apps/web && npm run lint && npm run typecheck
web:
	cd apps/web && npm ci && npm run dev
evaluate:
	uv run python scripts/evaluate.py --answers
