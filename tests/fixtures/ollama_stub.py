"""Minimal Ollama protocol fixture for browser CI; never used by the application."""

import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()


def vector(text):
    result = [0.0] * 768
    result[0 if "retention" in text.lower() else 1] = 1.0
    return result


@app.get("/api/tags")
async def models():
    return {
        "models": [
            {"name": "llama3.2:3b", "size": 1, "details": {"parameter_size": "fixture"}},
            {
                "name": "nomic-embed-text:latest",
                "size": 1,
                "details": {"parameter_size": "fixture"},
            },
        ]
    }


@app.post("/api/embed")
async def embeddings(body: dict):
    inputs = body["input"]
    if isinstance(inputs, str):
        inputs = [inputs]
    return {"model": body["model"], "embeddings": [vector(text) for text in inputs]}


@app.post("/api/chat")
async def chat(body: dict):
    async def frames():
        for content, done in [("The archive retention period is 30 days [1].", False), ("", True)]:
            yield (
                json.dumps(
                    {
                        "model": body["model"],
                        "created_at": "2026-01-01T00:00:00Z",
                        "message": {"role": "assistant", "content": content},
                        "done": done,
                        "done_reason": "stop" if done else None,
                    }
                )
                + "\n"
            )

    return StreamingResponse(frames(), media_type="application/x-ndjson")
