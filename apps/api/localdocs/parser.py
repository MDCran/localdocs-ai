"""Parse a stored document in a separate, time-limited process."""

import json
import sys
from dataclasses import asdict
from pathlib import Path

from localdocs.ingestion import DocumentError, extract


def main() -> None:
    if sys.platform != "win32":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (1_500_000_000, 1_500_000_000))
        resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    try:
        pages = extract(Path(sys.argv[1]), sys.argv[2])
        print(json.dumps({"pages": [asdict(page) for page in pages]}))
    except DocumentError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(2)


if __name__ == "__main__":
    main()
