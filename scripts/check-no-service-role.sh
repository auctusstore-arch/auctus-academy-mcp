#!/usr/bin/env bash
set -euo pipefail
if grep -REn "service_role|SERVICE_ROLE|createServiceClient" src/ 2>/dev/null; then
  echo "Service role usage detected in src/ — forbidden on user tool path (PRD §5)."
  exit 1
fi
echo "OK: no service role references in src/"