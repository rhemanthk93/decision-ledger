"""Pydantic models — API and extractor contracts."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

SourceType = Literal["meeting", "slack", "adr", "spec", "pr"]
DecisionType = Literal["architectural", "process", "product", "action"]


class RawDocument(BaseModel):
    """Payload accepted by POST /ingest."""

    source_type: SourceType
    filename: str = Field(min_length=1)
    doc_date: datetime
    content: str = Field(min_length=1)


class IngestResponse(BaseModel):
    doc_id: str
    skipped: bool


class Document(BaseModel):
    """A row from the `documents` table, as consumed by the extractor."""

    id: str
    source_type: SourceType
    filename: str
    doc_date: datetime
    content: str


class Decision(BaseModel):
    """One decision as emitted by the Haiku `record_decisions` tool.

    Field set mirrors §7.1.1 of the build plan exactly — do not add
    document_id here. That is attached at insert time by the worker/CLI.
    """

    statement: str
    topic_keywords: list[str]
    type: DecisionType
    decided_at: date
    decided_by: list[str]
    source_excerpt: str
    confidence: float
