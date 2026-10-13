"""Exercise a real PDF, local embeddings, streaming, and source deletion."""

import argparse
import io
import time

import httpx
from evaluate import parse_sse
from reportlab.pdfgen import canvas

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://localhost:8008")
args = parser.parse_args()
pdf_buffer = io.BytesIO()
pdf = canvas.Canvas(pdf_buffer)
pdf.drawString(72, 700, "The Meridian archive retention period is 45 days.")
pdf.showPage()
pdf.drawString(72, 700, "The Meridian deployment observation window is 20 minutes.")
pdf.save()
with httpx.Client(base_url=args.url, timeout=360) as client:
    created = client.post("/api/v1/collections", json={"name": "PDF verification"})
    created.raise_for_status()
    collection_id = created.json()["id"]
    try:
        uploaded = client.post(
            "/api/v1/documents",
            data={"collection_id": collection_id},
            files={"file": ("meridian.pdf", pdf_buffer.getvalue(), "application/pdf")},
        )
        uploaded.raise_for_status()
        document_id = uploaded.json()["document"]["id"]
        for _ in range(120):
            document = client.get(f"/api/v1/documents/{document_id}").json()
            if document["status"] == "ready":
                break
            assert document["status"] != "failed", document
            time.sleep(1)
        assert document["status"] == "ready" and document["page_count"] == 2
        print("PASS PDF extraction and local embedding ingestion", flush=True)
        retrieved = client.post(
            "/api/v1/retrieval/search",
            json={
                "collection_id": collection_id,
                "query": "Meridian archive retention",
                "mode": "vector",
            },
        )
        retrieved.raise_for_status()
        assert any(s["page"] == 1 and "45 days" in s["text"] for s in retrieved.json()["sources"])
        print("PASS vector search with page metadata", flush=True)
        chat = client.post("/api/v1/conversations", json={"collection_id": collection_id}).json()
        response = client.post(
            f"/api/v1/conversations/{chat['id']}/messages",
            json={"content": "How long are Meridian archive records retained?"},
        )
        response.raise_for_status()
        answer = parse_sse(response.text)
        assert "45" in answer["content"] and any(
            c["page"] == 1 and "45 days" in c["text"] for c in answer["citations"]
        ), answer
        persisted = client.get(f"/api/v1/conversations/{chat['id']}").json()
        assert persisted["messages"][-1]["content"] == answer["content"]
        print("PASS local answer, actual citations, and chat persistence", flush=True)
        client.delete(f"/api/v1/documents/{document_id}").raise_for_status()
        for _ in range(30):
            if client.get(f"/api/v1/documents/{document_id}").status_code == 404:
                break
            time.sleep(1)
        assert client.get(f"/api/v1/documents/{document_id}/file").status_code == 404
        persisted = client.get(f"/api/v1/conversations/{chat['id']}").json()
        assert not persisted["messages"][-1]["citations"][0]["available"]
        print("PASS deletion and retained citation snapshots", flush=True)
    finally:
        client.delete(f"/api/v1/collections/{collection_id}").raise_for_status()
