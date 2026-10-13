from datetime import timedelta

import pytest
from localdocs.db import Session
from localdocs.jobs import claim_job, document_path, process_job
from localdocs.models import Chunk, Document, Embedding, Job, now
from sqlalchemy import func, select

pytestmark = pytest.mark.integration


async def create_collection(client, name="Handbook"):
    response = await client.post("/api/v1/collections", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


async def upload(client, collection_id, content=b"# Archive\n\nRetention is 30 days."):
    response = await client.post(
        "/api/v1/documents",
        data={"collection_id": collection_id},
        files={"file": ("guide.md", content, "text/markdown")},
    )
    assert response.status_code == 202, response.text
    return response.json()


async def run_one():
    claimed = await claim_job()
    assert claimed
    await process_job(*claimed)


async def test_ingestion_search_chat_citations_export_and_delete(client, fake_ai):
    collection_id = await create_collection(client)
    uploaded = await upload(client, collection_id)
    document_id = uploaded["document"]["id"]
    await run_one()
    document = (await client.get(f"/api/v1/documents/{document_id}")).json()
    assert document["status"] == "ready" and document["chunk_count"] == 1
    result = (
        await client.post(
            "/api/v1/retrieval/search", json={"query": "retention", "collection_id": collection_id}
        )
    ).json()
    assert result["sources"][0]["document_id"] == document_id
    assert "30 days" in result["sources"][0]["text"]
    chat = (
        await client.post("/api/v1/conversations", json={"collection_id": collection_id})
    ).json()
    response = await client.post(
        f"/api/v1/conversations/{chat['id']}/messages", json={"content": "What is retention?"}
    )
    assert "event: done" in response.text
    persisted = (await client.get(f"/api/v1/conversations/{chat['id']}")).json()
    assert len(persisted["messages"]) == 2
    citation = persisted["messages"][1]["citations"][0]
    assert citation["chunk_id"] == result["sources"][0]["chunk_id"]
    assert "30 days" in citation["text"]
    exported = await client.get(f"/api/v1/conversations/{chat['id']}/export")
    assert "guide.md" in exported.text
    await client.delete(f"/api/v1/documents/{document_id}")
    await run_one()
    assert (await client.get(f"/api/v1/documents/{document_id}")).status_code == 404
    assert not document_path(document_id, ".md").exists()
    async with Session() as session:
        assert await session.scalar(select(func.count()).select_from(Chunk)) == 0
        assert await session.scalar(select(func.count()).select_from(Embedding)) == 0
    persisted = (await client.get(f"/api/v1/conversations/{chat['id']}")).json()
    assert persisted["messages"][1]["citations"][0]["available"] is False


async def test_duplicates_and_collection_isolation(client, fake_ai):
    first = await create_collection(client, "First")
    second = await create_collection(client, "Second")
    await upload(client, first)
    duplicate = await client.post(
        "/api/v1/documents",
        data={"collection_id": first},
        files={"file": ("different.md", b"# Archive\n\nRetention is 30 days.")},
    )
    assert duplicate.status_code == 409
    await run_one()
    result = (
        await client.post(
            "/api/v1/retrieval/search", json={"query": "retention", "collection_id": second}
        )
    ).json()
    assert result["sources"] == []
    await upload(client, second)


async def test_unanswerable_empty_collection_does_not_invoke_llm(client, monkeypatch, fake_ai):
    async def forbidden(*args):
        raise AssertionError("No evidence must skip generation")
        yield ""

    monkeypatch.setattr(fake_ai, "stream", forbidden)
    collection = await create_collection(client)
    chat = (await client.post("/api/v1/conversations", json={"collection_id": collection})).json()
    response = await client.post(
        f"/api/v1/conversations/{chat['id']}/messages", json={"content": "What is the moon's mass?"}
    )
    assert "event: done" in response.text and "enough evidence" in response.text


async def test_expired_worker_lease_can_be_reclaimed(client, fake_ai):
    collection = await create_collection(client)
    result = await upload(client, collection)
    first = await claim_job()
    assert first
    async with Session() as session, session.begin():
        job = await session.get(Job, first[0])
        job.lease_until = now() - timedelta(seconds=1)
    second = await claim_job()
    assert second and second[0] == first[0] and second[1] != first[1]
    await process_job(*first)
    await process_job(*second)
    document = (await client.get(f"/api/v1/documents/{result['document']['id']}")).json()
    assert document["status"] == "ready"


async def test_invalid_files_and_cross_origin_writes(client):
    collection = await create_collection(client)
    for name, data in [("evil.exe", b"MZ"), ("fake.pdf", b"not pdf"), ("binary.txt", b"\x00data")]:
        response = await client.post(
            "/api/v1/documents", data={"collection_id": collection}, files={"file": (name, data)}
        )
        assert response.status_code in {415, 422}
    assert (await client.get("/api/v1/documents")).json()["total"] == 0
    forbidden = await client.post(
        "/api/v1/collections", json={"name": "Injected"}, headers={"Origin": "https://evil.example"}
    )
    assert forbidden.status_code == 403


async def test_reprocess_replaces_vectors_and_collection_delete_cleans_files(client, fake_ai):
    collection = await create_collection(client)
    uploaded = await upload(client, collection)
    await run_one()
    doc_id = uploaded["document"]["id"]
    assert (await client.post(f"/api/v1/documents/{doc_id}/reprocess")).status_code == 202
    assert (await client.post(f"/api/v1/documents/{doc_id}/reprocess")).status_code == 409
    await run_one()
    async with Session() as session:
        assert await session.scalar(select(func.count()).select_from(Embedding)) == 1
    await client.delete(f"/api/v1/collections/{collection}")
    await run_one()
    assert (await client.get(f"/api/v1/collections/{collection}")).status_code == 404
    assert not document_path(doc_id, ".md").exists()


async def test_model_failure_is_visible_and_retries_are_bounded(client, monkeypatch, fake_ai):
    async def broken(texts):
        raise ConnectionError("offline")

    monkeypatch.setattr(fake_ai, "embed", broken)
    collection = await create_collection(client)
    uploaded = await upload(client, collection)
    for attempt in range(3):
        await run_one()
        async with Session() as session, session.begin():
            job = await session.get(Job, uploaded["job"]["id"])
            job.next_attempt = now() - timedelta(seconds=1)
            assert job.attempts == attempt + 1
    async with Session() as session:
        job = await session.get(Job, uploaded["job"]["id"])
        assert job.status == "failed"
        doc = await session.get(Document, uploaded["document"]["id"])
        assert doc.status == "failed" and doc.error
