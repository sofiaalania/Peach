"""CLI script for testing the AI agenda parser locally."""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Ensure backend root is on sys.path when executed directly
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.ai.agenda import PROMPT_VERSION, parse_agenda


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    if len(sys.argv) > 1:
        input_text = " ".join(sys.argv[1:])
    else:
        print("Enter meeting notes (Ctrl+D to finish):")
        input_text = sys.stdin.read()

    print(f"Parsing {len(input_text)} characters using prompt {PROMPT_VERSION}...")
    try:
        parsed = asyncio.run(parse_agenda(input_text))
        print("\n--- Parsed Agenda ---")
        print(parsed.model_dump_json(indent=2))
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
