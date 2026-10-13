"""Index keyword retrieval passages."""

from alembic import op

revision = "20261012_text_index"
down_revision = "7d29d0835c1a"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX ix_chunks_text_gin ON document_chunks USING gin (to_tsvector('english', text))"
    )


def downgrade():
    op.drop_index("ix_chunks_text_gin", table_name="document_chunks")
