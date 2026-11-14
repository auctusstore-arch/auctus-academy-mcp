#!/usr/bin/env bash
set -euo pipefail
if rg -n "service_role|SERVICE_ROLE|createServiceClient" src/; then
  echo "Service role usage detected in src/ — forbidden on user tool path (PRD §5)."
  exit 1
fi
echo "OK: no service role references in src/"