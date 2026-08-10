param(
  [string]$PrinterName = "Pandora XP-58",
  [switch]$OpenDrawer,
  [switch]$CutPaper
)

$ErrorActionPreference = "Stop"

$rawPrinterCode = @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

        try
        {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Pandora POS XP-58 Test";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                try
                {
                    int written;
                    if (!WritePrinter(hPrinter, bytes, bytes.Length, out written) || written != bytes.Length)
                        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
"@

Add-Type -TypeDefinition $rawPrinterCode

if (-not (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue)) {
  throw "Printer '$PrinterName' was not found."
}

$enc = [System.Text.Encoding]::ASCII
$bytes = New-Object System.Collections.Generic.List[byte]

function Add-Bytes([byte[]]$value) {
  foreach ($b in $value) { $script:bytes.Add($b) }
}

function Add-Text([string]$text) {
  Add-Bytes $enc.GetBytes($text)
}

Add-Bytes ([byte[]](0x1B, 0x40))              # ESC @ initialize
Add-Bytes ([byte[]](0x1B, 0x61, 0x01))        # center
Add-Text "PANDORA POS`n"
Add-Text "XP-58 TEST PRINT`n"
Add-Text "------------------------------`n"
Add-Bytes ([byte[]](0x1B, 0x61, 0x00))        # left
Add-Text "Printer : $PrinterName`n"
Add-Text "Date    : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"
Add-Text "Width   : 58mm`n"
Add-Text "Status  : Raw ESC/POS OK`n"
Add-Text "------------------------------`n"
Add-Text "Item              Qty   Amount`n"
Add-Text "Chicken Noodle     1     5000`n"
Add-Text "Coca Cola          2     5000`n"
Add-Text "------------------------------`n"
Add-Bytes ([byte[]](0x1B, 0x61, 0x02))        # right
Add-Text "TOTAL       10000 MMK`n"
Add-Bytes ([byte[]](0x1B, 0x61, 0x01))        # center
Add-Text "`nThank you`n"
Add-Text "Pandora POS`n`n`n"

if ($OpenDrawer) {
  Add-Bytes ([byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA))
}

if ($CutPaper) {
  Add-Bytes ([byte[]](0x1D, 0x56, 0x42, 0x00))  # full cut if supported
}

[RawPrinter]::SendBytes($PrinterName, $bytes.ToArray())
Write-Host "Raw XP-58 test print sent to '$PrinterName'."
