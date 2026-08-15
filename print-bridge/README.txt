Pandora POS Local Print Bridge
==============================

Purpose
-------
When Pandora POS runs from DigitalOcean or another cloud server, the server cannot
see the receipt printer installed on the cashier computer. This small local bridge
runs on the cashier Windows PC and lets the POS web app print through the local
Windows printer driver.

Folder contents
---------------
bridge-server.js
  Local printer bridge and cashier print agent server.

Start Pandora Print Bridge.bat
  Double-click this before using Pandora POS printing.

print-agent-config.json
  Cashier auto-print settings. Set serverApiUrl to your live POS server API.

node.exe
  Optional bundled Node.js runtime. If this file is included, the PC does not need
  Node.js installed separately.

How to use on a cashier PC
--------------------------
1. Install the XP-58 printer driver on Windows.
2. If this folder does not include node.exe, install Node.js 20 LTS or newer.
3. Open Windows Settings > Bluetooth & devices > Printers & scanners.
4. Confirm the printer appears and can print a Windows test page.
5. Edit "print-agent-config.json" if your POS server URL is different.
6. Double-click "Start Pandora Print Bridge.bat".
7. Keep the black bridge window open.
8. Open Pandora POS in Chrome or Edge.
9. Go to Admin > Restaurant Settings > Printers.
10. Click Refresh Printers and select the local printer.
11. Print a Kitchen Ticket or Customer Receipt.

Tablet auto-print workflow
--------------------------
1. Keep this bridge running on the cashier PC.
2. Waiter tablet opens the live Pandora POS URL.
3. Waiter confirms or sends an order to kitchen.
4. The POS server stores a pending print job.
5. This bridge sees the pending job and prints from the cashier PC printer.

This means the tablet does not need a printer driver.

Important notes
---------------
- The bridge only listens on 127.0.0.1, so it is for the same cashier PC only.
- Auto-print talks outbound to the POS serverApiUrl in print-agent-config.json.
- If Chrome/Edge asks permission or popup/printing is blocked, allow it for the POS.
- The selected printer may be set as the Windows default printer while printing.
- Do not close the bridge window while printing.
- For best XP-58 stability, keep printer cut disabled if the adapter is weak.

Troubleshooting
---------------
No printer list:
  Start the bridge again, then click Refresh Printers in POS settings.

Print dialog still appears:
  Make sure the bridge window says "Listening on http://127.0.0.1:4788".

Print stops or printer powers off:
  This is usually power adapter/current related. Use the original adapter or a
  stronger compatible adapter.

Myanmar text is broken:
  Install a Myanmar-capable font such as Myanmar Text or Noto Sans Myanmar on
  the cashier PC, then restart Chrome/Edge.
