"""In-process asyncio queue used by the extraction consumer (Phase 2)."""
import asyncio
import logging

log = logging.getLogger(__name__)

# Singleton queue of doc_id strings. Phase 2 adds the consumer.
raw_docs: asyncio.Queue[str] = asyncio.Queue()


async def enqueue(doc_id: str) -> None:
    """Push a newly-ingested doc_id onto the processing queue."""
    await raw_docs.put(doc_id)
    log.info("enqueued doc_id=%s (queue size=%d)", doc_id, raw_docs.qsize())
