"""POST /ingest — write raw document to Supabase, dedupe by SHA256 content_hash."""
import hashlib
import logging

from fastapi import APIRouter, HTTPException

from app.db import get_supabase
from app.queue import enqueue
from app.schemas import IngestResponse, RawDocument

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/ingest", response_model=IngestResponse)
async def ingest(doc: RawDocument) -> IngestResponse:
    content_hash = hashlib.sha256(doc.content.encode("utf-8")).hexdigest()
    sb = get_supabase()

    existing = (
        sb.table("documents")
        .select("id")
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    if existing.data:
        doc_id = existing.data[0]["id"]
        log.info("ingest skipped (dedupe) filename=%s doc_id=%s", doc.filename, doc_id)
        return IngestResponse(doc_id=doc_id, skipped=True)

    row = {
        "source_type": doc.source_type,
        "filename": doc.filename,
        "doc_date": doc.doc_date.isoformat(),
        "content": doc.content,
        "content_hash": content_hash,
    }
    inserted = sb.table("documents").insert(row).execute()
    if not inserted.data:
        log.error("ingest insert returned no rows filename=%s", doc.filename)
        raise HTTPException(status_code=500, detail="insert failed")

    doc_id = inserted.data[0]["id"]
    log.info(
        "ingest inserted filename=%s source_type=%s doc_id=%s",
        doc.filename, doc.source_type, doc_id,
    )
    await enqueue(doc_id)
    return IngestResponse(doc_id=doc_id, skipped=False)
