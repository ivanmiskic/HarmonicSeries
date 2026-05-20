#!/usr/bin/env bash
# Deploy portfolio static export to offshore.studio
#
# Subpath (default, works with existing DNS + SSL):
#   ./scripts/deploy-offshore.sh
#
# Subdomain (requires DNS A record harmonic-series.offshore.studio → 206.189.106.173):
#   DEPLOY_MODE=subdomain ./scripts/deploy-offshore.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
REMOTE="${REMOTE:-offshore}"
DEPLOY_MODE="${DEPLOY_MODE:-subpath}"

if [[ "$DEPLOY_MODE" == "subdomain" ]]; then
  REMOTE_DIR="/var/www/html/offshore/harmonic-series"
  BUILD_ENV=(STATIC_EXPORT=1 NEXT_PUBLIC_LAB_ENABLED=false)
else
  REMOTE_DIR="/var/www/html/offshore/harmonic-series"
  BUILD_ENV=(STATIC_EXPORT=1 NEXT_BASE_PATH=/harmonic-series NEXT_PUBLIC_LAB_ENABLED=false)
fi

echo "==> Building static export (mode: $DEPLOY_MODE)"
cd "$WEB"
env "${BUILD_ENV[@]}" npm run build

echo "==> Syncing to $REMOTE:$REMOTE_DIR"
ssh "$REMOTE" "mkdir -p '$REMOTE_DIR'"
rsync -avz --delete "$WEB/out/" "$REMOTE:$REMOTE_DIR/"

echo "==> Done. Site files are on the server."
if [[ "$DEPLOY_MODE" == "subdomain" ]]; then
  echo "    URL: https://harmonic-series.offshore.studio/"
else
  echo "    URL: https://offshore.studio/harmonic-series/"
fi
