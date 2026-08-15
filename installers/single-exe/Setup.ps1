param(
  [string]$InstallDir = "C:\PandoraPOS",
  [string]$LivePosUrl = "http://167.172.79.75",
  [string]$ServerApiUrl = "http://167.172.79.75/api/index.php",
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
    "-InstallDir", "`"$InstallDir`"",
    "-LivePosUrl", "`"$LivePosUrl`"",
    "-ServerApiUrl", "`"$ServerApiUrl`"",
    "-PrinterName", "`"$PrinterName`""
  )
  exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:ExtractRoot = $PSScriptRoot
$script:PayloadZip = Join-Path $ExtractRoot "payload.zip"
$script:PayloadRoot = Join-Path $env:TEMP ("pandora-pos-payload-" + [Guid]::NewGuid().ToString("N"))
$script:AppSource = Join-Path $PayloadRoot "app"
$script:ResourceRoot = Join-Path $PayloadRoot "resources"
$script:LogoPath = Join-Path $ResourceRoot "logo.png"
$script:FeastPath = Join-Path $ResourceRoot "pandora-feast-hero.png"
$script:PrinterInstallOk = $false
$script:PrinterInstallMessage = ""

function New-InstallerForm {
  $form = New-Object Windows.Forms.Form
  $form.Text = "Pandora POS Setup"
  $form.StartPosition = "CenterScreen"
  $form.Size = New-Object Drawing.Size(860, 530)
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.BackColor = [Drawing.Color]::FromArgb(248, 250, 252)

  $hero = New-Object Windows.Forms.Panel
  $hero.Dock = "Top"
  $hero.Height = 210
  $hero.BackColor = [Drawing.Color]::FromArgb(8, 29, 52)
  $form.Controls.Add($hero)

  $script:FoodBox = New-Object Windows.Forms.PictureBox
  $FoodBox.SizeMode = "Zoom"
  $FoodBox.Location = New-Object Drawing.Point(540, 0)
  $FoodBox.Size = New-Object Drawing.Size(320, 210)
  $hero.Controls.Add($FoodBox)

  $veil = New-Object Windows.Forms.Panel
  $veil.BackColor = [Drawing.Color]::FromArgb(8, 29, 52)
  $veil.Location = New-Object Drawing.Point(514, 0)
  $veil.Size = New-Object Drawing.Size(34, 210)
  $hero.Controls.Add($veil)
  $veil.BringToFront()

  $script:LogoBox = New-Object Windows.Forms.PictureBox
  $LogoBox.SizeMode = "Zoom"
  $LogoBox.Location = New-Object Drawing.Point(32, 28)
  $LogoBox.Size = New-Object Drawing.Size(78, 78)
  $hero.Controls.Add($LogoBox)

  $title = New-Object Windows.Forms.Label
  $title.Text = "Pandora Food House"
  $title.ForeColor = [Drawing.Color]::White
  $title.Font = New-Object Drawing.Font("Segoe UI", 25, [Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object Drawing.Point(128, 28)
  $hero.Controls.Add($title)

  $subtitle = New-Object Windows.Forms.Label
  $subtitle.Text = "Cashier POS, auto kitchen printing, and XP-58 receipt setup"
  $subtitle.ForeColor = [Drawing.Color]::FromArgb(220, 232, 246)
  $subtitle.Font = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Regular)
  $subtitle.AutoSize = $true
  $subtitle.Location = New-Object Drawing.Point(132, 82)
  $hero.Controls.Add($subtitle)

  $menuLine = New-Object Windows.Forms.Label
  $menuLine.Text = "မာလာရှမ်းကော  •  မူကထ  •  ကြက်ကြော်  •  အအေးမျိုးစုံ"
  $menuLine.ForeColor = [Drawing.Color]::FromArgb(245, 193, 57)
  $menuLine.Font = New-Object Drawing.Font("Myanmar Text", 10, [Drawing.FontStyle]::Bold)
  $menuLine.AutoSize = $true
  $menuLine.Location = New-Object Drawing.Point(132, 115)
  $hero.Controls.Add($menuLine)

  $badge = New-Object Windows.Forms.Label
  $badge.Text = "One-click restaurant setup"
  $badge.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $badge.BackColor = [Drawing.Color]::FromArgb(240, 179, 35)
  $badge.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
  $badge.TextAlign = "MiddleCenter"
  $badge.Location = New-Object Drawing.Point(132, 154)
  $badge.Size = New-Object Drawing.Size(184, 30)
  $hero.Controls.Add($badge)

  $bodyTitle = New-Object Windows.Forms.Label
  $bodyTitle.Text = "Installing Pandora POS cashier station"
  $bodyTitle.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $bodyTitle.Font = New-Object Drawing.Font("Segoe UI", 15, [Drawing.FontStyle]::Bold)
  $bodyTitle.AutoSize = $true
  $bodyTitle.Location = New-Object Drawing.Point(34, 238)
  $form.Controls.Add($bodyTitle)

  $script:StatusLabel = New-Object Windows.Forms.Label
  $StatusLabel.Text = "Preparing setup..."
  $StatusLabel.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $StatusLabel.Font = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Regular)
  $StatusLabel.AutoSize = $false
  $StatusLabel.Location = New-Object Drawing.Point(36, 282)
  $StatusLabel.Size = New-Object Drawing.Size(780, 34)
  $form.Controls.Add($StatusLabel)

  $script:ProgressBar = New-Object Windows.Forms.ProgressBar
  $ProgressBar.Location = New-Object Drawing.Point(38, 328)
  $ProgressBar.Size = New-Object Drawing.Size(782, 22)
  $ProgressBar.Style = "Continuous"
  $form.Controls.Add($ProgressBar)

  $script:FeatureLabel = New-Object Windows.Forms.Label
  $FeatureLabel.Text = "Installing app files, desktop shortcut, startup print agent, live POS link, and XP-58 printer queue."
  $FeatureLabel.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $FeatureLabel.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Regular)
  $FeatureLabel.AutoSize = $false
  $FeatureLabel.Location = New-Object Drawing.Point(38, 370)
  $FeatureLabel.Size = New-Object Drawing.Size(782, 44)
  $form.Controls.Add($FeatureLabel)

  $script:HintLabel = New-Object Windows.Forms.Label
  $HintLabel.Text = "Tablet orders will print automatically from this cashier PC."
  $HintLabel.ForeColor = [Drawing.Color]::FromArgb(11, 87, 164)
  $HintLabel.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
  $HintLabel.AutoSize = $true
  $HintLabel.Location = New-Object Drawing.Point(38, 420)
  $form.Controls.Add($HintLabel)

  $script:CloseButton = New-Object Windows.Forms.Button
  $CloseButton.Text = "Close"
  $CloseButton.Enabled = $false
  $CloseButton.Location = New-Object Drawing.Point(720, 458)
  $CloseButton.Size = New-Object Drawing.Size(100, 32)
  $CloseButton.Add_Click({ $form.Close() })
  $form.Controls.Add($CloseButton)

  return $form
}

