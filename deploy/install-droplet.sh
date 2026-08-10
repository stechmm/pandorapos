#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/pandora-pos}"
DATA_DIR="${POS_DATA_DIR:-/var/lib/pandora-pos}"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-4173}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/install-droplet.sh"
  exit 1
fi

if [ ! -f "server.js" ]; then
  echo "Run this script from the Pandora POS app folder that contains server.js."
  exit 1
fi

echo "==> Installing base packages"
apt update
apt install -y nginx git curl unzip ufw ca-certificates

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >/dev/null 2>&1; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "==> Preparing app and data directories"
mkdir -p "$APP_DIR" "$DATA_DIR/backups"

CURRENT_DIR="$(pwd)"
if [ "$CURRENT_DIR" != "$APP_DIR" ]; then
  rsync -a --delete \
    --exclude ".git" \
    --exclude "dist" \
    --exclude "backups" \
    --exclude "audit-log.jsonl" \
    "$CURRENT_DIR/" "$APP_DIR/"
fi

if [ -f "$APP_DIR/cloud-state.json" ] && [ ! -f "$DATA_DIR/cloud-state.json" ]; then
  cp "$APP_DIR/cloud-state.json" "$DATA_DIR/cloud-state.json"
fi

if [ -f "$APP_DIR/cloud-state.json.bak" ] && [ ! -f "$DATA_DIR/cloud-state.json.bak" ]; then
  cp "$APP_DIR/cloud-state.json.bak" "$DATA_DIR/cloud-state.json.bak"
fi

chown -R www-data:www-data "$APP_DIR" "$DATA_DIR"

echo "==> Checking app syntax"
cd "$APP_DIR"
npm run check

echo "==> Installing systemd service"
sed \
  -e "s#WorkingDirectory=/var/www/pandora-pos#WorkingDirectory=$APP_DIR#g" \
  -e "s#Environment=PORT=4173#Environment=PORT=$PORT#g" \
  -e "s#Environment=POS_DATA_DIR=/var/lib/pandora-pos#Environment=POS_DATA_DIR=$DATA_DIR#g" \
  -e "s#ExecStart=/usr/bin/node /var/www/pandora-pos/server.js#ExecStart=/usr/bin/node $APP_DIR/server.js#g" \
  "$APP_DIR/deploy/pandora-pos.service" > /etc/systemd/system/pandora-pos.service

systemctl daemon-reload
systemctl enable pandora-pos
systemctl restart pandora-pos

echo "==> Configuring Nginx"
if [ -n "$DOMAIN" ]; then
  SERVER_NAME="$DOMAIN"
else
  SERVER_NAME="_"
fi

sed "s/YOUR_DOMAIN_HERE/$SERVER_NAME/g" "$APP_DIR/deploy/nginx-pandora-pos.conf" > /etc/nginx/sites-available/pandora-pos
ln -sf /etc/nginx/sites-available/pandora-pos /etc/nginx/sites-enabled/pandora-pos
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

if [ -n "$DOMAIN" ]; then
  echo "==> Installing HTTPS certificate for $DOMAIN"
  apt install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || {
    echo "SSL setup failed. Check DNS points to this VPS, then run: certbot --nginx -d $DOMAIN"
  }
fi

echo ""
echo "Pandora POS deployment complete."
echo "Service: systemctl status pandora-pos --no-pager"
echo "Logs:    journalctl -u pandora-pos -f"
if [ -n "$DOMAIN" ]; then
  echo "Open:    https://$DOMAIN"
else
  echo "Open:    http://$(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
fi
