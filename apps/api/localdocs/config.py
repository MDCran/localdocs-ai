from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://localdocs:localdocs@localhost:5438/localdocs"
    redis_url: str = "redis://localhost:6388/0"
    ollama_base_url: str = "http://localhost:11434"
    chat_model: str = "llama3.2:3b"
    embedding_model: str = "nomic-embed-text"
    embedding_dimensions: int = Field(default=768, ge=768, le=768)
    upload_dir: Path = Path("data/uploads")
    max_upload_mb: int = Field(default=25, ge=1, le=100)
    max_extracted_chars: int = 4_000_000
    chunk_size: int = Field(default=1200, ge=200, le=4000)
    chunk_overlap: int = Field(default=180, ge=0)
    max_job_attempts: int = 3
    lease_seconds: int = 120
    cors_origins: list[str] = ["http://localhost:5178", "http://127.0.0.1:5178"]

    @model_validator(mode="after")
    def validate_overlap(self) -> "Settings":
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
