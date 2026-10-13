# Troubleshooting

**The model list is empty.** Start Ollama, then run `ollama pull nomic-embed-text` and `ollama pull llama3.2:3b`. In Docker, check `DOCKER_OLLAMA_BASE_URL` and host firewall rules for Docker Desktop's host gateway.

**The upload stays queued.** Open Processing queue and check PostgreSQL, Redis, and worker health. PostgreSQL keeps queued jobs if Redis stops; workers resume them when services return. A worker retries transient failures up to three times.

**Embedding fails.** Confirm the embedding model is available and returns 768 dimensions. Check model status on Settings. After repairing Ollama, reprocess the document. Existing vectors remain usable until the replacement chunks commit.

**No source passages appear.** Choose a ready collection and inspect Retrieval insights for the same question. Adjust the relevance threshold in Settings if an expected passage appears below the gate. Ranking scores are not probabilities.

**A scanned PDF has no text.** It needs OCR, which is not included. Add a trusted OCR text layer before upload.

**Compose cannot reserve a network range.** Compose uses an ignored local override file to pick a private bridge subnet. Change it if it overlaps your VPN or LAN.

**The interface is on another port.** Vite uses strict port 5178 and Compose defaults to port 5178. Change `WEB_PORT` for Compose and the CORS origin in local settings when the port is occupied.

**A migration fails.** Inspect migration output and database logs before retrying `uv run alembic upgrade head`. The local database is persistent; `docker compose down -v` removes it and all uploaded files.