function Set-Step([int]$Percent, [string]$Text) {
  $ProgressBar.Value = [Math]::Min(100, [Math]::Max(0, $Percent))
  $StatusLabel.Text = $Text
  [Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 350
}

function Load-Images {
  if (Test-Path $LogoPath) {
    $LogoBox.Image = [Drawing.Image]::FromFile($LogoPath)
  }
  if (Test-Path $FeastPath) {
    $FoodBox.Image = [Drawing.Image]::FromFile($FeastPath)
  }
}

function Expand-Payload {
  if (-not (Test-Path $PayloadZip)) {
    throw "Installer payload was not found."
  }
  if (Test-Path $PayloadRoot) {
    Remove-Item -LiteralPath $PayloadRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $PayloadRoot | Out-Null
  Expand-Archive -LiteralPath $PayloadZip -DestinationPath $PayloadRoot -Force
}

function Copy-AppFiles {
  if (-not (Test-Path $AppSource)) {
    throw "App payload folder was not found."
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path (Join-Path $AppSource "*") -Destination $InstallDir -Recurse -Force
}

function Update-AgentConfig {
  $configPath = Join-Path $InstallDir "print-bridge\print-agent-config.json"
  if (-not (Test-Path $configPath)) { return }
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $config.autoPrint = $true
  $config.serverApiUrl = $ServerApiUrl
  $config.pollMs = 2000
  $config.station = "all"
  $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
}

function New-CashierLauncher {
  $launcher = Join-Path $InstallDir "Start Pandora Cashier.bat"
  $content = @"
@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0print-bridge\Start Pandora Print Bridge.bat" (
  start "Pandora Print Agent" /min "%~dp0print-bridge\Start Pandora Print Bridge.bat"
)

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  start "Pandora POS Cashier" "%BROWSER%" --kiosk-printing --new-window "$LivePosUrl"
) else (
  start "$LivePosUrl"
)

endlocal
"@
  Set-Content -Path $launcher -Value $content -Encoding ASCII
}

function New-Shortcut([string]$ShortcutPath, [string]$TargetPath, [string]$WorkingDir) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDir
  $iconPath = Join-Path $InstallDir "logo.png"
  if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
  $shortcut.Save()
}

