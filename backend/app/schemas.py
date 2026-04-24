"""Pydantic models — API contracts."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SourceType = Literal["meeting", "slack", "adr", "spec", "pr"]


class RawDocument(BaseModel):
    """Payload accepted by POST /ingest."""

    source_type: SourceType
    filename: str = Field(min_length=1)
    doc_date: datetime
    content: str = Field(min_length=1)


class IngestResponse(BaseModel):
    doc_id: str
    skipped: bool
