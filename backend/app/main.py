"""FastAPI entry point for Decision Ledger."""
import logging

from fastapi import FastAPI

from app.config import LOG_LEVEL
from app.routes import ingest

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("decision_ledger")

app = FastAPI(title="Decision Ledger", version="0.1.0")

app.include_router(ingest.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def on_startup() -> None:
    log.info("Decision Ledger backend starting up")
