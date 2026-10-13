import hashlib
import time
from typing import Any

from sqlalchemy import Text, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from localdocs.ai import ai
from localdocs.models import Chunk, Document, Embedding
from localdocs.schemas import SearchInput, Source


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, key in enumerate(dict.fromkeys(ranking), 1):
            scores[key] = scores.get(key, 0) + 1 / (k + rank)
    return scores


def assemble_context(sources: list[Source], budget: int) -> list[Source]:
    selected: list[Source] = []
    seen: set[str] = set()
    used = 0
    for source in sources:
        fingerprint = hashlib.sha256(source.text.encode()).hexdigest()
        if fingerprint in seen:
            continue
        # Conservative estimate includes multibyte text and per-source framing.
        tokens = (len(source.text.encode("utf-8")) + 2) // 3 + 80
        if used + tokens > budget:
            continue
        used += tokens
        seen.add(fingerprint)
        selected.append(source.model_copy(update={"source_id": len(selected) + 1}))
    return selected


async def search(
    session: AsyncSession, request: SearchInput
) -> tuple[list[Source], dict[str, Any]]:
    started = time.perf_counter()
    filters = [Document.collection_id == request.collection_id, Document.status == "ready"]
    if request.document_ids:
        filters.append(Document.id.in_(request.document_ids))
    if request.page is not None:
        filters.append(Chunk.page == request.page)
    candidates: dict[str, Source] = {}
    rankings: list[list[str]] = []
    limit = request.top_k * 5
    embedding_ms = 0.0
    if request.mode != "keyword":
        await session.execute(text("SET LOCAL hnsw.iterative_scan = strict_order"))
        before_embedding = time.perf_counter()
        vector = await ai.query(request.query)
        embedding_ms = (time.perf_counter() - before_embedding) * 1000
        similarity = 1 - Embedding.vector.cosine_distance(vector)
        rows = (
            await session.execute(
                select(Chunk, Document, similarity.label("similarity"))
                .join(Document, Chunk.document_id == Document.id)
                .join(Embedding, Embedding.chunk_id == Chunk.id)
                .where(*filters, Embedding.model == ai.model, Embedding.dimensions == ai.dimensions)
                .order_by(Embedding.vector.cosine_distance(vector))
                .limit(limit)
            )
        ).all()
        ranking = []
        for chunk, document, score in rows:
            ranking.append(chunk.id)
            candidates[chunk.id] = Source(
                chunk_id=chunk.id,
                document_id=document.id,
                document_title=document.filename,
                page=chunk.page,
                text=chunk.text,
                score=float(score),
                vector_similarity=float(score),
                metadata=chunk.metadata_,
            )
        rankings.append(ranking)
    if request.mode != "vector":
        plain = func.plainto_tsquery("english", request.query)
        terms = func.to_tsquery("english", func.replace(func.cast(plain, Text), "&", "|"))
        text_vector = func.to_tsvector("english", Chunk.text)
        rank = func.ts_rank_cd(text_vector, terms)
        rows = (
            await session.execute(
                select(Chunk, Document, rank)
                .join(Document, Chunk.document_id == Document.id)
                .where(*filters, text_vector.op("@@")(terms))
                .order_by(rank.desc())
                .limit(limit)
            )
        ).all()
        ranking = []
        for chunk, document, score in rows:
            ranking.append(chunk.id)
            if chunk.id in candidates:
                candidates[chunk.id].keyword_score = float(score)
            else:
                candidates[chunk.id] = Source(
                    chunk_id=chunk.id,
                    document_id=document.id,
                    document_title=document.filename,
                    page=chunk.page,
                    text=chunk.text,
                    score=float(score),
                    keyword_score=float(score),
                    metadata=chunk.metadata_,
                )
        rankings.append(ranking)
    if request.mode == "hybrid":
        fused = reciprocal_rank_fusion(rankings)
        for key, score in fused.items():
            candidates[key].score = score
    ordered = sorted(candidates.values(), key=lambda s: s.score, reverse=True)
    deduped: list[Source] = []
    seen: set[str] = set()
    for source in ordered:
        digest = hashlib.sha256(source.text.strip().encode()).hexdigest()
        if digest not in seen:
            seen.add(digest)
            deduped.append(source)
    return deduped[: request.top_k], {
        "mode": request.mode,
        "score_kind": {
            "hybrid": "reciprocal rank fusion",
            "vector": "cosine similarity",
            "keyword": "text rank",
        }[request.mode],
        "candidate_count": len(candidates),
        "embedding_ms": round(embedding_ms, 1),
        "total_ms": round((time.perf_counter() - started) * 1000, 1),
        "embedding_model": ai.model,
        "dimensions": ai.dimensions,
    }
