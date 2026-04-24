#!/usr/bin/env bash
# Start the Next.js dev server, unsetting env vars that Claude Code's shell
# harness pre-exports as empty strings. Next.js's dotenv loader respects the
# existing environment and would otherwise skip loading ANTHROPIC_API_KEY
# from .env.local (leaving it as ""), which breaks the /api/query route with
# 401 errors from Anthropic.
#
# Usage:  ./scripts/start-frontend.sh
# Usage:  COREPACK_INTEGRITY_KEYS=0 ./scripts/start-frontend.sh   (older Node)

set -euo pipefail

# Vars that some shells / harnesses pre-export as empty. If empty, unset them
# so that .env.local takes precedence.
for v in ANTHROPIC_API_KEY ANTHROPIC_BASE_URL GOOGLE_API_KEY; do
  # shellcheck disable=SC2163
  if [ -z "${!v:-}" ]; then
    unset "$v"
  fi
done

cd "$(dirname "$0")/.."
exec pnpm dev "$@"
