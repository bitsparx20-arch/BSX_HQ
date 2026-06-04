#!/usr/bin/env bash
# Configure app on server (after files are synced to /opt/bitsparx-hq).
set -euo pipefail

APP_DIR=/opt/bitsparx-hq
PUBLIC_URL="${PUBLIC_URL:-http://147.93.104.138}"
APP_DOMAIN="${APP_DOMAIN:-}"

nginx_server_names() {
  local names="147.93.104.138 _"
  if [[ -n "$APP_DOMAIN" ]]; then
    names="147.93.104.138 ${APP_DOMAIN} www.${APP_DOMAIN}"
  fi
  echo "$names"
}

cd "$APP_DIR"

echo "==> Starting MongoDB..."
docker compose -f deploy/docker-compose.yml up -d mongo
sleep 3

echo "==> Backend venv + dependencies..."
cd "$APP_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

if [[ ! -f /etc/bitsparx-hq.env ]]; then
  echo "WARNING: /etc/bitsparx-hq.env missing — copy deploy/env.production.example and edit secrets."
  cp "$APP_DIR/deploy/env.production.example" /etc/bitsparx-hq.env
  sed -i "s|http://147.93.104.138|${PUBLIC_URL}|g" /etc/bitsparx-hq.env
fi

echo "==> Frontend build..."
cd "$APP_DIR/frontend"
export REACT_APP_BACKEND_URL="${PUBLIC_URL}"
yarn install --frozen-lockfile 2>/dev/null || yarn install
yarn build

echo "==> Nginx + systemd..."
sed "s|__SERVER_NAMES__|$(nginx_server_names)|" \
  "$APP_DIR/deploy/nginx/bitsparx-hq.conf" > /etc/nginx/sites-available/bitsparx-hq
ln -sf /etc/nginx/sites-available/bitsparx-hq /etc/nginx/sites-enabled/bitsparx-hq
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

cp "$APP_DIR/deploy/systemd/bitsparx-api.service" /etc/systemd/system/bitsparx-api.service
systemctl daemon-reload
systemctl enable bitsparx-api
systemctl restart bitsparx-api

echo "==> Status:"
systemctl --no-pager status bitsparx-api | head -15
curl -sf "http://127.0.0.1:8000/api/auth/me" >/dev/null && echo "API reachable" || echo "API check skipped (auth required)"
echo "Deploy complete: ${PUBLIC_URL}"
