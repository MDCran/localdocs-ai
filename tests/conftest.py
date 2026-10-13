import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import make_url, text

test_url = os.getenv("TEST_DATABASE_URL")
if test_url:
    if not (make_url(test_url).database or "").endswith("_test"):
        raise RuntimeError("TEST_DATABASE_URL must point to a database ending in _test")
    os.environ["DATABASE_URL"] = test_url


@pytest.fixture
async def client(tmp_path: Path, monkeypatch) -> AsyncIterator[httpx.AsyncClient]:
    if not test_url:
        pytest.skip("Set TEST_DATABASE_URL to run integration tests")
    from localdocs.config import get_settings
    from localdocs.db import engine
    from localdocs.main import app

    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path)
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE collections, application_settings CASCADE"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as session:
        yield session
    await engine.dispose()


@pytest.fixture
def fake_ai(monkeypatch):
    from localdocs.ai import ai

    def vector(text):
        values = [0.0] * 768
        values[0 if "retention" in text.lower() else 1] = 1.0
        return values

    async def embed(texts):
        return [vector(t) for t in texts]

    async def query(text):
        return vector(text)

    async def stream(messages, options):
        yield "Retention is 30 days [1]."

    monkeypatch.setattr(ai, "embed", embed)
    monkeypatch.setattr(ai, "query", query)
    monkeypatch.setattr(ai, "stream", stream)
    return ai
