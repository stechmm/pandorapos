param(
  [string]$PrinterName = "Pandora XP-58",
  [switch]$RestartSpooler
)

$ErrorActionPreference = "Stop"

Write-Host "Clearing print jobs for '$PrinterName'..."

try {
  $jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue)
  foreach ($job in $jobs) {
    Remove-PrintJob -PrinterName $PrinterName -ID $job.ID -ErrorAction SilentlyContinue
  }
  Write-Host "Removed $($jobs.Count) queued job(s)."
} catch {
  Write-Host "Could not remove jobs through Get-PrintJob: $($_.Exception.Message)"
}

if ($RestartSpooler) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "RestartSpooler requires Windows PowerShell running as Administrator."
  }

  Write-Host "Restarting Print Spooler..."
  Stop-Service Spooler -Force
  Start-Sleep -Seconds 2

  $spoolPath = Join-Path $env:SystemRoot "System32\spool\PRINTERS"
  if (Test-Path $spoolPath) {
    Remove-Item (Join-Path $spoolPath "*") -Force -ErrorAction SilentlyContinue
  }

  Start-Service Spooler
  Write-Host "Print Spooler restarted."
}

Write-Host "Done. Power-cycle the printer, then try again with the vendor XP-58/Xprinter driver."
