#!/usr/bin/env bash
# Configure custom domain + optional Let's Encrypt HTTPS on the KVM.
# Usage (on server): APP_DOMAIN=hq.yourcompany.com ./configure-domain.sh
#    or: ./configure-domain.sh hq.yourcompany.com
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bitsparx-hq}"
DOMAIN="${1:-${APP_DOMAIN:-}}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 your.domain.com"
  echo "   or: APP_DOMAIN=your.domain.com $0"
  exit 1
fi

# Strip protocol/path if passed by mistake
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

PUBLIC_URL="${PUBLIC_URL:-https://${DOMAIN}}"
USE_SSL="${USE_SSL:-auto}"
if [[ "$USE_SSL" == "auto" ]]; then
  USE_SSL="true"
  [[ "$PUBLIC_URL" != https://* ]] && USE_SSL="false"
fi

echo "==> Domain: ${DOMAIN}"
echo "==> Public URL: ${PUBLIC_URL}"

SERVER_NAMES="147.93.104.138 ${DOMAIN} www.${DOMAIN}"
sed "s|__SERVER_NAMES__|${SERVER_NAMES}|" \
  "${APP_DIR}/deploy/nginx/bitsparx-hq.conf" \
  > /etc/nginx/sites-available/bitsparx-hq

if [[ "$USE_SSL" == "true" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
  nginx -t
  systemctl reload nginx
  certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --redirect || certbot --nginx -d "${DOMAIN}" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --redirect
  PUBLIC_URL="https://${DOMAIN}"
else
  nginx -t
  systemctl reload nginx
fi

if [[ -f /etc/bitsparx-hq.env ]]; then
  CORS="${PUBLIC_URL},http://${DOMAIN},http://147.93.104.138"
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${CORS}|" /etc/bitsparx-hq.env
  if [[ "$PUBLIC_URL" == https://* ]]; then
    sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' /etc/bitsparx-hq.env
    grep -q COOKIE_SECURE /etc/bitsparx-hq.env || echo 'COOKIE_SECURE=true' >> /etc/bitsparx-hq.env
  fi
fi

echo "==> Rebuilding frontend for ${PUBLIC_URL}..."
cd "${APP_DIR}/frontend"
export REACT_APP_BACKEND_URL="${PUBLIC_URL}"
yarn build

systemctl restart bitsparx-api
systemctl reload nginx

echo ""
echo "Done. Open: ${PUBLIC_URL}"
