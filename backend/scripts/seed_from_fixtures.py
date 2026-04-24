"""Walk demo_data/<source_type>/* and POST each file to /ingest.

Assigns a stable doc_num (01..14) based on (doc_date, source_type priority,
filename) ordering, so the canonical corpus numbering from the build plan
holds regardless of filesystem order.

Usage:
    python scripts/seed_from_fixtures.py                 # seed everything
    python scripts/seed_from_fixtures.py --only 01       # seed only Doc 01
    python scripts/seed_from_fixtures.py --dry-run       # list what would be seeded
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Source-type tie-break priority within a single doc_date.
# Meeting comes first (the meeting on 2026-03-15 is Doc 01, the ADR signed
# the same day is Doc 02); PR last because merges trail the decisions they
# implement.
SOURCE_TYPE_PRIORITY = {"meeting": 0, "adr": 1, "slack": 2, "spec": 3, "pr": 4}

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DEFAULT_DEMO_DATA = PROJECT_ROOT / "demo_data"
DEFAULT_BASE_URL = "http://localhost:8000"

log = logging.getLogger("seed")


@dataclass
class Fixture:
    doc_num: str            # "01" .. "14"
    source_type: str
    path: Path
    doc_date: datetime
    content: str

    @property
    def filename(self) -> str:
        return self.path.name


def _parse_date_from_filename(name: str) -> datetime | None:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", name)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)


def _parse_date_from_adr(content: str) -> datetime | None:
    m = re.search(r"\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})", content)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)


def _parse_date_from_pr(content: str) -> datetime | None:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None
    pr = data.get("pull_request", {}) if isinstance(data, dict) else {}
    for key in ("merged_at", "created_at"):
        val = pr.get(key) or (data.get(key) if isinstance(data, dict) else None)
        if val:
            # Accept "2026-04-20T03:45:22Z" or plain date.
            iso = val.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(iso)
            except ValueError:
                continue
    return None


def _doc_date_for(source_type: str, path: Path, content: str) -> datetime:
    if source_type == "adr":
        dt = _parse_date_from_adr(content) or _parse_date_from_filename(path.name)
    elif source_type == "pr":
        dt = _parse_date_from_pr(content) or _parse_date_from_filename(path.name)
    else:
        dt = _parse_date_from_filename(path.name)
    if dt is None:
        raise ValueError(f"Could not extract doc_date from {path}")
    return dt


def discover_fixtures(demo_data: Path) -> list[Fixture]:
    if not demo_data.exists():
        return []
    raw: list[tuple[datetime, int, str, str, Path, str]] = []
    for source_type in sorted(SOURCE_TYPE_PRIORITY):
        subdir = demo_data / source_type
        if not subdir.is_dir():
            continue
        for path in sorted(subdir.iterdir()):
            if not path.is_file() or path.name.startswith("."):
                continue
            content = path.read_text(encoding="utf-8")
            doc_date = _doc_date_for(source_type, path, content)
            raw.append((
                doc_date,
                SOURCE_TYPE_PRIORITY[source_type],
                path.name,
                source_type,
                path,
                content,
            ))
    raw.sort(key=lambda r: (r[0], r[1], r[2]))
    fixtures: list[Fixture] = []
    for i, (doc_date, _prio, _name, source_type, path, content) in enumerate(raw, start=1):
        fixtures.append(Fixture(
            doc_num=f"{i:02d}",
            source_type=source_type,
            path=path,
            doc_date=doc_date,
            content=content,
        ))
    return fixtures


def post_one(client: httpx.Client, base_url: str, fx: Fixture) -> tuple[str, bool]:
    payload = {
        "source_type": fx.source_type,
        "filename": fx.filename,
        "doc_date": fx.doc_date.isoformat(),
        "content": fx.content,
    }
    resp = client.post(f"{base_url}/ingest", json=payload, timeout=30.0)
    resp.raise_for_status()
    body = resp.json()
    return body["doc_id"], body["skipped"]


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(description="Seed demo_data into /ingest.")
    parser.add_argument("--only", metavar="NN",
                        help="Seed only the fixture with this doc_num (e.g. 01).")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL,
                        help=f"Backend base URL (default {DEFAULT_BASE_URL}).")
    parser.add_argument("--demo-data", default=str(DEFAULT_DEMO_DATA),
                        help=f"Path to demo_data (default {DEFAULT_DEMO_DATA}).")
    parser.add_argument("--dry-run", action="store_true",
                        help="List fixtures with assigned doc_num; do not POST.")
    args = parser.parse_args(argv)

    demo_data = Path(args.demo_data).resolve()
    fixtures = discover_fixtures(demo_data)
    if not fixtures:
        log.info("No fixtures found in %s", demo_data)
        return 0

    log.info("Discovered %d fixtures in %s", len(fixtures), demo_data)
    for fx in fixtures:
        log.info("  %s  %-7s  %s  %s", fx.doc_num, fx.source_type,
                 fx.doc_date.date().isoformat(), fx.filename)

    if args.only:
        key = args.only.zfill(2)
        targets = [fx for fx in fixtures if fx.doc_num == key]
        if not targets:
            log.error("No fixture matched --only %s", args.only)
            return 1
    else:
        targets = fixtures

    if args.dry_run:
        log.info("Dry run: %d fixture(s) would be posted", len(targets))
        return 0

    inserted = skipped = 0
    with httpx.Client() as client:
        for fx in targets:
            try:
                doc_id, was_skipped = post_one(client, args.base_url, fx)
            except httpx.HTTPError as e:
                log.error("POST failed for %s: %s", fx.filename, e)
                return 2
            if was_skipped:
                skipped += 1
                log.info("skipped %s -> %s (already ingested)", fx.doc_num, doc_id)
            else:
                inserted += 1
                log.info("inserted %s -> %s", fx.doc_num, doc_id)

    log.info("Done: inserted=%d skipped=%d total=%d", inserted, skipped, len(targets))
    return 0


if __name__ == "__main__":
    sys.exit(main())
