"""Run integration tests in a dedicated database derived from .env."""

import os
import subprocess
import sys

from localdocs.config import get_settings
from sqlalchemy import make_url

if __name__ == "__main__":
    settings = get_settings()
    url = make_url(settings.database_url)
    if not url.database:
        raise SystemExit(
            "Set DATABASE_URL to a PostgreSQL database before running integration tests"
        )
    url = url.set(
        database=f"{url.database}_test" if not url.database.endswith("_test") else url.database
    )
    encoded = url.render_as_string(hide_password=False)
    environment = dict(os.environ, DATABASE_URL=encoded, TEST_DATABASE_URL=encoded)
    subprocess.run(["uv", "run", "alembic", "upgrade", "head"], env=environment, check=True)
    sys.exit(subprocess.run(["uv", "run", "pytest", *sys.argv[1:]], env=environment).returncode)
