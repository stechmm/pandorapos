param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [ValidateSet("Local", "Cloud")]
  [string]$Mode = "Local",
  [string]$CloudUrl = "http://167.172.79.75"
)

$ErrorActionPreference = "Stop"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dist = Join-Path $Root "dist"
$build = Join-Path $dist "Pandora-Setup-Build-$stamp"
$payload = Join-Path $build "payload"
$appPayload = Join-Path $payload "app"
$resPayload = Join-Path $payload "resources"

New-Item -ItemType Directory -Force -Path $dist, $build, $appPayload, $resPayload | Out-Null

$excludeDirs = @(".git", "dist", "installers")
$items = Get-ChildItem -LiteralPath $Root -Force | Where-Object { $excludeDirs -notcontains $_.Name }
foreach ($item in $items) {
  Copy-Item -LiteralPath $item.FullName -Destination $appPayload -Recurse -Force
}

$node = (Get-Command node -ErrorAction Stop).Source
Copy-Item -LiteralPath $node -Destination (Join-Path $appPayload "node.exe") -Force

$logo = Join-Path $Root "logo.png"
if (Test-Path $logo) {
  Copy-Item -LiteralPath $logo -Destination (Join-Path $resPayload "logo.png") -Force
}

$websiteHero = Join-Path $Root "..\pandora-food-house-website\assets\pandora-feast-hero.png"
$fallbackHero = Join-Path $Root "restaurant_floor_bg.jpg"
if (Test-Path $websiteHero) {
  Copy-Item -LiteralPath $websiteHero -Destination (Join-Path $resPayload "pandora-feast-hero.png") -Force
} elseif (Test-Path $fallbackHero) {
  Copy-Item -LiteralPath $fallbackHero -Destination (Join-Path $resPayload "pandora-feast-hero.png") -Force
}

$setupSource = Join-Path $Root "installers\single-exe\Setup.ps1"
$setupPath = Join-Path $build "Setup.ps1"
Copy-Item -LiteralPath $setupSource -Destination $setupPath -Force
$setupText = Get-Content -Raw -LiteralPath $setupPath
if ($Mode -eq "Cloud") {
  $cloudApi = $CloudUrl.TrimEnd("/") + "/api/index.php"
  $setupText = $setupText.Replace('[string]$LivePosUrl = "http://localhost:4173"', ('[string]$LivePosUrl = "' + $CloudUrl.TrimEnd("/") + '"'))
  $setupText = $setupText.Replace('[string]$ServerApiUrl = "http://localhost:4173/api/index.php"', ('[string]$ServerApiUrl = "' + $cloudApi + '"'))
  $setupText = $setupText.Replace("Full local POS server, cashier/tablet workflow, auto printing, and XP-58 setup", "Cloud POS station, cashier/tablet workflow, auto printing, and XP-58 setup")
  $setupText = $setupText.Replace("Installing full Pandora POS system", "Installing Pandora POS cloud station")
  $setupText = $setupText.Replace("Installing local POS server, full app files, silent print launcher, print agent, and XP-58 printer queue.", "Installing full app files, cloud POS launcher, print agent, and XP-58 printer queue.")
  $setupText = $setupText.Replace("Use this PC as the local cashier/server station. Tablets and phones can connect to this PC on the same network.", "This station connects to the VPS POS server and keeps local XP-58 printing ready.")
  $setupText = $setupText.Replace("Configuring local POS server and print agent...", "Configuring cloud POS link and print agent...")
}
[System.IO.File]::WriteAllText($setupPath, $setupText, [System.Text.Encoding]::UTF8)

$payloadZip = Join-Path $build "payload.zip"
if (Test-Path $payloadZip) {
  Remove-Item -LiteralPath $payloadZip -Force
}
Compress-Archive -Path (Join-Path $payload "*") -DestinationPath $payloadZip -CompressionLevel Optimal

$packageName = if ($Mode -eq "Cloud") { "Pandora_POS_Cloud_Station_Setup" } else { "Pandora_POS_Full_Local_Setup" }
$exePath = Join-Path $dist "$packageName`_$stamp.exe"
$bootstrapSource = Join-Path $build "PandoraSetupBootstrapper.cs"
$bootstrapCode = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string tempRoot = Path.Combine(Path.GetTempPath(), "pandora-pos-setup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);
            WriteResource("Setup.ps1", Path.Combine(tempRoot, "Setup.ps1"));
            WriteResource("payload.zip", Path.Combine(tempRoot, "payload.zip"));

            string ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = ps;
            info.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(tempRoot, "Setup.ps1") + "\"";
            info.WorkingDirectory = tempRoot;
            info.UseShellExecute = true;

            Process process = Process.Start(info);
            if (process != null)
            {
                process.WaitForExit();
                return process.ExitCode;
            }
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Pandora POS Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void WriteResource(string resourceName, string outputPath)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream input = assembly.GetManifestResourceStream(resourceName))
        {
            if (input == null)
            {
                throw new InvalidOperationException("Missing installer resource: " + resourceName);
            }
            using (FileStream output = File.Create(outputPath))
            {
                input.CopyTo(output);
            }
        }
    }
}
'@
Set-Content -LiteralPath $bootstrapSource -Value $bootstrapCode -Encoding ASCII

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) {
  throw ".NET C# compiler was not found."
}

& $csc /nologo /target:winexe /platform:x86 /reference:System.Windows.Forms.dll /out:$exePath /resource:"$setupPath,Setup.ps1" /resource:"$payloadZip,payload.zip" $bootstrapSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exePath)) {
  throw "Setup.exe build failed."
}

$readme = Join-Path $dist "$packageName`_README_$stamp.txt"
Copy-Item -LiteralPath (Join-Path $Root "installers\single-exe\README-SETUP.txt") -Destination $readme -Force

$zipPath = Join-Path $dist "$packageName`_$stamp.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $exePath, $readme -DestinationPath $zipPath -CompressionLevel Optimal

[pscustomobject]@{
  Exe = $exePath
  ExeMB = [math]::Round((Get-Item $exePath).Length / 1MB, 2)
  Zip = $zipPath
  ZipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
  Build = $build
}
