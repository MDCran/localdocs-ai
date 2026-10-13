# Data model

- `collections` sets ownership and search scope. A delete first marks the collection, blocks new work, and queues file cleanup for each document.
- `documents` records the sanitized display name, generated file identifier, checksum, size, status, and processing error. The collection and checksum pair is unique.
- `document_chunks` stores ordered source passages, optional PDF page numbers, and structure metadata. Deleting a document cascades to its passages and embeddings.
- `embeddings` stores a 768 dimension pgvector value with model name and dimensionality. HNSW uses cosine distance; model and dimension filters avoid comparing incompatible embeddings.
- `ingestion_jobs` stores durable stage, progress, attempts, error, lease deadline, and fencing token. PostgreSQL transactions make each status and index replacement atomic.
- `conversations` belongs to one collection and uses an expiring request lease to prevent overlapping streamed answers.
- `messages` stores each question, answer, completion state, and retrieval diagnostics.
- `message_citations` snapshots the chunk, document name, excerpt, and page at answer time. Deleting a document clears the live chunk reference while retaining the citation snapshot in chat history.
- `application_settings` stores the local generation and retrieval preferences as versioned JSON fields.

Schema changes are versioned in `apps/api/migrations/versions`. Run `uv run alembic upgrade head` before starting the API. Run `uv run alembic downgrade base` only in a disposable development database.
