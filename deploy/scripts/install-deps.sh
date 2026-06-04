#!/usr/bin/env bash
# Install runtime dependencies on Ubuntu/Debian KVM.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

wait_for_apt() {
  for i in $(seq 1 60); do
    if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
       && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
      return 0
    fi
    echo "Waiting for apt lock (${i}/60)..."
    sleep 5
  done
  echo "apt lock timeout" >&2
  return 1
}

wait_for_apt
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl git nginx python3 python3-venv python3-pip \
  build-essential rsync

# Node.js 20 LTS
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

npm install -g yarn@1.22.22

# Docker (for MongoDB)
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
fi

systemctl enable nginx
systemctl start nginx

echo "==> Dependencies installed."
node -v
python3 --version
docker --version
nginx -v
