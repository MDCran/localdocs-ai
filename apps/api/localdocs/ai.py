import math
from collections.abc import AsyncIterator

import httpx
from langchain_core.messages import BaseMessage
from langchain_ollama import ChatOllama, OllamaEmbeddings

from localdocs.config import get_settings
from localdocs.schemas import RuntimeSettings


class LocalAI:
    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.ollama_base_url
        self.model = settings.embedding_model
        self.dimensions = settings.embedding_dimensions
        self.embeddings = OllamaEmbeddings(
            model=self.model,
            base_url=self.base_url,
            client_kwargs={"timeout": 120},
        )

    def validate_vectors(self, vectors: list[list[float]], expected: int) -> None:
        if len(vectors) != expected or any(
            len(v) != self.dimensions
            or not all(math.isfinite(n) for n in v)
            or sum(n * n for n in v) == 0
            for v in vectors
        ):
            raise ValueError(
                f"Embedding model must return finite, nonzero {self.dimensions}-dimension vectors"
            )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = await self.embeddings.aembed_documents(texts)
        self.validate_vectors(vectors, len(texts))
        return vectors

    async def query(self, text: str) -> list[float]:
        vector = await self.embeddings.aembed_query(text)
        self.validate_vectors([vector], 1)
        return vector

    async def stream(
        self, messages: list[BaseMessage], options: RuntimeSettings
    ) -> AsyncIterator[str]:
        llm = ChatOllama(
            model=options.chat_model,
            base_url=self.base_url,
            temperature=options.temperature,
            num_ctx=options.context_tokens + 4096,
            num_predict=1800,
            client_kwargs={"timeout": 300},
        )
        async for part in llm.astream(messages):
            if isinstance(part.content, str):
                yield part.content

    async def models(self) -> list[dict[str, object]]:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            return response.json().get("models", [])  # type: ignore[no-any-return]


ai = LocalAI()
