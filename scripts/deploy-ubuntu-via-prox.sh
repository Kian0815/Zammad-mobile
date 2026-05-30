#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-big-vm}"
REMOTE_PATH="${REMOTE_PATH:-/opt/zammad-mobile}"
SSH_CMD="${SSH_CMD:-ssh}"
RSYNC_RSH="${RSYNC_RSH:-${SSH_CMD}}"

rsync -av --delete \
  -e "${RSYNC_RSH}" \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'logs' \
  "${ROOT_DIR}/" \
  "${REMOTE_HOST}:${REMOTE_PATH}/"

${SSH_CMD} "${REMOTE_HOST}" "
  sudo bash -lc '
    cd ${REMOTE_PATH}
    export VITE_BASE_PATH=/zammad/
    export VITE_API_BASE=/zammad-api
    export VITE_AUTO_REFRESH_SECONDS=60
    docker compose build --no-cache
    docker compose up -d
  '
"

echo "Deploy completed to ${REMOTE_HOST}:${REMOTE_PATH}/"
echo "Remote .env was preserved and the remote build used /zammad/ paths."
