"""Create document retrieval schema"""

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "7d29d0835c1a"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "collections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("deleting", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("collection_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("active_request", sa.String(length=36), nullable=True),
        sa.Column("active_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_conversations_collection_id"), "conversations", ["collection_id"], unique=False
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("collection_id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=240), nullable=False),
        sa.Column("extension", sa.String(length=10), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("collection_id", "checksum"),
    )
    op.create_index(
        op.f("ix_documents_collection_id"), "documents", ["collection_id"], unique=False
    )
    op.create_index(op.f("ix_documents_status"), "documents", ["status"], unique=False)
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "ordinal"),
    )
    op.create_index(
        op.f("ix_document_chunks_document_id"), "document_chunks", ["document_id"], unique=False
    )
    op.create_table(
        "ingestion_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("operation", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("stage", sa.String(length=24), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("lease_token", sa.String(length=36), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_ingestion_jobs_document_id"), "ingestion_jobs", ["document_id"], unique=False
    )
    op.create_index(op.f("ix_ingestion_jobs_status"), "ingestion_jobs", ["status"], unique=False)
    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("diagnostics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_messages_conversation_id"), "messages", ["conversation_id"], unique=False
    )
    op.create_table(
        "embeddings",
        sa.Column("chunk_id", sa.String(length=36), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("vector", pgvector.sqlalchemy.vector.VECTOR(dim=768), nullable=False),
        sa.CheckConstraint("dimensions = 768", name="embedding_dimensions"),
        sa.ForeignKeyConstraint(["chunk_id"], ["document_chunks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("chunk_id"),
    )
    op.create_index(
        "ix_embedding_hnsw",
        "embeddings",
        ["vector"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"vector": "vector_cosine_ops"},
    )
    op.create_index(op.f("ix_embeddings_model"), "embeddings", ["model"], unique=False)
    op.create_table(
        "message_citations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("chunk_id", sa.String(length=36), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["chunk_id"], ["document_chunks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "source_id"),
    )
    op.create_index(
        op.f("ix_message_citations_message_id"), "message_citations", ["message_id"], unique=False
    )


def downgrade():
    op.drop_index(op.f("ix_message_citations_message_id"), table_name="message_citations")
    op.drop_table("message_citations")
    op.drop_index(op.f("ix_embeddings_model"), table_name="embeddings")
    op.drop_index(
        "ix_embedding_hnsw",
        table_name="embeddings",
        postgresql_using="hnsw",
        postgresql_ops={"vector": "vector_cosine_ops"},
    )
    op.drop_table("embeddings")
    op.drop_index(op.f("ix_messages_conversation_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_ingestion_jobs_status"), table_name="ingestion_jobs")
    op.drop_index(op.f("ix_ingestion_jobs_document_id"), table_name="ingestion_jobs")
    op.drop_table("ingestion_jobs")
    op.drop_index(op.f("ix_document_chunks_document_id"), table_name="document_chunks")
    op.drop_table("document_chunks")
    op.drop_index(op.f("ix_documents_status"), table_name="documents")
    op.drop_index(op.f("ix_documents_collection_id"), table_name="documents")
    op.drop_table("documents")
    op.drop_index(op.f("ix_conversations_collection_id"), table_name="conversations")
    op.drop_table("conversations")
    op.drop_table("collections")
    op.drop_table("application_settings")
