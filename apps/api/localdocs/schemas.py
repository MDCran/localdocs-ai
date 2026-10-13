from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class CollectionInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class ConversationInput(BaseModel):
    collection_id: str
    title: str = Field(default="New conversation", min_length=1, max_length=120)


class TitleInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class RuntimeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chat_model: str = Field(default="llama3.2:3b", min_length=1, max_length=120)
    temperature: float = Field(default=0.1, ge=0, le=1)
    top_k: int = Field(default=6, ge=1, le=20)
    context_tokens: int = Field(default=2400, ge=256, le=8000)
    min_similarity: float = Field(default=0.25, ge=-1, le=1)
    hybrid: bool = True


class SearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    collection_id: str
    document_ids: list[str] = Field(default_factory=list, max_length=50)
    page: int | None = Field(default=None, ge=1)
    top_k: int = Field(default=6, ge=1, le=20)
    mode: Literal["hybrid", "vector", "keyword"] = "hybrid"


class MessageInput(BaseModel):
    content: str = Field(default="", max_length=4000)
    document_ids: list[str] = Field(default_factory=list, max_length=50)
    regenerate: bool = False


class Source(BaseModel):
    source_id: int = 0
    chunk_id: str
    document_id: str
    document_title: str
    page: int | None
    text: str
    score: float
    vector_similarity: float | None = None
    keyword_score: float | None = None
    metadata: dict[str, Any]
