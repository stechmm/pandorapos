param(
  [string]$InstallDir = "C:\PandoraPOS",
  [string]$LivePosUrl = "http://167.172.79.75",
  [string]$ServerApiUrl = "http://167.172.79.75/api/index.php"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:SourceRoot = $PSScriptRoot
$script:AppSource = Join-Path $SourceRoot "app"
$script:LogoPath = Join-Path $SourceRoot "resources\logo.png"
$script:FeastPath = Join-Path $SourceRoot "resources\pandora-feast-hero.png"

function New-InstallerForm {
  $form = New-Object Windows.Forms.Form
  $form.Text = "Pandora POS Cashier Installer"
  $form.StartPosition = "CenterScreen"
  $form.Size = New-Object Drawing.Size(820, 500)
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.BackColor = [Drawing.Color]::FromArgb(248, 250, 252)

  $hero = New-Object Windows.Forms.Panel
  $hero.Dock = "Top"
  $hero.Height = 190
  $hero.BackColor = [Drawing.Color]::FromArgb(9, 31, 55)
  $form.Controls.Add($hero)

  if (Test-Path $FeastPath) {
    $food = New-Object Windows.Forms.PictureBox
    $food.Image = [Drawing.Image]::FromFile($FeastPath)
    $food.SizeMode = "Zoom"
    $food.Location = New-Object Drawing.Point(520, 0)
    $food.Size = New-Object Drawing.Size(300, 190)
    $hero.Controls.Add($food)

    $fade = New-Object Windows.Forms.Panel
    $fade.BackColor = [Drawing.Color]::FromArgb(9, 31, 55)
    $fade.Location = New-Object Drawing.Point(500, 0)
    $fade.Size = New-Object Drawing.Size(30, 190)
    $hero.Controls.Add($fade)
    $fade.BringToFront()
  }

  if (Test-Path $LogoPath) {
    $logo = New-Object Windows.Forms.PictureBox
    $logo.Image = [Drawing.Image]::FromFile($LogoPath)
    $logo.SizeMode = "Zoom"
    $logo.Location = New-Object Drawing.Point(30, 24)
    $logo.Size = New-Object Drawing.Size(76, 76)
    $hero.Controls.Add($logo)
  }

  $title = New-Object Windows.Forms.Label
  $title.Text = "Pandora Food House"
  $title.ForeColor = [Drawing.Color]::White
  $title.Font = New-Object Drawing.Font("Segoe UI", 24, [Drawing.FontStyle]::Bold)
  $title.AutoSize = $true
  $title.Location = New-Object Drawing.Point(122, 25)
  $hero.Controls.Add($title)

  $subtitle = New-Object Windows.Forms.Label
  $subtitle.Text = "POS cashier setup for Mala, Mu Kratha, Fried Chicken and Drinks"
  $subtitle.ForeColor = [Drawing.Color]::FromArgb(220, 232, 246)
  $subtitle.Font = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Regular)
  $subtitle.AutoSize = $true
  $subtitle.Location = New-Object Drawing.Point(126, 78)
  $hero.Controls.Add($subtitle)

  $menuLine = New-Object Windows.Forms.Label
  $menuLine.Text = "မာလာရှမ်းကော  •  မူကထ  •  ကြက်ကြော်  •  အအေးမျိုးစုံ"
  $menuLine.ForeColor = [Drawing.Color]::FromArgb(245, 193, 57)
  $menuLine.Font = New-Object Drawing.Font("Myanmar Text", 10, [Drawing.FontStyle]::Bold)
  $menuLine.AutoSize = $true
  $menuLine.Location = New-Object Drawing.Point(126, 108)
  $hero.Controls.Add($menuLine)

  $badge = New-Object Windows.Forms.Label
  $badge.Text = "Cashier + Print Agent"
  $badge.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $badge.BackColor = [Drawing.Color]::FromArgb(240, 179, 35)
  $badge.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
  $badge.TextAlign = "MiddleCenter"
  $badge.Location = New-Object Drawing.Point(126, 142)
  $badge.Size = New-Object Drawing.Size(158, 30)
  $hero.Controls.Add($badge)

  $bodyTitle = New-Object Windows.Forms.Label
  $bodyTitle.Text = "Preparing restaurant workstation"
  $bodyTitle.ForeColor = [Drawing.Color]::FromArgb(19, 32, 51)
  $bodyTitle.Font = New-Object Drawing.Font("Segoe UI", 15, [Drawing.FontStyle]::Bold)
  $bodyTitle.AutoSize = $true
  $bodyTitle.Location = New-Object Drawing.Point(32, 218)
  $form.Controls.Add($bodyTitle)

  $script:StatusLabel = New-Object Windows.Forms.Label
  $StatusLabel.Text = "Preparing installer..."
  $StatusLabel.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $StatusLabel.Font = New-Object Drawing.Font("Segoe UI", 10, [Drawing.FontStyle]::Regular)
  $StatusLabel.AutoSize = $false
  $StatusLabel.Location = New-Object Drawing.Point(34, 258)
  $StatusLabel.Size = New-Object Drawing.Size(740, 34)
  $form.Controls.Add($StatusLabel)

  $script:ProgressBar = New-Object Windows.Forms.ProgressBar
  $ProgressBar.Location = New-Object Drawing.Point(36, 304)
  $ProgressBar.Size = New-Object Drawing.Size(736, 20)
  $ProgressBar.Style = "Continuous"
  $form.Controls.Add($ProgressBar)

  $features = New-Object Windows.Forms.Label
  $features.Text = "Installing: live POS shortcut, kitchen auto-print agent, XP-58 support tools, restaurant-ready cashier workflow."
  $features.ForeColor = [Drawing.Color]::FromArgb(88, 105, 128)
  $features.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Regular)
  $features.AutoSize = $false
  $features.Location = New-Object Drawing.Point(36, 346)
  $features.Size = New-Object Drawing.Size(736, 42)
  $form.Controls.Add($features)

  $hint = New-Object Windows.Forms.Label
  $hint.Text = "Tablet orders will print automatically from this cashier PC."
  $hint.ForeColor = [Drawing.Color]::FromArgb(11, 87, 164)
  $hint.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
  $hint.AutoSize = $true
  $hint.Location = New-Object Drawing.Point(36, 394)
  $form.Controls.Add($hint)

  $script:CloseButton = New-Object Windows.Forms.Button
  $CloseButton.Text = "Close"
  $CloseButton.Enabled = $false
  $CloseButton.Location = New-Object Drawing.Point(672, 414)
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

