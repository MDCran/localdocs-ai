"""Create a local configuration without overwriting an existing one."""

import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    print(".env already exists; no changes made.")
else:
    target.write_text(
        (root / ".env.example")
        .read_text()
        .replace("replace-with-a-local-password", secrets.token_hex(24)),
        encoding="utf-8",
    )
    print("Created .env with a random local database password.")
