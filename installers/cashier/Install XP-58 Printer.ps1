param(
  [string]$PrinterName = "Pandora XP-58"
)

$ErrorActionPreference = "Stop"

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-PrinterName", "`"$PrinterName`""
  )
  exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:SourceRoot = $PSScriptRoot
$script:ToolsDir = Join-Path $SourceRoot "app\tools"
$script:LogoPath = Join-Path $SourceRoot "resources\logo.png"
$script:FeastPath = Join-Path $SourceRoot "resources\pandora-feast-hero.png"

function New-PrinterForm {
  $form = New-Object Windows.Forms.Form
  $form.Text = "Pandora XP-58 Printer Installer"
  $form.StartPosition = "CenterScreen"
  $form.Size = New-Object Drawing.Size(760, 470)
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.BackColor = [Drawing.Color]::FromArgb(248, 250, 252)

  $hero = New-Object Windows.Forms.Panel
  $hero.Dock = "Top"
  $hero.Height = 178
  $hero.BackColor = [Drawing.Color]::FromArgb(7, 25, 45)
  $form.Controls.Add($hero)

  if (Test-Path $FeastPath) {
    $food = New-Object Windows.Forms.PictureBox
    $food.Image = [Drawing.Image]::FromFile($FeastPath)
    $food.SizeMode = "Zoom"
    $food.Location = New-Object Drawing.Point(468, 0)
    $food.Size = New-Object Drawing.Size(292, 178)
    $hero.Controls.Add($food)
  }

  if (Test-Path $LogoPath) {
    $logo = New-Object Windows.Forms.PictureBox
    $logo.Image = [Drawing.Image]::FromFile($LogoPath)
    $logo.SizeMode = "Zoom"
    $logo.Location = New-Object Drawing.Point(30, 24)
    $logo.Size = New-Object Drawing.Size(72, 72)
    $hero.Controls.Add($logo)
  }

  $title = New-Object Windows.Forms.Label
  $title.Text = "XP-58 Receipt Printer"
  $title.ForeColor = [Drawing.Color]::White
  $title.Font = New-Object Drawing.Font("Segoe UI", 23, [Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object Drawing.Point(120, 28)
  $hero.Controls.Add($title)

  $subtitle = New-Object Windows.Forms.Label
  $subtitle.Text = "Setting up kitchen and cashier slip printing for Pandora Food House"
  $subtitle.ForeColor = [Drawing.Color]::FromArgb(220, 232, 246)
  $subtitle.Font = New-Object Drawing.Font("Segoe UI", 9.5, [Drawing.FontStyle]::Regular)
  $subtitle.AutoSize = $true
  $subtitle.Location = New-Object Drawing.Point(124, 78)
  $hero.Controls.Add($subtitle)

  $menuLine = New-Object Windows.Forms.Label
  $menuLine.Text = "Kitchen Ticket  •  Customer Receipt  •  Cashier Slip"
  $menuLine.ForeColor = [Drawing.Color]::FromArgb(245, 193, 57)
  $menuLine.Font = New-Object Drawing.Font("Segoe UI", 9.5, [Drawing.FontStyle]::Bold)
  $menuLine.AutoSize = $true
  $menuLine.Location = New-Object Drawing.Point(124, 108)
  $hero.Controls.Add($menuLine)

  $badge = New-Object Windows.Forms.Label
  $badge.Text = "Admin setup"
  $badge.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $badge.BackColor = [Drawing.Color]::FromArgb(240, 179, 35)
  $badge.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
  $badge.TextAlign = "MiddleCenter"
  $badge.Location = New-Object Drawing.Point(124, 138)
  $badge.Size = New-Object Drawing.Size(114, 28)
  $hero.Controls.Add($badge)

  $bodyTitle = New-Object Windows.Forms.Label
  $bodyTitle.Text = "Preparing XP-58 printer"
  $bodyTitle.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $bodyTitle.Font = New-Object Drawing.Font("Segoe UI", 15, [Drawing.FontStyle]::Bold)
  $bodyTitle.AutoSize = $true
  $bodyTitle.Location = New-Object Drawing.Point(32, 206)
  $form.Controls.Add($bodyTitle)

  $script:StatusLabel = New-Object Windows.Forms.Label
  $StatusLabel.Text = "Please connect and power on the XP-58 printer."
  $StatusLabel.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $StatusLabel.Font = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Regular)
  $StatusLabel.AutoSize = $false
  $StatusLabel.Location = New-Object Drawing.Point(34, 246)
  $StatusLabel.Size = New-Object Drawing.Size(690, 42)
  $form.Controls.Add($StatusLabel)

  $script:ProgressBar = New-Object Windows.Forms.ProgressBar
  $ProgressBar.Location = New-Object Drawing.Point(36, 306)
  $ProgressBar.Size = New-Object Drawing.Size(688, 20)
  $ProgressBar.Style = "Continuous"
  $form.Controls.Add($ProgressBar)

  $note = New-Object Windows.Forms.Label
  $note.Text = "This setup creates a Windows printer named Pandora XP-58. If no vendor driver exists, it can use Generic / Text Only as a fallback."
  $note.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $note.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Regular)
  $note.AutoSize = $false
  $note.Location = New-Object Drawing.Point(36, 346)
  $note.Size = New-Object Drawing.Size(688, 44)
  $form.Controls.Add($note)

  $script:CloseButton = New-Object Windows.Forms.Button
  $CloseButton.Text = "Close"
  $CloseButton.Enabled = $false
  $CloseButton.Location = New-Object Drawing.Point(624, 400)
  $CloseButton.Size = New-Object Drawing.Size(100, 32)
  $CloseButton.Add_Click({ $form.Close() })
  $form.Controls.Add($CloseButton)

  return $form
}

function Set-Step([int]$Percent, [string]$Text) {
  $ProgressBar.Value = [Math]::Min(100, [Math]::Max(0, $Percent))
  $StatusLabel.Text = $Text
  [Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 400
}

function Invoke-PrinterInstall {
  $installer = Join-Path $ToolsDir "install-xp58-windows.ps1"
  if (-not (Test-Path $installer)) {
    throw "Printer setup script was not found: $installer"
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -PrinterName $PrinterName -AllowGenericFallback -SetAsDefault
  if ($LASTEXITCODE -ne 0) {
    throw "Printer setup failed."
  }
}

function Invoke-TestPrint {
  $test = Join-Path $ToolsDir "print-xp58-test.ps1"
  if (Test-Path $test) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $test -PrinterName $PrinterName
  }
}

$form = New-PrinterForm
$form.Add_Shown({
  try {
    Set-Step 12 "Checking Windows printer tools..."
    Set-Step 30 "Searching XP-58 USB port and compatible driver..."
    Invoke-PrinterInstall
    Set-Step 72 "Printer queue created as '$PrinterName'."
    Set-Step 88 "Sending a small test print..."
    Invoke-TestPrint
    Set-Step 100 "XP-58 printer setup completed. Keep this printer powered on for auto-print."
    $CloseButton.Enabled = $true
    [Windows.Forms.MessageBox]::Show("XP-58 printer setup completed.`n`nPrinter name: $PrinterName`nA test slip was sent if the printer is connected.", "Pandora Printer Installer", "OK", "Information") | Out-Null
  } catch {
    $StatusLabel.Text = "Printer setup failed: $($_.Exception.Message)"
    $CloseButton.Enabled = $true
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, "Pandora Printer Installer", "OK", "Error") | Out-Null
  }
})

[Windows.Forms.Application]::Run($form)
