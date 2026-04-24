"""Global configuration for Decision Ledger backend."""
import os
from dotenv import load_dotenv

load_dotenv()

# ---- LLM models (hardcoded) ----
HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"
GEMINI_EMBED_MODEL = "gemini-embedding-001"

# ---- Embedding ----
EMBED_DIM = 768                              # MRL-truncated from 3072; same MTEB tier

# ---- Clustering ----
CLUSTERING_THRESHOLD = 0.82                  # cosine; tune via scripts/tune_threshold.py

# ---- Decision filtering ----
CONFIDENCE_FILTER = 0.60                     # below this is soft; hidden from main timeline

# ---- Worker intervals (seconds) ----
RESOLVER_INTERVAL_SEC = 20                   # resolve + detect batch cadence
NARRATOR_POLL_SEC = 2                        # conflict narration poll cadence

# ---- Extractor concurrency ----
EXTRACTOR_WORKERS = 4                        # asyncio.gather fanout

# ---- Env-sourced ----
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
