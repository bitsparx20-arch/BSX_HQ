#!/usr/bin/env bash
# Run on the KVM as root — removes old stacks and frees disk.
set -euo pipefail

echo "==> Stopping old app services..."
systemctl stop bitsparx-api 2>/dev/null || true
systemctl disable bitsparx-api 2>/dev/null || true
systemctl stop apache2 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true

echo "==> Removing old containers and images..."
if command -v docker >/dev/null 2>&1; then
  docker rm -f $(docker ps -aq) 2>/dev/null || true
  docker system prune -af --volumes 2>/dev/null || true
fi

echo "==> Clearing old web roots..."
rm -rf /var/www/html/* /var/www/bitsparx* 2>/dev/null || true
rm -rf /opt/bitsparx-hq /opt/emergent* /app 2>/dev/null || true

echo "==> Resetting nginx site config..."
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/bitsparx-hq 2>/dev/null || true

echo "==> Apt cleanup..."
export DEBIAN_FRONTEND=noninteractive
apt-get autoremove -y -qq 2>/dev/null || true
apt-get clean -qq 2>/dev/null || true

df -h /
echo "==> KVM clean complete."
