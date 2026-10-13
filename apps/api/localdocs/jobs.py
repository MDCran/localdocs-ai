import asyncio
import contextlib
from datetime import timedelta
from pathlib import Path

import httpx
from redis.asyncio import Redis
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from localdocs.ai import ai
from localdocs.config import get_settings
from localdocs.db import Session
from localdocs.ingestion import DocumentError, chunk_pages, extract_isolated
from localdocs.models import Chunk, Collection, Document, Embedding, Job, new_id, now


class LeaseLost(Exception):
    pass


def document_path(document_id: str, extension: str) -> Path:
    return get_settings().upload_dir / f"{document_id}{extension}"


async def notify_worker(job_id: str) -> None:
    try:
        async with Redis.from_url(get_settings().redis_url) as redis:
            await redis.lpush("localdocs:wake", job_id)
            await redis.ltrim("localdocs:wake", 0, 999)
    except Exception:
        # PostgreSQL owns job state; missed wakeups are recovered by polling.
        pass


async def claim_job() -> tuple[str, str] | None:
    settings = get_settings()
    async with Session() as session, session.begin():
        job = await session.scalar(
            select(Job)
            .where(
                or_(
                    (Job.status == "queued") & (Job.next_attempt <= now()),
                    (Job.status == "processing") & (Job.lease_until < now()),
                )
            )
            .order_by(Job.created_at)
            .limit(1)
        )
        if not job:
            return None
        document = await session.scalar(
            select(Document).where(Document.id == job.document_id).with_for_update(skip_locked=True)
        )
        if not document:
            return None
        job = await session.scalar(
            select(Job)
            .where(Job.id == job.id)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        if (
            not job
            or (job.status == "processing" and job.lease_until and job.lease_until >= now())
            or job.status not in {"queued", "processing"}
        ):
            return None
        if job.attempts >= settings.max_job_attempts:
            job.status, job.error = "failed", "Retry limit reached after a worker interruption"
            document.status, document.error = "failed", job.error
            return None
        job.status = "processing"
        job.attempts += 1
        job.lease_token = new_id()
        job.lease_until = now() + timedelta(seconds=settings.lease_seconds)
        job.error = None
        return job.id, job.lease_token


async def update_progress(job_id: str, token: str, stage: str, progress: int) -> None:
    async with Session() as session, session.begin():
        document_id = await session.scalar(select(Job.document_id).where(Job.id == job_id))
        if not document_id:
            raise LeaseLost()
        document = await session.get(Document, document_id, with_for_update=True)
        job = await session.get(Job, job_id, with_for_update=True)
        if not job or job.lease_token != token or job.status != "processing":
            raise LeaseLost()
        job.stage, job.progress = stage, progress
        job.lease_until = now() + timedelta(seconds=get_settings().lease_seconds)
        if document and job.operation == "ingest" and document.status != "deleting":
            document.status = stage


async def heartbeat(job_id: str, token: str) -> None:
    while True:
        await asyncio.sleep(20)
        async with Session() as session, session.begin():
            job = await session.get(Job, job_id, with_for_update=True)
            if not job or job.lease_token != token or job.status != "processing":
                return
            job.lease_until = now() + timedelta(seconds=get_settings().lease_seconds)


async def ingest(job_id: str, token: str) -> None:
    settings = get_settings()
    async with Session() as session:
        job = await session.get(Job, job_id)
        if not job:
            raise LeaseLost()
        document = await session.get(Document, job.document_id)
        if not document:
            raise LeaseLost()
        document_id, extension = document.id, document.extension
    await update_progress(job_id, token, "extracting", 10)
    pages = await asyncio.to_thread(
        extract_isolated, document_path(document_id, extension), extension
    )
    await update_progress(job_id, token, "chunking", 30)
    chunks = chunk_pages(pages, settings.chunk_size, settings.chunk_overlap)
    vectors: list[list[float]] = []
    for start in range(0, len(chunks), 16):
        await update_progress(
            job_id, token, "embedding", 35 + int(55 * start / max(1, len(chunks)))
        )
        vectors.extend(await ai.embed([c.text for c in chunks[start : start + 16]]))
    await update_progress(job_id, token, "indexing", 95)
    async with Session() as session, session.begin():
        document = await session.get(Document, document_id, with_for_update=True)
        job = await session.get(Job, job_id, with_for_update=True)
        if (
            not job
            or job.lease_token != token
            or job.status != "processing"
            or not document
            or document.status == "deleting"
        ):
            raise LeaseLost()
        await session.execute(delete(Chunk).where(Chunk.document_id == document_id))
        for ordinal, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
            chunk_id = new_id()
            session.add(
                Chunk(
                    id=chunk_id,
                    document_id=document_id,
                    ordinal=ordinal,
                    page=chunk.page,
                    text=chunk.text,
                    metadata_={"heading": chunk.heading},
                )
            )
            await session.flush()
            session.add(
                Embedding(
                    chunk_id=chunk_id, model=ai.model, dimensions=ai.dimensions, vector=vector
                )
            )
        document.status, document.error = "ready", None
        document.page_count, document.chunk_count = len(pages), len(chunks)
        job.status, job.stage, job.progress = "complete", "ready", 100
        job.lease_until, job.lease_token = None, None


async def delete_document(job_id: str, token: str) -> None:
    async with Session() as session, session.begin():
        job = await session.get(Job, job_id)
        if not job:
            raise LeaseLost()
        document = await session.get(Document, job.document_id, with_for_update=True)
        job = await session.get(Job, job_id, with_for_update=True)
        if not document or not job or job.lease_token != token:
            raise LeaseLost()
        collection_id = document.collection_id
        await asyncio.to_thread(
            document_path(document.id, document.extension).unlink, missing_ok=True
        )
        await session.delete(document)
        await session.flush()
    async with Session() as session, session.begin():
        collection = await session.get(Collection, collection_id, with_for_update=True)
        if (
            collection
            and collection.deleting
            and not await session.scalar(
                select(Document.id).where(Document.collection_id == collection_id).limit(1)
            )
        ):
            await session.delete(collection)


async def process_job(job_id: str, token: str) -> None:
    pulse = asyncio.create_task(heartbeat(job_id, token))
    try:
        async with Session() as session:
            job = await session.get(Job, job_id)
            operation = job.operation if job else None
        if operation == "delete":
            await delete_document(job_id, token)
        elif operation == "ingest":
            await ingest(job_id, token)
    except LeaseLost:
        pass
    except Exception as exc:
        transient = isinstance(exc, httpx.TransportError | TimeoutError | ConnectionError) or (
            isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500
        )
        async with Session() as session, session.begin():
            job = await session.get(Job, job_id, with_for_update=True)
            if job and job.lease_token == token:
                retry = transient and job.attempts < get_settings().max_job_attempts
                job.status = "queued" if retry else "failed"
                job.error = (
                    str(exc)
                    if isinstance(exc, DocumentError)
                    else "Local model or storage operation failed. Check service health and retry."
                )
                job.next_attempt = now() + timedelta(seconds=2**job.attempts * 5)
                job.lease_token, job.lease_until = None, None
                document = await session.get(Document, job.document_id)
                if document:
                    document.status = "queued" if retry else "failed"
                    document.error = job.error
    finally:
        pulse.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pulse


async def queue_deletion(session: AsyncSession, document: Document) -> Job:
    await session.execute(delete(Job).where(Job.document_id == document.id))
    document.status = "deleting"
    job = Job(document_id=document.id, operation="delete")
    session.add(job)
    await session.flush()
    return job
