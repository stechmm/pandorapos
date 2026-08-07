# Pandora POS Production Status

Production mode changes applied:

- Login bypass is disabled.
- The app requires the online POS server session before staff can use protected screens.
- Client-side hardcoded fallback login is removed.
- Payment methods are fixed to Cash, KPAY, and MMQR.
- User Management is inside Restaurant Settings.
- User passwords are no longer displayed in the User Management list.
- External Firebase realtime scripts are removed; same-origin server SSE and polling handle live updates.
- Server state writes are atomic and keep `cloud-state.json.bak` as a backup.

Current server API:

- `GET /api/index.php?action=status`
- `POST /api/index.php?action=login`
- `POST /api/index.php?action=logout`
- `GET /api/index.php?action=state`
- `PUT /api/index.php?action=state`
- `GET /api/index.php?action=events`

Production test checklist:

- Run `npm run check`
- Run `npm run smoke:links`
- Open cashier PC and waiter tablet on the same online server URL.
- Login with an admin user, then immediately change default passwords in Restaurant Settings.
- Create one test order from tablet and confirm it appears on the cashier PC and KDS.
- Complete payment and confirm dashboard, inventory, and expense totals update correctly.
- Export a backup after test setup.
