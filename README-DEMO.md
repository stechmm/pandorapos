# Pandora POS Online-Ready Demo

This build has moved to online central sync. See `ONLINE-SETUP.md` for the current setup.

The old LAN demo notes below are kept only for launcher/testing context.

This demo runs on one PC and can be opened from phones/tablets on the same Wi-Fi.

## Start with EXE

1. Double-click `Pandora POS Demo.exe`.
2. The app starts the local demo server in the background and opens the PC browser automatically.
3. A small message box shows the phone URL and copies it to the clipboard.
4. On the phone, connect to the same Wi-Fi and open the phone URL.

## Start with Terminal

Use `start-demo.bat` only when you want to see server logs.

## Data

- Orders, tables, products, and categories are stored in `demo-state.json`.
- PC and phone share that file through the local demo server.
- No cloud/server upload is used.

## Notes

- Windows Firewall may ask for permission the first time. Allow private network access so the phone can connect.
- This is still a demo build, not the final production native PC/Android package.
