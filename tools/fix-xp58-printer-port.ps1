param(
  [string]$PrinterName = "XP-58 (copy 1)",
  [string]$PortName = "USB003",
  [switch]$SetAsDefault
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script as Administrator."
  }
}

function Get-PrinterRegistryInfo {
  param([string]$Name)
  $path = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\$Name"
  if (-not (Test-Path $path)) {
    throw "Printer '$Name' was not found in Windows registry."
  }
  Get-ItemProperty $path
}

Assert-Admin

$printer = Get-PrinterRegistryInfo -Name $PrinterName
Write-Host "Printer:" $printer.Name
Write-Host "Driver :" $printer.'Printer Driver'
Write-Host "Current port:" $printer.Port
Write-Host "Target port :" $PortName

$portPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\USB Monitor\Ports\$PortName"
if (-not (Test-Path $portPath)) {
  throw "Port '$PortName' was not found. Plug in the printer USB cable and power on the printer, then run again."
}

Set-Printer -Name $PrinterName -PortName $PortName

if ($SetAsDefault) {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($PrinterName)
}

Restart-Service Spooler -Force
Start-Sleep -Seconds 2

$updated = Get-PrinterRegistryInfo -Name $PrinterName
Write-Host ""
Write-Host "Updated printer port:" $updated.Port
Write-Host "Done. Open Pandora POS > Restaurant Settings > Printers, refresh drivers, then select '$PrinterName'."
Write-Host "For a Windows test page, run: rundll32 printui.dll,PrintUIEntry /k /n `"$PrinterName`""
