# Local setup

## Docker Desktop

Install [Docker Desktop with WSL2 on Windows](https://docs.docker.com/desktop/setup/install/windows-install/), Docker Desktop on macOS, or Docker Engine and Compose on Linux. Start Ollama on the host and pull `nomic-embed-text` and a chat model such as `llama3.2:3b`:

```sh
ollama pull nomic-embed-text
ollama pull llama3.2:3b
```

In this directory, run:

```sh
uv sync --frozen
uv run python scripts/setup.py
docker compose up --build
```

Open `http://localhost:5178`. The REST explorer is at `http://localhost:5178/api/docs`. PostgreSQL and Redis bind to loopback on ports 5438 and 6388. Database migrations run before the API and worker start. The database and uploads survive container restarts in named volumes.

The first start downloads container images and Python and Node packages. Ollama stores the model weights on the host. Docker reaches host Ollama through `host.docker.internal`.

## CPU and GPU

Use Ollama's default host service for CPU inference. Ollama can use compatible Apple Metal and NVIDIA GPUs on the host. CPU inference works for smaller models, but response and embedding times depend on model size, device memory, and document length. Docker Desktop does not need GPU passthrough because inference runs in host Ollama. Start Ollama before uploading documents.

Change `CHAT_MODEL`, `EMBEDDING_MODEL`, `CHUNK_SIZE`, and `CHUNK_OVERLAP` in `.env` before starting. The default embedding model returns 768-dimensional vectors. Another embedding model must return the same dimension. Reprocess existing documents after changing models.

## Local development

```sh
uv run python scripts/setup.py
docker compose up -d database redis
uv sync --frozen
uv run alembic upgrade head
uv run python -m workers.main
```

In a second terminal run `uv run uvicorn localdocs.main:app --app-dir apps/api --port 8008`. In another run `cd apps/web && npm ci && npm run dev`. Visit `http://localhost:5178`.

If another local Docker project has consumed the default subnet pool, the ignored `docker-compose.override.yml` selects a local bridge subnet. Change it if the subnet overlaps a VPN or LAN route. Do not commit `.env` or the override file.

## Example corpus

Run `uv run python scripts/seed.py` to create a sample collection and send three synthetic Markdown documents through the normal extraction and embedding pipeline.
