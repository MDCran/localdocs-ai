# Architecture

The web client talks to a versioned FastAPI API. Uploaded files are validated and stored under generated identifiers before a durable PostgreSQL job is created. Redis is a wakeup signal; PostgreSQL holds the queue. Workers can recover queued jobs when a wakeup is missed or a process restarts. A lease token prevents a worker that lost its claim from saving stale vectors. Extraction runs in a bounded child process; embedding and indexing run in retryable stages.

## System boundaries

```mermaid
flowchart LR
  Browser[React and Vite] -->|HTTP, multipart, SSE| API[FastAPI]
  API --> DB[(PostgreSQL and pgvector)]
  API --> FS[(Local document files)]
  API -. Durable job state .-> DB
  API -. Best effort wakeup .-> Redis[(Redis)]
  Redis -. Wakeup .-> Worker[Async ingestion worker]
  DB -. Poll and claim .-> Worker
  Worker --> Parser[Time limited parser process]
  Parser --> FS
  Worker -->|Local embeddings| Ollama[Host Ollama]
  API -->|Local generation and query embedding| Ollama
  Worker -->|Chunks and vectors| DB
```

## Upload and ingestion

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant F as Local files
  participant D as PostgreSQL
  participant R as Redis
  participant W as Worker
  participant O as Ollama
  U->>A: Upload document and collection
  A->>F: Write generated ID file with a size limit
  A->>A: Validate type and checksum
  A->>D: Insert document and queued job
  A-->>R: Publish a best effort wakeup
  W->>D: Claim job with lease and fencing token
  W->>F: Read stored file
  W->>W: Extract pages in bounded child process
  W->>W: Clean, section, and chunk text
  loop Groups of 16 chunks
    W->>O: Local embedding request
    O-->>W: Finite 768-value vectors
  end
  W->>D: Save chunks, model metadata, and vectors atomically
  D-->>U: Document status becomes ready
```

## Retrieval and generation

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant D as PostgreSQL and pgvector
  participant O as Ollama
  B->>A: Question and collection filter
  A->>O: Embed the current question
  O-->>A: Query vector
  par Semantic ranking
    A->>D: Cosine search within ready collection
  and Keyword ranking
    A->>D: PostgreSQL full text search
  end
  A->>A: Fuse ranks, deduplicate, and assemble bounded evidence
  A-->>B: Retrieval timings and source passages
  A->>O: Stream question, bounded history, and quoted evidence
  O-->>A: Answer text with candidate source IDs
  A->>A: Check each citation against supplied sources
  A->>D: Persist answer and citation snapshots
  A-->>B: Stream completion with valid citations
```

## Database relationships

```mermaid
erDiagram
  COLLECTIONS ||--o{ DOCUMENTS : holds
  COLLECTIONS ||--o{ CONVERSATIONS : scopes
  DOCUMENTS ||--o{ DOCUMENT_CHUNKS : yields
  DOCUMENT_CHUNKS ||--o| EMBEDDINGS : embeds
  DOCUMENTS ||--o{ INGESTION_JOBS : processes
  CONVERSATIONS ||--o{ MESSAGES : contains
  MESSAGES ||--o{ MESSAGE_CITATIONS : cites
  DOCUMENT_CHUNKS o|--o{ MESSAGE_CITATIONS : snapshots
```

The embedding column is fixed at 768 dimensions. Model name and dimension are stored with each vector and checked before retrieval. HNSW cosine indexing accelerates semantic search; a GIN full text index supports keyword search. Hybrid ranking uses reciprocal rank fusion. Neither semantic scores nor fused ranking scores are probabilities of answer correctness.

## Decisions and tradeoffs

- PostgreSQL stores application metadata, the durable job queue, full text search, and vectors. A single indexed store simplifies local setup and collection filtering.
- Redis avoids busy polling without becoming a second source of truth.
- The current question is embedded without rewriting it from conversation history. Recent turns help the model interpret follow ups; they do not become retrieval evidence.
- History is limited to eight recent turns and passages to a conservative UTF 8 byte estimate. Model tokenization varies, so this estimate is a ceiling aid rather than an exact token count.
- Local reranking is deferred until a reproducible corpus shows a useful quality benefit.
- HNSW approximate search trades a small amount of recall for lower latency at scale. Iterative scans recover additional qualifying rows after collection filters.
- There is no OCR. Image only PDFs fail with a clear OCR required status.
- DOCX text includes paragraphs and tables, but visual layout, images, page numbers, and reading order across complex columns are not preserved.
- Conversation ownership is local single user. Authentication and multitenancy are outside the current threat model.
