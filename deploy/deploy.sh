#!/usr/bin/env bash
# Deploy Bitsparx HQ to KVM from your machine.
# Prerequisite: SSH key access — run: ssh-copy-id root@147.93.104.138
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${DEPLOY_SERVER:-root@147.93.104.138}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/bitsparx-hq}"
PUBLIC_URL="${PUBLIC_URL:-http://147.93.104.138}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "==> Testing SSH to ${SERVER}..."
if ! ssh "${SSH_OPTS[@]}" "$SERVER" "echo ok"; then
  echo "SSH failed. Add your key first:"
  echo "  ssh-copy-id ${SERVER}"
  exit 1
fi

echo "==> Cleaning KVM..."
ssh "${SSH_OPTS[@]}" "$SERVER" 'bash -s' < "$ROOT/deploy/scripts/clean-server.sh"

echo "==> Installing dependencies..."
ssh "${SSH_OPTS[@]}" "$SERVER" 'bash -s' < "$ROOT/deploy/scripts/install-deps.sh"

echo "==> Syncing application..."
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p ${APP_DIR}"
rsync -avz --delete \
  --exclude node_modules \
  --exclude frontend/node_modules \
  --exclude backend/.venv \
  --exclude frontend/build \
  --exclude .git \
  --exclude 'backend/.env' \
  --exclude '.DS_Store' \
  "$ROOT/" "${SERVER}:${APP_DIR}/"

if [[ -f "$ROOT/backend/.env" ]]; then
  echo "==> Uploading backend/.env to /etc/bitsparx-hq.env..."
  scp "${SSH_OPTS[@]}" "$ROOT/backend/.env" "${SERVER}:/etc/bitsparx-hq.env"
  ssh "${SSH_OPTS[@]}" "$SERVER" "sed -i 's|CORS_ORIGINS=.*|CORS_ORIGINS=${PUBLIC_URL}|' /etc/bitsparx-hq.env; grep -q COOKIE_SECURE /etc/bitsparx-hq.env || echo 'COOKIE_SECURE=false' >> /etc/bitsparx-hq.env"
else
  echo "==> No local backend/.env — using env.production.example on server."
fi

echo "==> Building and starting app..."
ssh "${SSH_OPTS[@]}" "$SERVER" "PUBLIC_URL='${PUBLIC_URL}' bash -s" < "$ROOT/deploy/scripts/setup-app.sh"

echo ""
echo "Done. Open: ${PUBLIC_URL}"
