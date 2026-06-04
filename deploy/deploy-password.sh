#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/deploy"
SERVER="${DEPLOY_SERVER:-root@147.93.104.138}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/bitsparx-hq}"
PUBLIC_URL="${PUBLIC_URL:-http://147.93.104.138}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/bitsparx20-arch/BSX_HQ.git}"
CONTROL="${SSH_CONTROL:-/tmp/bitsparx-ssh-$$}"

if [[ -z "${SSHPASS:-}" ]]; then
  echo "Usage: SSHPASS='your-password' ./deploy/deploy-password.sh"
  exit 1
fi

export SSH_HOST="$SERVER"
chmod +x "$DEPLOY_DIR/ssh-master.exp" "$DEPLOY_DIR/scp-file.exp"

SSH_BASE=(ssh -S "$CONTROL" -o StrictHostKeyChecking=accept-new "$SERVER")
SCP_BASE=(scp -o ControlPath="$CONTROL" -o StrictHostKeyChecking=no)

cleanup() {
  "${SSH_BASE[@]}" -O exit 2>/dev/null || true
  rm -f "$CONTROL"
}
trap cleanup EXIT

echo "==> Opening SSH session..."
export SSH_CONTROL="$CONTROL"
export SSHPASS
"$DEPLOY_DIR/ssh-master.exp"

run_ssh() {
  "${SSH_BASE[@]}" "$@"
}

run_script() {
  "${SSH_BASE[@]}" bash -s < "$1"
}

echo "==> Cleaning KVM..."
run_script "$DEPLOY_DIR/scripts/clean-server.sh"

echo "==> Installing dependencies..."
run_script "$DEPLOY_DIR/scripts/install-deps.sh"

echo "==> Deploying from GitHub (${GITHUB_REPO})..."
run_ssh "mkdir -p ${APP_DIR} && if [ -d ${APP_DIR}/.git ]; then cd ${APP_DIR} && git fetch origin && git reset --hard origin/main; else git clone ${GITHUB_REPO} ${APP_DIR}; fi"

if [[ -f "$ROOT/backend/.env" ]]; then
  echo "==> Uploading secrets..."
  "${SCP_BASE[@]}" "$ROOT/backend/.env" "${SERVER}:/etc/bitsparx-hq.env"
  run_ssh "sed -i 's|CORS_ORIGINS=.*|CORS_ORIGINS=${PUBLIC_URL}|' /etc/bitsparx-hq.env; grep -q COOKIE_SECURE /etc/bitsparx-hq.env || echo COOKIE_SECURE=false >> /etc/bitsparx-hq.env"
fi

echo "==> Building and starting app..."
export PUBLIC_URL
run_script "$DEPLOY_DIR/scripts/setup-app.sh"

echo ""
echo "Done. Open: ${PUBLIC_URL}"