function Copy-AppFiles {
  if (-not (Test-Path $AppSource)) {
    throw "Installer app folder was not found: $AppSource"
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
  $shortcut.IconLocation = (Join-Path $InstallDir "logo.png")
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

$form = New-InstallerForm
$form.Add_Shown({
  try {
    Set-Step 10 "Checking installer files..."
    Set-Step 25 "Copying Pandora POS files to $InstallDir..."
    Copy-AppFiles
    Set-Step 48 "Configuring live server and print agent..."
    Update-AgentConfig
    Set-Step 65 "Creating cashier launcher..."
    New-CashierLauncher
    Set-Step 80 "Creating Desktop and Start Menu shortcuts..."
    Install-Shortcuts
    Set-Step 92 "Adding Print Agent to Windows startup..."
    Install-Startup
    Set-Step 100 "Pandora POS Cashier setup completed. Use the Desktop shortcut to start."
    $CloseButton.Enabled = $true
    [Windows.Forms.MessageBox]::Show("Pandora POS Cashier setup completed.`n`nDesktop shortcut: Pandora POS Cashier`nInstall folder: $InstallDir", "Pandora POS Installer", "OK", "Information") | Out-Null
  } catch {
    $StatusLabel.Text = "Install failed: $($_.Exception.Message)"
    $CloseButton.Enabled = $true
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, "Pandora POS Installer", "OK", "Error") | Out-Null
  }
})

[Windows.Forms.Application]::Run($form)
