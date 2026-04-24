"""Smoke-test Supabase connectivity and that the 001 migration has been applied.

Reads a single row from each of the 4 tables; prints OK or the first error.
Exit 0 on success, 1 on any failure.
"""
from __future__ import annotations

import logging
import sys

from app.db import get_supabase

TABLES = ("documents", "topic_clusters", "decisions", "conflicts")

log = logging.getLogger("check_db")


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    sb = get_supabase()
    failed = False
    for t in TABLES:
        try:
            res = sb.table(t).select("*", count="exact").limit(1).execute()
            count = getattr(res, "count", None)
            log.info("table %s OK (rows=%s)", t, count if count is not None else "?")
        except Exception as e:  # noqa: BLE001 — surface any failure as one line
            failed = True
            log.error("table %s FAILED: %s", t, e)
    if failed:
        log.error("Supabase connection FAILED")
        return 1
    log.info("Supabase connection OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
