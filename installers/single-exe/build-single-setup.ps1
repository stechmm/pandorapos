param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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
[System.IO.File]::WriteAllText($setupPath, $setupText, [System.Text.Encoding]::UTF8)

$payloadZip = Join-Path $build "payload.zip"
if (Test-Path $payloadZip) {
  Remove-Item -LiteralPath $payloadZip -Force
}
Compress-Archive -Path (Join-Path $payload "*") -DestinationPath $payloadZip -CompressionLevel Optimal

$exePath = Join-Path $dist "Pandora_POS_Full_Setup_$stamp.exe"
$sedPath = Join-Path $build "Pandora_POS_Setup.sed"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
TargetNTVersion=0
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exePath
FriendlyName=Pandora POS Setup
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File Setup.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
FILE0=Setup.ps1
FILE1=payload.zip

[SourceFiles]
SourceFiles0=$build\

[SourceFiles0]
%FILE0%=
%FILE1%=

[Strings]
FILE0=Setup.ps1
FILE1=payload.zip
"@
Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

$iexpress = Join-Path $env:WINDIR "system32\iexpress.exe"
if (-not (Test-Path $iexpress)) {
  throw "IExpress was not found at $iexpress"
}

& $iexpress /N /Q $sedPath
if (-not (Test-Path $exePath)) {
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

  $csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $csc) {
    throw "IExpress did not create $exePath and .NET C# compiler was not found."
  }

  & $csc /nologo /target:winexe /platform:anycpu /reference:System.Windows.Forms.dll /out:$exePath /resource:"$setupPath,Setup.ps1" /resource:"$payloadZip,payload.zip" $bootstrapSource
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exePath)) {
    throw "Setup.exe build failed."
  }
}

$readme = Join-Path $dist "Pandora_POS_Full_Setup_README_$stamp.txt"
Copy-Item -LiteralPath (Join-Path $Root "installers\single-exe\README-SETUP.txt") -Destination $readme -Force

$zipPath = Join-Path $dist "Pandora_POS_Full_Setup_$stamp.zip"
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
