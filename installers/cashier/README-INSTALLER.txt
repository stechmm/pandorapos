Pandora POS Cashier Installer Package
=====================================

This package is for a cashier Windows PC.

Install order
-------------
1. Run "Install Pandora POS Cashier.bat".
   This installs the cashier launcher, local print agent, shortcuts, and startup item.

2. Run "Install XP-58 Printer.bat".
   This sets up the Windows printer queue as "Pandora XP-58" and sends a test print.
   The printer installer asks for Administrator permission.

What the cashier uses
---------------------
After installation, use the Desktop shortcut:
  Pandora POS Cashier

The shortcut opens the live POS server and starts the local print agent.

Tablet workflow
---------------
Waiter tablets open the live POS URL.
When an order is sent to kitchen, the cashier PC print agent prints the ticket.
The tablet does not need a printer driver.

Notes
-----
- Keep the XP-58 printer powered on and connected by USB to the cashier PC.
- Keep Chrome or Microsoft Edge installed.
- If no vendor XP-58 driver is installed, the setup can use Generic / Text Only.
- For Myanmar receipt text, install Myanmar Text or Noto Sans Myanmar on Windows.
