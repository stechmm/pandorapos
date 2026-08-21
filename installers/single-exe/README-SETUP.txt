Pandora POS Full Setup.exe
==========================

This installer is for the main Windows POS computer.

What it installs:
- Pandora POS app files to C:\PandoraPOS
- Local Pandora POS server for the full system
- Desktop shortcut: Pandora POS Full System
- Start Menu shortcuts for POS, server restart, and XP-58 test slip
- Print agent startup shortcut for automatic kitchen printing
- XP-58 printer queue named: Pandora XP-58
- A small XP-58 test print after setup

How to use:
1. Copy Pandora_POS_Full_Setup.exe to the main POS computer.
2. Right-click and choose Run as administrator.
3. Allow the Windows UAC prompt.
4. Keep the XP-58 printer connected and powered on during setup.
5. Open Pandora POS Full System from the Desktop shortcut.

Notes:
- The POS launcher starts the local server and opens http://localhost:4173 with browser silent printing enabled.
- Tablets/phones should connect to the main POS computer's local network address when used in the same shop.
- The printer setup uses the bundled XP-58 setup script and falls back to Windows Generic / Text Only if no vendor driver is available.
- If you later provide an official XP-58 INF driver folder, it can be bundled into this Setup.exe package.
