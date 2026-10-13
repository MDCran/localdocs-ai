"""Upload the synthetic example corpus through the public API."""

import argparse
from pathlib import Path

import httpx

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://localhost:8008")
args = parser.parse_args()
with httpx.Client(base_url=args.url, timeout=60) as client:
    response = client.post(
        "/api/v1/collections",
        json={
            "name": "Atlas handbook",
            "description": "Synthetic operations, releases, and retrieval notes for exploring local document search.",
        },
    )
    response.raise_for_status()
    collection_id = response.json()["id"]
    for path in sorted((root / "tests/fixtures/documents").glob("*.md")):
        if path.name == "untrusted.md":
            continue
        response = client.post(
            "/api/v1/documents",
            data={"collection_id": collection_id},
            files={"file": (path.name, path.read_bytes(), "text/markdown")},
        )
        response.raise_for_status()
        print(f"Queued {path.name}")
    print(f"Collection: {collection_id}")
    print("Try: Compare archive record retention and deployment artifact retention.")
