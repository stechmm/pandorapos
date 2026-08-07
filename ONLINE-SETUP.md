# Pandora POS Online Setup

This build is now configured for online central sync.

## What Changed

- The frontend uses `api/index.php` on the same server it was loaded from.
- `OFFLINE_DEMO_MODE` is disabled.
- Login requires the central API server. Local fallback login is disabled to prevent device-only data.
- The Node server implements:
  - `GET api/index.php?action=status`
  - `POST api/index.php?action=login`
  - `POST api/index.php?action=logout`
  - `GET api/index.php?action=state`
  - `PUT api/index.php?action=state`
  - `GET api/index.php?action=events` for Server-Sent Events live updates
- Server state is stored in `cloud-state.json` for now. This is the central server store and can later be swapped for PostgreSQL/Supabase.

## Local Online Test

Run:

```powershell
cd outputs\pandora-pos-ui
node server.js
```

Open:

```text
http://localhost:4173
```

Default logins:

```text
admin / 1991
cashier / 1500
waiter / 1212
```

## Device Setup

For real online use, deploy this folder to a cloud server.

Every device opens the same hosted URL:

```text
Cashier PC  -> https://your-pos-domain.com
Waiter Tab  -> https://your-pos-domain.com
Kitchen KDS -> https://your-pos-domain.com
```

All devices read/write the same central API state, so orders, table status, KDS, inventory, expenses, and reports update from one shared source.

## Production Next Step

The current server is a central JSON-backed API. It is enough to prove online sync and live device connection.

For production, replace `cloud-state.json` with a real database:

- PostgreSQL or Supabase
- Row-level tables for orders, tables, products, inventory, expenses, payments, and users
- Per-action APIs instead of whole-state writes
- Audit logs and role-based permissions

