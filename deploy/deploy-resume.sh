#!/usr/bin/env bash
# Resume deploy after clean/install (skips KVM clean + apt install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/deploy"
SERVER="${DEPLOY_SERVER:-root@147.93.104.138}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/bitsparx-hq}"
PUBLIC_URL="${PUBLIC_URL:-http://147.93.104.138}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/bitsparx20-arch/BSX_HQ.git}"
CONTROL="${SSH_CONTROL:-/tmp/bitsparx-ssh-$$}"

[[ -n "${SSHPASS:-}" ]] || { echo "Set SSHPASS"; exit 1; }

export SSH_HOST="$SERVER" SSH_CONTROL="$CONTROL" SSHPASS
chmod +x "$DEPLOY_DIR/ssh-master.exp"
SSH_BASE=(ssh -S "$CONTROL" -o StrictHostKeyChecking=accept-new "$SERVER")
cleanup() { "${SSH_BASE[@]}" -O exit 2>/dev/null || true; rm -f "$CONTROL"; }
trap cleanup EXIT

"$DEPLOY_DIR/ssh-master.exp"
run_ssh() { "${SSH_BASE[@]}" "$@"; }
run_script() { "${SSH_BASE[@]}" bash -s < "$1"; }

echo "==> Finishing apt install if needed..."
run_script "$DEPLOY_DIR/scripts/install-deps.sh"

echo "==> Git pull..."
run_ssh "mkdir -p ${APP_DIR} && if [ -d ${APP_DIR}/.git ]; then cd ${APP_DIR} && git fetch origin && git reset --hard origin/main; else git clone ${GITHUB_REPO} ${APP_DIR}; fi"

if [[ -f "$ROOT/backend/.env" ]]; then
  echo "==> Uploading secrets..."
  scp -o ControlPath="$CONTROL" -o StrictHostKeyChecking=no \
    "$ROOT/backend/.env" "${SERVER}:/etc/bitsparx-hq.env"
  run_ssh "sed -i 's|CORS_ORIGINS=.*|CORS_ORIGINS=${PUBLIC_URL}|' /etc/bitsparx-hq.env; grep -q COOKIE_SECURE /etc/bitsparx-hq.env || echo COOKIE_SECURE=false >> /etc/bitsparx-hq.env"
fi

export PUBLIC_URL
run_script "$DEPLOY_DIR/scripts/setup-app.sh"
echo "Done: ${PUBLIC_URL}"
