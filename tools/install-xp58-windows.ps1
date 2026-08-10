param(
  [string]$PrinterName = "Pandora XP-58",
  [string]$PortName = "Auto",
  [string]$DriverName = "Auto",
  [switch]$SetAsDefault,
  [switch]$AllowGenericFallback
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run Windows PowerShell as Administrator, then run this script again."
  }
}

function Get-UsbPrinterPorts {
  $root = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports"
  if (-not (Test-Path $root)) { return @() }

  Get-ChildItem $root | ForEach-Object {
    $portProps = Get-ItemProperty $_.PSPath
    $devicePath = $portProps.'Device Path'
    $deviceParams = $null

    if ($devicePath -match "usb#([^#]+)#([^#]+)#") {
      $instance = ($matches[1] + "\" + $matches[2]).ToUpper()
      $usbPrintRoot = "HKLM:\SYSTEM\CurrentControlSet\Enum\USBPRINT"
      if (Test-Path $usbPrintRoot) {
        $deviceParams = Get-ChildItem $usbPrintRoot -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.PSPath.ToUpper().Contains($matches[2].ToUpper()) -and $_.PSChildName -eq "Device Parameters" } |
          Select-Object -First 1 |
          ForEach-Object { Get-ItemProperty $_.PSPath }
      }
    }

    [pscustomobject]@{
      PortName = $_.PSChildName
      DevicePath = $devicePath
      PrinterName = if ($deviceParams) { $deviceParams.PrinterName } else { "" }
      IppStartTime = $portProps.IppStartTime
      UsbPrintOnly = $portProps.'UsbPrint Only'
    }
  } | Sort-Object IppStartTime -Descending
}

function Select-Xp58Port {
  $ports = @(Get-UsbPrinterPorts)
  if ($ports.Count -eq 0) {
    throw "No USB printer port was found. Power on XP-58 and connect the USB cable."
  }

  $preferred = $ports | Where-Object {
    $_.PrinterName -match "XP|Xprinter|58|POS|Receipt|Thermal|Printer"
  } | Select-Object -First 1

  if ($preferred) { return $preferred.PortName }
  return $ports[0].PortName
}

function Select-Xp58Driver {
  $drivers = @(Get-PrinterDriver -ErrorAction Stop | Select-Object -ExpandProperty Name)
  if ($DriverName -and $DriverName -ne "Auto") {
    if ($drivers -contains $DriverName) { return $DriverName }
    throw "Driver '$DriverName' was not found. Install the XP-58/Xprinter vendor driver first."
  }

  $preferred = $drivers | Where-Object {
    $_ -match "XP-?58|Xprinter|POS-?58|58.*Printer|Receipt"
  } | Select-Object -First 1

  if ($preferred) { return $preferred }

  if ($AllowGenericFallback -and ($drivers -contains "Generic / Text Only")) {
    return "Generic / Text Only"
  }

  throw "No XP-58 compatible driver was found. Install the XP-58/Xprinter Windows driver, or rerun with -AllowGenericFallback for English-only raw test printing."
}

Assert-Admin

$targetPort = if ($PortName -eq "Auto") { Select-Xp58Port } else { $PortName }
$targetDriver = Select-Xp58Driver

Write-Host "XP-58 setup"
Write-Host "Printer:" $PrinterName
Write-Host "Driver :" $targetDriver
Write-Host "Port   :" $targetPort

$existing = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($existing) {
  Set-Printer -Name $PrinterName -DriverName $targetDriver -PortName $targetPort
} else {
  Add-Printer -Name $PrinterName -DriverName $targetDriver -PortName $targetPort
}

if ($SetAsDefault) {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($PrinterName)
}

Restart-Service Spooler -Force
Start-Sleep -Seconds 2

$updated = Get-Printer -Name $PrinterName
Write-Host ""
Write-Host "Ready:"
Write-Host "  Name   :" $updated.Name
Write-Host "  Driver :" $updated.DriverName
Write-Host "  Port   :" $updated.PortName
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Open Pandora POS > Restaurant Settings > Printers."
Write-Host "  2. Refresh printer drivers."
Write-Host "  3. Select '$PrinterName'."
Write-Host "  4. Run tools\print-xp58-test.ps1 -PrinterName `"$PrinterName`" to test the hardware."
