#!/usr/bin/env bash
# Re-copy the dedup engine from an auctus-academy checkout and refresh the guard hashes.
# Usage: scripts/sync-dedup-engine.sh /path/to/auctus-academy
set -euo pipefail
SRC="${1:?path to auctus-academy checkout}"
SHA="$(git -C "$SRC" rev-parse --short HEAD)"
DEST="$(cd "$(dirname "$0")/.." && pwd)"
for f in engine.ts types.ts; do
  {
    echo "// VENDORED from auctus-academy src/modules/citation-dedup/$f @ $SHA (staging). Do not edit here:"
    echo "// change it in auctus-academy, then re-copy. tests/dedup-vendored.test.ts guards the copy."
    echo "// @ts-nocheck: upstream compiles without noUncheckedIndexedAccess; it is type-checked in auctus-academy."
    cat "$SRC/src/modules/citation-dedup/$f"
  } > "$DEST/src/dedup/$f"
done
ENGINE="$(shasum -a 256 "$SRC/src/modules/citation-dedup/engine.ts" | cut -d' ' -f1)"
TYPES="$(shasum -a 256 "$SRC/src/modules/citation-dedup/types.ts" | cut -d' ' -f1)"
printf 'export const VENDORED_DEDUP_SHA256 = {\n  "engine.ts": "%s",\n  "types.ts": "%s",\n} as const;\n' "$ENGINE" "$TYPES" > "$DEST/src/dedup/vendored-hashes.ts"
echo "synced @ $SHA"
