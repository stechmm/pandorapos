# Pandora POS PC Local Edition

This package runs Pandora POS on one Windows computer without uploading data to a cloud server.

## Best Use

- Cashier PC runs the local POS server.
- Waiter phone/tablet can connect from the same Wi-Fi.
- Kitchen KDS can open the same local Wi-Fi URL.
- Data is stored on the cashier PC in `cloud-state.json`.

## Start The App

Recommended:

1. Install Node.js 20 or newer if it is not installed.
2. Double-click `Pandora POS.exe`.
3. The browser opens automatically at:

```text
http://localhost:4173
```

Alternative:

1. Double-click `Start Pandora POS.bat`.
2. This starts the same local server and opens the browser.

Silent print mode:

1. Set the Windows default printer to `Pandora XP-58`.
2. Keep `Cut paper after print` turned off in Pandora POS printer settings unless the printer has an auto cutter.
3. Double-click `Start Pandora POS Silent Print.bat`.

This opens Chrome/Edge with `--kiosk-printing`, so browser `window.print()` jobs go directly to the default printer without the print preview dialog.

## Phone / Tablet

Connect the phone/tablet to the same Wi-Fi as the cashier PC.

Open the Phone/Tablet URL shown by the launcher, for example:

```text
http://192.168.1.25:4173
```

If Windows Firewall asks for permission, allow access on Private networks.

## Default Logins

```text
admin / 1991
cashier / 1500
waiter / 1212
owner / 123
```

Change these passwords in Restaurant Settings before real use.

## Backup

Back up these files regularly:

```text
cloud-state.json
cloud-state.json.bak
```

These files contain the local POS data.

## Important

This PC Local Edition is good for one shop using one main computer.

For owner reports while traveling, multi-shop usage, or always-online remote access, deploy the app to a VPS/cloud server later.
