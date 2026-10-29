"""AWS Lambda entry point: the FastAPI app behind a Lambda function URL.

Two kinds of event arrive here:

- HTTP requests from the function URL (payload format 2.0), handed to the ASGI
  app through Mangum.
- ``{"action": "migrate"}``, sent by scripts/deploy-backend.sh through a direct
  invoke after every deploy. A function URL request can never produce this
  shape - its body is nested under ``body``, not at the top level - so the
  migration path is reachable only by someone allowed to call lambda:Invoke.
"""

import asyncio
import logging
from pathlib import Path
from typing import Any

from mangum import Mangum

from app.main import app

logger = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"

# Mangum calls asyncio.get_event_loop(), which on Python 3.14 raises when no
# loop is set. Own one loop for the life of the execution environment, and set
# it again before every call - alembic's asyncio.run() unsets it on exit.
_loop = asyncio.new_event_loop()
_asgi = Mangum(app, lifespan="off")


def _migrate() -> dict[str, str]:
    from alembic import command
    from alembic.config import Config

    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    command.upgrade(config, "head")
    logger.info("migrations applied")
    return {"status": "ok", "migrated_to": "head"}


def _seed() -> dict[str, Any]:
    from app.reports.seed import seed_meetings_sync

    count = seed_meetings_sync()
    logger.info("seed applied: inserted %d meetings", count)
    return {"status": "ok", "inserted": count}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("action") == "migrate":
        return _migrate()
    if event.get("action") == "seed":
        return _seed()
    asyncio.set_event_loop(_loop)
    return _asgi(event, context)
