"""Run the Haiku extractor against one or all seeded documents.

Bypasses the asyncio queue and the FastAPI worker pool — calls extract()
directly and writes results synchronously. Intended for local verification
and prompt iteration.

Usage:
    uv run python scripts/run_extractor_once.py --doc 01
    uv run python scripts/run_extractor_once.py --doc-id <uuid>
    uv run python scripts/run_extractor_once.py --all
    uv run python scripts/run_extractor_once.py --doc 01 --dry-run
    uv run python scripts/run_extractor_once.py --doc 01 --verbose
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.extractor import extract  # noqa: E402
from app.db import get_supabase  # noqa: E402
from app.schemas import Decision, Document  # noqa: E402
from app.workers import delete_existing_decisions, insert_decisions  # noqa: E402

SOURCE_TYPE_PRIORITY = {"meeting": 0, "adr": 1, "slack": 2, "spec": 3, "pr": 4}

log = logging.getLogger("run_extractor_once")


async def _list_ordered() -> list[Document]:
    sb = get_supabase()
    res = await asyncio.to_thread(lambda: sb.table("documents").select("*").execute())
    rows = res.data or []
    rows.sort(key=lambda r: (
        r["doc_date"],
        SOURCE_TYPE_PRIORITY.get(r["source_type"], 99),
        r["filename"],
    ))
    return [
        Document(
            id=r["id"],
            source_type=r["source_type"],
            filename=r["filename"],
            doc_date=r["doc_date"],
            content=r["content"],
        )
        for r in rows
    ]


async def _resolve_targets(args: argparse.Namespace) -> list[Document]:
    docs = await _list_ordered()
    if args.all:
        return docs
    if args.doc_id:
        matches = [d for d in docs if d.id == args.doc_id]
        if not matches:
            log.error("no document matched --doc-id %s", args.doc_id)
        return matches
    if args.doc:
        key = args.doc.zfill(2)
        idx_lookup = {f"{i:02d}": d for i, d in enumerate(docs, start=1)}
        match = idx_lookup.get(key)
        if not match:
            log.error("no document matched --doc %s (have %d docs)", args.doc, len(docs))
            return []
        return [match]
    return []


def _print_summary(doc: Document, decisions: list[Decision], verbose: bool, inserted: int | None) -> None:
    doc_date_iso = doc.doc_date.date().isoformat() if isinstance(doc.doc_date, datetime) else str(doc.doc_date)[:10]
    print(f"\nDocument: {doc.filename} ({doc.source_type}, {doc_date_iso})")
    if not decisions:
        print("  Extracted 0 decisions.")
        return
    print(f"  Extracted {len(decisions)} decision(s):")
    for d in decisions:
        who = ", ".join(d.decided_by) if d.decided_by else "—"
        print(f"    [{d.confidence:.2f}] {d.type:<14} {d.statement}  ({who})")
        if verbose:
            excerpt = d.source_excerpt.replace("\n", " ").strip()
            if len(excerpt) > 300:
                excerpt = excerpt[:297] + "..."
            print(f"           excerpt: {excerpt}")
    if inserted is not None:
        print(f"  Inserted {inserted} rows to decisions (replaced prior rows for this document).")


async def _run(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    targets = await _resolve_targets(args)
    if not targets:
        return 1

    dry = args.dry_run
    total_extracted = 0
    for doc in targets:
        decisions = await extract(doc)
        total_extracted += len(decisions)
        inserted_count: int | None = None
        if not dry:
            await delete_existing_decisions(doc.id)
            inserted = await insert_decisions(doc.id, decisions)
            inserted_count = len(inserted)
        _print_summary(doc, decisions, args.verbose, inserted_count)

    suffix = " (dry-run — no DB writes)" if dry else ""
    print(f"\nTotal: {len(targets)} document(s) processed, {total_extracted} decision(s) extracted{suffix}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Haiku extractor against seeded document(s).")
    sel = parser.add_mutually_exclusive_group(required=True)
    sel.add_argument("--doc", metavar="NN", help="Seeded doc_num (e.g. 01). Ordering matches seed_from_fixtures.")
    sel.add_argument("--doc-id", metavar="UUID", help="Exact document_id.")
    sel.add_argument("--all", action="store_true", help="Process all seeded documents.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run extractor and print summary; skip DELETE and INSERT.")
    parser.add_argument("--verbose", action="store_true",
                        help="Also print each decision's source_excerpt.")
    args = parser.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
