Pandora POS Setup.exe
=====================

This installer is for a Windows cashier computer.

What it installs:
- Pandora POS app files to C:\PandoraPOS
- Desktop shortcut: Pandora POS Cashier
- Start Menu shortcut: Pandora POS Cashier
- Print agent startup shortcut for automatic kitchen printing
- XP-58 printer queue named: Pandora XP-58
- A small XP-58 test print after setup

How to use:
1. Copy Pandora_POS_Setup.exe to the cashier computer.
2. Right-click and choose Run as administrator.
3. Allow the Windows UAC prompt.
4. Keep the XP-58 printer connected and powered on during setup.
5. Open Pandora POS Cashier from the Desktop shortcut.

Notes:
- The cashier launcher opens the live POS server with browser silent printing enabled.
- The printer setup uses the bundled XP-58 setup script and falls back to Windows Generic / Text Only if no vendor driver is available.
- If you later provide an official XP-58 INF driver folder, it can be bundled into this Setup.exe package.