function Install-Shortcuts {
  $launcher = Join-Path $InstallDir "Start Pandora Cashier.bat"
  $desktop = [Environment]::GetFolderPath("Desktop")
  $programs = [Environment]::GetFolderPath("Programs")
  $startMenuDir = Join-Path $programs "Pandora POS"
  New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
  New-Shortcut -ShortcutPath (Join-Path $desktop "Pandora POS Cashier.lnk") -TargetPath $launcher -WorkingDir $InstallDir
  New-Shortcut -ShortcutPath (Join-Path $startMenuDir "Pandora POS Cashier.lnk") -TargetPath $launcher -WorkingDir $InstallDir
}

function Install-Startup {
  $startupDir = [Environment]::GetFolderPath("Startup")
  $agentBat = Join-Path $InstallDir "print-bridge\Start Pandora Print Bridge.bat"
  if (Test-Path $agentBat) {
    New-Shortcut -ShortcutPath (Join-Path $startupDir "Pandora Print Agent.lnk") -TargetPath $agentBat -WorkingDir (Split-Path $agentBat)
  }
}

function Install-Xp58Printer {
  $installer = Join-Path $InstallDir "tools\install-xp58-windows.ps1"
  if (-not (Test-Path $installer)) {
    throw "Printer setup script was not found."
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -PrinterName $PrinterName -AllowGenericFallback -SetAsDefault
  $script:PrinterInstallOk = $true
}

function Send-TestPrint {
  $test = Join-Path $InstallDir "tools\print-xp58-test.ps1"
  if ((Test-Path $test) -and $PrinterInstallOk) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $test -PrinterName $PrinterName
  }
}

function Cleanup-Payload {
  try {
    if (Test-Path $PayloadRoot) {
      Remove-Item -LiteralPath $PayloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

$form = New-InstallerForm
$form.Add_Shown({
  try {
    Set-Step 5 "Opening Pandora Food House setup..."
    Set-Step 12 "Extracting installer package..."
    Expand-Payload
    Load-Images
    Set-Step 26 "Copying Pandora POS files to $InstallDir..."
    Copy-AppFiles
    Set-Step 42 "Configuring live POS server and print agent..."
    Update-AgentConfig
    Set-Step 54 "Creating cashier launcher..."
    New-CashierLauncher
    Set-Step 66 "Creating Desktop and Start Menu shortcuts..."
    Install-Shortcuts
    Set-Step 76 "Adding Print Agent to Windows startup..."
    Install-Startup
    Set-Step 84 "Setting up XP-58 receipt printer..."
    try {
      Install-Xp58Printer
      Set-Step 94 "Sending XP-58 test print..."
      Send-TestPrint
      $script:PrinterInstallMessage = "XP-58 printer setup completed."
    } catch {
      $script:PrinterInstallMessage = "Printer setup needs attention: $($_.Exception.Message)"
      Set-Step 94 "POS installed. Printer setup needs attention."
    }
    Set-Step 100 "Pandora POS setup completed."
    $CloseButton.Enabled = $true
    $message = "Pandora POS setup completed.`n`nInstall folder: $InstallDir`nDesktop shortcut: Pandora POS Cashier`n$PrinterInstallMessage"
    [Windows.Forms.MessageBox]::Show($message, "Pandora POS Setup", "OK", "Information") | Out-Null
  } catch {
    $StatusLabel.Text = "Install failed: $($_.Exception.Message)"
    $CloseButton.Enabled = $true
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, "Pandora POS Setup", "OK", "Error") | Out-Null
  } finally {
    Cleanup-Payload
  }
})

[Windows.Forms.Application]::Run($form)
