import asyncio
import hashlib
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from redis.asyncio import Redis
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.trustedhost import TrustedHostMiddleware

from localdocs.ai import ai
from localdocs.config import get_settings
from localdocs.conversations import event, prepare, stream_answer
from localdocs.db import Session, engine, get_session
from localdocs.ingestion import DocumentError, safe_filename, validate_file
from localdocs.jobs import document_path, notify_worker, queue_deletion
from localdocs.logging import configure_logging
from localdocs.models import (
    AppSetting,
    Chunk,
    Citation,
    Collection,
    Conversation,
    Document,
    Job,
    Message,
    new_id,
)
from localdocs.retrieval import search
from localdocs.runtime import read_runtime
from localdocs.schemas import (
    CollectionInput,
    ConversationInput,
    MessageInput,
    RuntimeSettings,
    SearchInput,
    TitleInput,
)

settings = get_settings()
logger = logging.getLogger("localdocs.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield
    await engine.dispose()


app = FastAPI(
    title="LocalDocs AI",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
requests_total = 0
errors_total = 0
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "api", "testserver"]
)


@app.middleware("http")
async def request_context(request: Request, call_next: Any) -> Response:
    global requests_total, errors_total
    request_id = new_id()
    started = time.perf_counter()
    requests_total += 1
    if request.method in {"POST", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if (
            origin
            and origin not in settings.cors_origins
            and origin
            not in {
                f"http://{request.headers.get('host')}",
                f"https://{request.headers.get('host')}",
            }
        ):
            return JSONResponse(
                {"error": {"code": "forbidden_origin", "message": "Request origin is not allowed"}},
                status_code=403,
            )
        if request.url.path.endswith("/messages") or request.url.path.endswith("/documents"):
            try:
                async with Redis.from_url(settings.redis_url) as redis:
                    key = f"rate:{request.client.host if request.client else 'local'}:{request.url.path.rsplit('/', 1)[-1]}"
                    count = await redis.incr(key)
                    if count == 1:
                        await redis.expire(key, 60)
                    if count > 30:
                        return JSONResponse(
                            {
                                "error": {
                                    "code": "rate_limit",
                                    "message": "Too many requests. Try again in a minute.",
                                }
                            },
                            status_code=429,
                        )
            except Exception:
                pass
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    errors_total += int(response.status_code >= 500)
    logger.info(
        "request",
        extra={
            "request_id": request_id,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        },
    )
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": str(exc.status_code), "message": exc.detail}},
        status_code=exc.status_code,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        {
            "error": {
                "code": "validation",
                "message": "Invalid request",
                "fields": [{"location": list(e["loc"]), "message": e["msg"]} for e in exc.errors()],
            }
        },
        status_code=422,
    )


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    logger.error("request_failed")
    return JSONResponse(
        {"error": {"code": "internal", "message": "An internal operation failed"}}, status_code=500
    )


def serialize(row: Any) -> dict[str, Any]:
    return jsonable_encoder(
        {column.key: getattr(row, column.key) for column in inspect(type(row)).column_attrs}
    )  # type: ignore[no-any-return]


async def require(session: AsyncSession, model: Any, key: str) -> Any:
    row = await session.get(model, key)
    if row is None:
        raise HTTPException(404, "Resource not found")
    return row


async def writable_collection(session: AsyncSession, key: str) -> Collection:
    collection = await session.get(Collection, key, with_for_update=True)
    if not collection:
        raise HTTPException(404, "Collection not found")
    if collection.deleting:
        raise HTTPException(409, "Collection is being deleted")
    return collection


