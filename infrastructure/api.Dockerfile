FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api apps/api
COPY workers workers
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 localdocs && mkdir -p /app/data/uploads && chown -R localdocs:localdocs /app/data
COPY alembic.ini ./
COPY apps/api/migrations apps/api/migrations
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER localdocs
CMD ["uvicorn", "localdocs.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
