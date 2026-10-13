# API reference

Start the API and open [`/api/docs`](http://localhost:8008/api/docs) for the interactive OpenAPI reference. The machine readable schema is available at `/api/openapi.json`.

All routes use the `/api/v1` prefix. Errors include a stable code and concise message; validation errors include field locations. Lists use bounded offset pagination. Uploads use `multipart/form-data`; answer and job progress use Server Sent Events.

| Area | Routes |
| --- | --- |
| Service | `GET /health`, `GET /ready`, `GET /metrics` |
| Collections | `GET, POST /collections`, `GET, PATCH, DELETE /collections/{id}` |
| Documents | `GET, POST /documents`, `GET, DELETE /documents/{id}`, `GET /documents/{id}/file`, `GET /documents/{id}/chunks`, `POST /documents/{id}/reprocess` |
| Jobs | `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/events` |
| Retrieval | `POST /retrieval/search`, `POST /retrieval/debug` |
| Conversations | `GET, POST /conversations`, `GET, PATCH, DELETE /conversations/{id}`, `POST /conversations/{id}/messages`, `GET /conversations/{id}/export` |
| Settings | `GET, PATCH /settings`, `GET /models` |
