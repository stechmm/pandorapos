# XP-58 Printer Setup for Pandora POS

Pandora POS does not ship a Windows kernel driver. For XP-58/Xprinter thermal printers, use the vendor Windows driver or Windows Generic/Text driver, then let Pandora POS select the installed printer queue.

For Burmese receipts, use the XP-58/Xprinter vendor driver when possible. Generic/Text raw printing is useful for hardware testing, but it usually cannot print Myanmar Unicode correctly.

## Recommended Setup

1. Plug in the XP-58 printer USB cable and power on the printer.
2. Install the XP-58/Xprinter Windows driver from the printer vendor.
3. Open Windows PowerShell as Administrator.
4. Run:

```powershell
cd C:\Users\ST\Documents\Codex\2026-07-09\kd\outputs\pandora-pos-ui
.\tools\install-xp58-windows.ps1 -PrinterName "Pandora XP-58" -SetAsDefault
```

5. Test the hardware:

```powershell
.\tools\print-xp58-test.ps1 -PrinterName "Pandora XP-58"
```

6. Open Pandora POS > Restaurant Settings > Printers.
7. Click Refresh.
8. Select `Pandora XP-58`.
9. Keep `Cut paper after print` turned off unless your printer has a real auto cutter.

## If the Vendor Driver Is Not Installed

Do not use `-AllowGenericFallback` for XP-58 unless you are only diagnosing Windows printer queues. On some XP-58 units, a generic driver can print driver/status commands such as `OUT "Paperstart"` / `GetPapersize` as receipt text and keep printing.

If that happens:

1. Turn the printer off.
2. Clear the queue:

```powershell
.\tools\clear-printer-queue.ps1 -PrinterName "Pandora XP-58"
```

3. If the job is stuck, open Windows PowerShell as Administrator and run:

```powershell
.\tools\clear-printer-queue.ps1 -PrinterName "Pandora XP-58" -RestartSpooler
```

Only use the fallback queue for a short English-only raw test when you accept this risk:

```powershell
.\tools\install-xp58-windows.ps1 -PrinterName "Pandora XP-58" -AllowGenericFallback -SetAsDefault
.\tools\print-xp58-test.ps1 -PrinterName "Pandora XP-58"
```

Install the real XP-58/Xprinter driver before printing Burmese customer vouchers.

## Auto Cutter Safety

Many XP-58 printers do not have an auto cutter. Pandora POS keeps cutter commands off by default.

Do not enable this setting unless the printer specifically supports auto cut:

```text
Restaurant Settings > Printers > Cut paper after print
```

If a non-cutter XP-58 receives a cut command, it may stop printing, show a queue error, or power-cycle.

## Common Problem

If the printer exists but does not print, check the port.

Correct USB ports usually look like:

```text
USB001
USB002
USB003
```

Wrong port example:

```text
LPT1:
```

If a USB XP-58 is mapped to `LPT1:`, run the installer script again. It detects the USB printer port and updates the printer queue.

## Existing Printer Queue Fix

For this PC, the existing queue was:

```text
XP-58 (copy 1)
Driver: XP-58
Wrong port: LPT1:
Detected USB port: USB003
```

Fix:

```powershell
.\tools\fix-xp58-printer-port.ps1 -PrinterName "XP-58 (copy 1)" -PortName "USB003" -SetAsDefault
```

## Notes

- Browser mode can open the Windows print dialog.
- Silent direct printing requires a native desktop bridge.
- Raw ESC/POS printing is excellent for kitchen tickets and English hardware tests.
- Myanmar Unicode receipts should use GDI/browser printing or a rasterized native print bridge, because many 58mm ESC/POS printers do not support Myanmar fonts as text.