async def page_rows(
    session: AsyncSession, statement: Any, offset: int, limit: int
) -> dict[str, Any]:
    total = await session.scalar(
        select(func.count()).select_from(statement.order_by(None).subquery())
    )
    rows = (await session.scalars(statement.offset(offset).limit(limit))).all()
    return {
        "items": [serialize(row) for row in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@app.get("/api/v1/health", tags=["health"])
async def health() -> dict[str, Any]:
    components: dict[str, Any] = {}
    try:
        async with Session() as session:
            await session.execute(text("SELECT 1 FROM application_settings LIMIT 1"))
        components["database"] = "ready"
    except Exception:
        components["database"] = "unavailable"
    try:
        async with Redis.from_url(settings.redis_url) as redis:
            await redis.ping()
        components["redis"] = "ready"
    except Exception:
        components["redis"] = "unavailable"
    try:
        models = await ai.models()
        names = {m["name"] for m in models}
        components["ollama"] = "ready"
        components["embedding_model"] = (
            "ready"
            if settings.embedding_model in names or f"{settings.embedding_model}:latest" in names
            else "missing"
        )
    except Exception:
        components["ollama"], components["embedding_model"] = "unavailable", "unavailable"
    return {
        "status": "ready" if all(v == "ready" for v in components.values()) else "degraded",
        "components": components,
        "version": "0.1.0",
    }


@app.get("/api/v1/ready", tags=["health"])
async def ready(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await session.execute(text("SELECT 1 FROM application_settings LIMIT 1"))
    return {"status": "ready"}


@app.get("/api/v1/metrics", tags=["metrics"])
async def metrics(session: AsyncSession = Depends(get_session)) -> Response:
    pending = await session.scalar(
        select(func.count()).select_from(Job).where(Job.status.in_(["queued", "processing"]))
    )
    return Response(
        f"# TYPE localdocs_http_requests_total counter\nlocaldocs_http_requests_total {requests_total}\n# TYPE localdocs_http_errors_total counter\nlocaldocs_http_errors_total {errors_total}\n# TYPE localdocs_pending_jobs gauge\nlocaldocs_pending_jobs {pending}\n",
        media_type="text/plain",
    )


@app.get("/api/v1/models", tags=["settings"])
async def models() -> dict[str, Any]:
    try:
        return {
            "items": await ai.models(),
            "embedding_model": ai.model,
            "dimensions": ai.dimensions,
        }
    except Exception as exc:
        raise HTTPException(503, "Ollama is unavailable") from exc


@app.get("/api/v1/settings", response_model=RuntimeSettings, tags=["settings"])
async def get_runtime(session: AsyncSession = Depends(get_session)) -> RuntimeSettings:
    return await read_runtime(session)


@app.patch("/api/v1/settings", response_model=RuntimeSettings, tags=["settings"])
async def patch_runtime(
    body: RuntimeSettings, session: AsyncSession = Depends(get_session)
) -> RuntimeSettings:
    row = await session.get(AppSetting, "runtime")
    if row:
        row.value = body.model_dump()
    else:
        session.add(AppSetting(key="runtime", value=body.model_dump()))
    await session.commit()
    return body


@app.get("/api/v1/collections", tags=["collections"])
async def list_collections(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return await page_rows(
        session, select(Collection).order_by(Collection.created_at.desc()), offset, limit
    )


@app.post("/api/v1/collections", status_code=201, tags=["collections"])
async def create_collection(
    body: CollectionInput, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    row = Collection(**body.model_dump())
    session.add(row)
    await session.commit()
    return serialize(row)


@app.get("/api/v1/collections/{collection_id}", tags=["collections"])
async def get_collection(
    collection_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    return serialize(await require(session, Collection, collection_id))


@app.patch("/api/v1/collections/{collection_id}", tags=["collections"])
async def update_collection(
    collection_id: str, body: CollectionInput, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    row = await writable_collection(session, collection_id)
    row.name, row.description = body.name, body.description
    await session.commit()
    return serialize(row)


@app.delete("/api/v1/collections/{collection_id}", status_code=202, tags=["collections"])
async def remove_collection(
    collection_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    collection = await require(session, Collection, collection_id)
    collection.deleting = True
    documents = (
        await session.scalars(
            select(Document).where(Document.collection_id == collection_id).with_for_update()
        )
    ).all()
    jobs = [await queue_deletion(session, document) for document in documents]
    if not documents:
        await session.delete(collection)
    await session.commit()
    for job in jobs:
        await notify_worker(job.id)
    return {"status": "deleting"}


@app.get("/api/v1/documents", tags=["documents"])
async def list_documents(
    collection_id: str | None = None,
    q: str = Query("", max_length=200),
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    statement = select(Document).order_by(Document.created_at.desc())
    if collection_id:
        statement = statement.where(Document.collection_id == collection_id)
    if q:
        statement = statement.where(Document.filename.ilike(f"%{q}%"))
    if status:
        statement = statement.where(Document.status == status)
    return await page_rows(session, statement, offset, limit)


@app.post("/api/v1/documents", status_code=202, tags=["documents"])
async def upload_document(
    collection_id: str = Form(...),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await writable_collection(session, collection_id)
    filename = safe_filename(file.filename or "document")
    extension = Path(filename).suffix.lower()
    if extension not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(415, "Supported formats are PDF, DOCX, TXT, and Markdown")
    document_id = new_id()
    path = document_path(document_id, extension)
    path.parent.mkdir(parents=True, exist_ok=True)
    size, checksum = 0, hashlib.sha256()
    try:
        with path.open("xb") as handle:
            while data := await file.read(65536):
                size += len(data)
                if size > settings.max_upload_mb * 1024 * 1024:
                    raise HTTPException(413, f"Maximum upload size is {settings.max_upload_mb} MB")
                checksum.update(data)
                handle.write(data)
        await asyncio.to_thread(validate_file, path, extension)
        document = Document(
            id=document_id,
            collection_id=collection_id,
            filename=filename,
            extension=extension,
            size_bytes=size,
            checksum=checksum.hexdigest(),
        )
        session.add(document)
        await session.flush()
        job = Job(document_id=document_id)
        session.add(job)
        await session.commit()
    except DocumentError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise HTTPException(409, "This document already exists in the collection") from exc
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    await notify_worker(job.id)
    return {"document": serialize(document), "job": serialize(job)}


@app.get("/api/v1/documents/{document_id}", tags=["documents"])
async def get_document(
    document_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    return serialize(await require(session, Document, document_id))


@app.get("/api/v1/documents/{document_id}/file", tags=["documents"])
async def get_document_file(
    document_id: str, session: AsyncSession = Depends(get_session)
) -> FileResponse:
    document = await require(session, Document, document_id)
    path = document_path(document.id, document.extension)
    if not path.is_file():
        raise HTTPException(404, "Source file is no longer available")
    return FileResponse(
        path,
        filename=document.filename,
        media_type="application/pdf"
        if document.extension == ".pdf"
        else "application/octet-stream",
        content_disposition_type="inline" if document.extension == ".pdf" else "attachment",
    )


@app.get("/api/v1/documents/{document_id}/chunks", tags=["documents"])
async def get_chunks(
    document_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await require(session, Document, document_id)
    return await page_rows(
        session,
        select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.ordinal),
        offset,
        limit,
    )


@app.post("/api/v1/documents/{document_id}/reprocess", status_code=202, tags=["documents"])
async def reprocess(
    document_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    document = await session.get(Document, document_id, with_for_update=True)
    if not document:
        raise HTTPException(404, "Document not found")
    if document.status == "deleting":
        raise HTTPException(409, "Document is being deleted")
    if await session.scalar(
        select(Job.id)
        .where(Job.document_id == document_id, Job.status.in_(["queued", "processing"]))
        .limit(1)
    ):
        raise HTTPException(409, "Document is already being processed")
    document.status, document.error = "queued", None
    job = Job(document_id=document_id)
    session.add(job)
    await session.commit()
    await notify_worker(job.id)
    return serialize(job)


@app.delete("/api/v1/documents/{document_id}", status_code=202, tags=["documents"])
async def remove_document(
    document_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    document = await session.get(Document, document_id, with_for_update=True)
    if not document:
        raise HTTPException(404, "Document not found")
    job = await queue_deletion(session, document)
    await session.commit()
    await notify_worker(job.id)
    return {"status": "deleting", "job_id": job.id}


@app.get("/api/v1/jobs", tags=["jobs"])
async def list_jobs(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return await page_rows(session, select(Job).order_by(Job.created_at.desc()), offset, limit)


@app.get("/api/v1/jobs/{job_id}", tags=["jobs"])
async def get_job(job_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return serialize(await require(session, Job, job_id))


@app.get("/api/v1/jobs/{job_id}/events", tags=["jobs"])
async def job_events(job_id: str) -> StreamingResponse:
    async def updates() -> AsyncIterator[str]:
        for _ in range(300):
            async with Session() as session:
                job = await session.get(Job, job_id)
                if not job:
                    yield event("removed", {})
                    return
                yield event("progress", serialize(job))
                if job.status in {"complete", "failed"}:
                    return
            await asyncio.sleep(1)

    return StreamingResponse(
        updates(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/v1/retrieval/search", tags=["retrieval"])
@app.post("/api/v1/retrieval/debug", tags=["retrieval"])
async def retrieve(
    body: SearchInput, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await writable_collection(session, body.collection_id)
    try:
        sources, diagnostics = await search(session, body)
    except Exception as exc:
        raise HTTPException(
            503, "Retrieval failed. Check the embedding model and database."
        ) from exc
    return {"sources": [s.model_dump() for s in sources], "diagnostics": diagnostics}


@app.get("/api/v1/conversations", tags=["conversations"])
async def list_conversations(
    collection_id: str | None = None,
    q: str = Query("", max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    statement = select(Conversation).order_by(Conversation.updated_at.desc())
    if collection_id:
        statement = statement.where(Conversation.collection_id == collection_id)
    if q:
        matching = select(Message.conversation_id).where(Message.content.ilike(f"%{q}%"))
        statement = statement.where(
            Conversation.title.ilike(f"%{q}%") | Conversation.id.in_(matching)
        )
    return await page_rows(session, statement, offset, limit)


@app.post("/api/v1/conversations", status_code=201, tags=["conversations"])
async def create_conversation(
    body: ConversationInput, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await writable_collection(session, body.collection_id)
    row = Conversation(**body.model_dump())
    session.add(row)
    await session.commit()
    return serialize(row)


@app.get("/api/v1/conversations/{conversation_id}", tags=["conversations"])
async def get_conversation(
    conversation_id: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    conversation = await require(session, Conversation, conversation_id)
    messages = (
        await session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at, Message.id)
        )
    ).all()
    result = serialize(conversation)
    result["messages"] = []
    for message in messages:
        item = serialize(message)
        citations = (
            await session.scalars(
                select(Citation)
                .where(Citation.message_id == message.id)
                .order_by(Citation.source_id)
            )
        ).all()
        item["citations"] = [c.snapshot | {"available": c.chunk_id is not None} for c in citations]
        result["messages"].append(item)
    return result


@app.patch("/api/v1/conversations/{conversation_id}", tags=["conversations"])
async def rename_conversation(
    conversation_id: str, body: TitleInput, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    row = await require(session, Conversation, conversation_id)
    row.title = body.title
    await session.commit()
    return serialize(row)


@app.delete("/api/v1/conversations/{conversation_id}", status_code=204, tags=["conversations"])
async def remove_conversation(
    conversation_id: str, session: AsyncSession = Depends(get_session)
) -> Response:
    row = await require(session, Conversation, conversation_id)
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@app.post("/api/v1/conversations/{conversation_id}/messages", tags=["conversations"])
async def send_message(conversation_id: str, body: MessageInput) -> StreamingResponse:
    request_id, message_id, question = await prepare(conversation_id, body)
    return StreamingResponse(
        stream_answer(conversation_id, request_id, message_id, question, body.document_ids),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/v1/conversations/{conversation_id}/export", tags=["conversations"])
async def export_conversation(
    conversation_id: str,
    format: str = Query("markdown", pattern="^(markdown|json)$"),
    session: AsyncSession = Depends(get_session),
) -> Response:
    conversation = await get_conversation(conversation_id, session)
    if format == "json":
        return JSONResponse(
            conversation,
            headers={"Content-Disposition": 'attachment; filename="conversation.json"'},
        )
    lines = [f"# {conversation['title']}", ""]
    for message in conversation["messages"]:
        lines.extend([f"## {message['role'].title()}", "", message["content"], ""])
        for citation in message["citations"]:
            lines.append(
                f"[{citation['source_id']}] {citation['document_title']}"
                + (f", page {citation['page']}" if citation["page"] else "")
                + f"\n\n> {citation['text']}\n"
            )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="conversation.md"'},
    )
