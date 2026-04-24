"""FastAPI entry point for Decision Ledger."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import LOG_LEVEL
from app.routes import ingest
from app.workers import start_workers, stop_workers

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("decision_ledger")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Decision Ledger backend starting up")
    start_workers()
    try:
        yield
    finally:
        log.info("Decision Ledger backend shutting down")
        await stop_workers()


app = FastAPI(title="Decision Ledger", version="0.1.0", lifespan=lifespan)

app.include_router(ingest.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
