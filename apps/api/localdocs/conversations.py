import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select

from localdocs.ai import ai
from localdocs.db import Session
from localdocs.generation import (
    build_prompt,
    filter_untrusted_sources,
    is_abstention,
    validate_citations,
)
from localdocs.models import Citation, Conversation, Message, new_id, now
from localdocs.retrieval import assemble_context, search
from localdocs.runtime import read_runtime
from localdocs.schemas import MessageInput, SearchInput


def event(kind: str, payload: Any) -> str:
    return f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def prepare(conversation_id: str, body: MessageInput) -> tuple[str, str, str]:
    async with Session() as session, session.begin():
        conversation = await session.get(Conversation, conversation_id, with_for_update=True)
        if not conversation:
            raise HTTPException(404, "Conversation not found")
        if (
            conversation.active_request
            and conversation.active_until
            and conversation.active_until > now()
        ):
            raise HTTPException(409, "This conversation already has a response in progress")
        messages = (
            await session.scalars(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at, Message.id)
            )
        ).all()
        for message in messages:
            if message.status == "streaming":
                message.status = "interrupted"
        if body.regenerate:
            users = [m for m in messages if m.role == "user"]
            if not users:
                raise HTTPException(400, "No response to regenerate")
            question = users[-1].content
            if messages and messages[-1].role == "assistant":
                await session.execute(delete(Message).where(Message.id == messages[-1].id))
        else:
            question = body.content.strip()
            if not question:
                raise HTTPException(422, "Enter a question")
            session.add(Message(conversation_id=conversation_id, role="user", content=question))
            if conversation.title == "New conversation":
                conversation.title = question[:120]
        request_id, message_id = new_id(), new_id()
        conversation.active_request = request_id
        conversation.active_until = now() + timedelta(seconds=360)
        conversation.updated_at = now()
        session.add(
            Message(
                id=message_id, conversation_id=conversation_id, role="assistant", status="streaming"
            )
        )
        return request_id, message_id, question


async def stream_answer(
    conversation_id: str, request_id: str, message_id: str, question: str, document_ids: list[str]
) -> AsyncIterator[str]:
    answer = ""
    started = time.perf_counter()
    try:
        async with asyncio.timeout(300):
            async with Session() as session:
                conversation = await session.get(Conversation, conversation_id)
                if not conversation:
                    return
                options = await read_runtime(session)
                history_rows = (
                    await session.scalars(
                        select(Message)
                        .where(
                            Message.conversation_id == conversation_id, Message.status == "complete"
                        )
                        .order_by(Message.created_at.desc())
                        .limit(8)
                    )
                ).all()
                history = [
                    {"role": m.role, "content": m.content[:1500]} for m in reversed(history_rows)
                ]
                sources, diagnostics = await search(
                    session,
                    SearchInput(
                        query=question,
                        collection_id=conversation.collection_id,
                        document_ids=document_ids,
                        top_k=options.top_k,
                        mode="hybrid" if options.hybrid else "vector",
                    ),
                )
            eligible = [
                s
                for s in sources
                if (
                    s.vector_similarity is not None
                    and s.vector_similarity >= options.min_similarity
                )
                or (s.keyword_score or 0) > 0
            ]
            context = assemble_context(eligible, options.context_tokens)
            context, untrusted_excluded = filter_untrusted_sources(question, context)
            diagnostics.update(
                {
                    "context_chunks": len(context),
                    "context_budget": options.context_tokens,
                    "chat_model": options.chat_model,
                    "untrusted_passages_excluded": untrusted_excluded,
                }
            )
            yield event(
                "sources",
                {"sources": [s.model_dump() for s in context], "diagnostics": diagnostics},
            )
            if not context:
                answer = "I couldn't find enough evidence in this collection to answer that question. Try a more specific question or add a relevant document."
                yield event("delta", {"text": answer})
            else:
                async for text in ai.stream(build_prompt(question, history, context), options):
                    answer += text
                    yield event("delta", {"text": text})
            answer, citations, invalid = validate_citations(answer, context)
            abstained = is_abstention(answer)
            diagnostics.update(
                {
                    "invalid_citations": invalid,
                    "unverified_citation": "[unverified source]" in answer.casefold(),
                    "abstained": abstained,
                    "uncited_answer": bool(context and not citations and not abstained),
                    "generation_ms": round((time.perf_counter() - started) * 1000, 1),
                }
            )
            async with Session() as session, session.begin():
                conversation = await session.get(
                    Conversation, conversation_id, with_for_update=True
                )
                message = await session.get(Message, message_id)
                if not conversation or conversation.active_request != request_id or not message:
                    return
                message.content, message.status, message.diagnostics = (
                    answer,
                    "complete",
                    diagnostics,
                )
                for source in citations:
                    session.add(
                        Citation(
                            message_id=message.id,
                            chunk_id=source.chunk_id,
                            source_id=source.source_id,
                            snapshot=source.model_dump(),
                        )
                    )
                conversation.active_request, conversation.active_until = None, None
            yield event(
                "done",
                {
                    "message_id": message_id,
                    "content": answer,
                    "citations": [s.model_dump() for s in citations],
                    "diagnostics": diagnostics,
                },
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        yield event(
            "error",
            {
                "message": "The local model could not complete the response. Check Models in Settings, then retry."
            },
        )
    finally:
        async with Session() as session, session.begin():
            conversation = await session.get(Conversation, conversation_id, with_for_update=True)
            message = await session.get(Message, message_id)
            if conversation and conversation.active_request == request_id:
                conversation.active_request, conversation.active_until = None, None
                if message and message.status == "streaming":
                    message.status, message.content = "interrupted", answer
