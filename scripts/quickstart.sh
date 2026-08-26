#!/usr/bin/env bash
set -euo pipefail

# Kept as a safe compatibility entry point for upstream instructions.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/setup.sh" "$@"
