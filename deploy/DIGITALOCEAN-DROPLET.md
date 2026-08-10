# Pandora POS DigitalOcean Droplet Deployment

This guide deploys Pandora POS to an Ubuntu Droplet with:

- Node.js app server on port 4173
- systemd service for auto-start and restart
- Nginx reverse proxy
- HTTPS via Certbot
- Persistent POS data in `/var/lib/pandora-pos`

## 1. Create Droplet

Recommended starting point:

- Ubuntu 24.04 LTS
- Basic plan, 1 GB RAM minimum, 2 GB better
- Singapore region for lower latency from Myanmar

## 2. Point Domain DNS

At Namecheap DNS:

- Type: `A`
- Host: `@` or `pos`
- Value: your Droplet public IP
- TTL: Automatic

Examples:

- `pandorapos.com` -> Droplet IP
- `pos.pandorapos.com` -> Droplet IP

Wait until DNS resolves before SSL setup.

## 3. Initial Server Setup

SSH into the Droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

Update server packages:

```bash
apt update
apt upgrade -y
apt install -y nginx git curl unzip ufw
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

## 4. Upload App

Option A: clone from GitHub:

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/stechmm/pandorapos.git pandora-pos
cd pandora-pos
```

Option B: upload the project zip, then unzip:

```bash
mkdir -p /var/www/pandora-pos
cd /var/www/pandora-pos
unzip /path/to/PandoraPOS-Production.zip
```

## 5. Create Persistent Data Directory

```bash
mkdir -p /var/lib/pandora-pos/backups
```

If `cloud-state.json` exists in the app folder and you want to use it as starting data:

```bash
cp /var/www/pandora-pos/cloud-state.json /var/lib/pandora-pos/cloud-state.json
cp /var/www/pandora-pos/cloud-state.json.bak /var/lib/pandora-pos/cloud-state.json.bak 2>/dev/null || true
```

Set ownership:

```bash
chown -R www-data:www-data /var/www/pandora-pos /var/lib/pandora-pos
```

## 6. Test App Manually

```bash
cd /var/www/pandora-pos
npm run check
PORT=4173 POS_DATA_DIR=/var/lib/pandora-pos node server.js
```

Open another SSH terminal and test:

```bash
curl http://127.0.0.1:4173/api/index.php?action=status
```

Stop the manual server with `Ctrl+C`.

## 7. Install systemd Service

Copy service file:

```bash
cp /var/www/pandora-pos/deploy/pandora-pos.service /etc/systemd/system/pandora-pos.service
systemctl daemon-reload
systemctl enable pandora-pos
systemctl start pandora-pos
systemctl status pandora-pos --no-pager
```

View logs:

```bash
journalctl -u pandora-pos -f
```

## 8. Configure Nginx

Copy Nginx config:

```bash
cp /var/www/pandora-pos/deploy/nginx-pandora-pos.conf /etc/nginx/sites-available/pandora-pos
```

Edit domain:

```bash
nano /etc/nginx/sites-available/pandora-pos
```

Replace:

```text
YOUR_DOMAIN_HERE
```

with your real domain, for example:

```text
pos.yourdomain.com
```

Enable site:

```bash
ln -s /etc/nginx/sites-available/pandora-pos /etc/nginx/sites-enabled/pandora-pos
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## 9. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

## 10. Add HTTPS

Install Certbot:

```bash
apt install -y certbot python3-certbot-nginx
```

Issue SSL:

```bash
certbot --nginx -d YOUR_DOMAIN_HERE
```

Test renewal:

```bash
certbot renew --dry-run
```

## 11. Final Checks

Open:

```text
https://YOUR_DOMAIN_HERE
```

Then test from:

- Cashier PC
- Waiter tablet
- Owner phone

All devices should use the same HTTPS URL.

## 12. Update Deployment

If using GitHub:

```bash
cd /var/www/pandora-pos
git pull
npm run check
systemctl restart pandora-pos
systemctl reload nginx
```

## Important Production Notes

- Change default admin/waiter/cashier passwords in Restaurant Settings.
- Keep regular backups of `/var/lib/pandora-pos/cloud-state.json`.
- For multi-shop SaaS sales later, migrate from JSON state to PostgreSQL.
- Thermal printer silent printing stays local to the cashier PC. Server hosting does not print directly to shop printers unless a local print bridge is running.
