#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-big-vm}"
REMOTE_PATH="${REMOTE_PATH:-/opt/zammad-mobile}"

rsync -av --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'logs' \
  "${ROOT_DIR}/" \
  "${REMOTE_HOST}:${REMOTE_PATH}/"

ssh "${REMOTE_HOST}" "
  set -euo pipefail
  cd ${REMOTE_PATH}
  docker compose up --build -d
"

echo "Deploy completed to ${REMOTE_HOST}:${REMOTE_PATH}"
