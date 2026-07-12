# D071 known-good CheckShortcut.ps1 implementation (ToolLauncher-shaped).
# Accepts optional -StartupPath; emits one compact JSON object; no network.
param(
    [string]$StartupPath = "$Env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AI Tool Launcher.lnk"
)

$ErrorActionPreference = "Stop"

function Write-Result {
    param(
        [bool]$Found,
        [string]$Startup,
        [AllowNull()][string]$Target,
        [AllowNull()][string]$Arguments,
        [AllowNull()][string]$WorkingDirectory
    )
    $obj = [ordered]@{
        found              = $Found
        startup_path       = $Startup
        target_path        = $Target
        arguments          = $Arguments
        working_directory  = $WorkingDirectory
    }
    # Compact single-line JSON for deterministic CLI use.
    $json = ($obj | ConvertTo-Json -Compress -Depth 3)
    [Console]::Out.WriteLine($json)
}

if (-not (Test-Path -LiteralPath $StartupPath)) {
    Write-Result -Found:$false -Startup $StartupPath -Target $null -Arguments $null -WorkingDirectory $null
    exit 0
}

try {
    $bytes = [System.IO.File]::ReadAllBytes($StartupPath)
}
catch {
    [Console]::Error.WriteLine("unreadable shortcut: $($_.Exception.Message)")
    exit 2
}

# Shell Link Binary File Format magic: 0x4C 0x00 at offset 0; minimum header size 76.
if ($bytes.Length -lt 76 -or $bytes[0] -ne 0x4C -or $bytes[1] -ne 0x00) {
    [Console]::Error.WriteLine("corrupt shortcut: invalid LNK header")
    exit 3
}

try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($StartupPath)
    $target = [string]$Shortcut.TargetPath
    $args = [string]$Shortcut.Arguments
    $wd = [string]$Shortcut.WorkingDirectory
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($Shortcut) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($WshShell) | Out-Null
}
catch {
    [Console]::Error.WriteLine("shortcut open failed: $($_.Exception.Message)")
    exit 4
}

Write-Result -Found:$true -Startup $StartupPath -Target $target -Arguments $args -WorkingDirectory $wd
exit 0
