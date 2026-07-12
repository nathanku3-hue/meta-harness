# D071 trusted validation program (parent-local, hashed at controller construction).
# Proves missing / valid / corrupt branches of CheckShortcut.ps1.
# networkPolicy: denied is trust-based (no network ops here); not OS firewall isolation.
param(
    [Parameter(Mandatory = $true)]
    [string]$SubjectPath
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    [Console]::Error.WriteLine("D071_VALIDATION_FAIL: $Message")
    exit 1
}

function Invoke-Subject {
    param(
        [Parameter(Mandatory = $true)][string]$SubjectAbs,
        [Parameter(Mandatory = $true)][string]$StartupPath
    )
    # Windows PowerShell 5.1: use Arguments string (ArgumentList is .NET Core only).
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Join-Path $PSHOME "powershell.exe")
    $qSubject = '"' + ($SubjectAbs -replace '"', '`"') + '"'
    $qStartup = '"' + ($StartupPath -replace '"', '`"') + '"'
    $psi.Arguments = @(
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", $qSubject,
        "-StartupPath", $qStartup
    ) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $p.ExitCode
        StdOut   = $stdout
        StdErr   = $stderr
    }
}

function Parse-OneJsonObject([string]$Text) {
    $trimmed = $Text.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        Fail "empty subject stdout"
    }
    try {
        $obj = $trimmed | ConvertFrom-Json
    }
    catch {
        Fail "subject stdout is not JSON: $($_.Exception.Message)"
    }
    if ($null -eq $obj) {
        Fail "subject JSON is null"
    }
    $names = @($obj.PSObject.Properties.Name)
    $required = @("found", "startup_path", "target_path", "arguments", "working_directory")
    foreach ($k in $required) {
        if ($names -notcontains $k) {
            Fail "JSON missing field '$k'"
        }
    }
    if ($names.Count -ne 5) {
        Fail "JSON must have exactly five fields; got $($names.Count)"
    }
    return $obj
}

function Assert-NullOrEmpty([object]$Value, [string]$Field) {
    if ($null -eq $Value) { return }
    if ($Value -is [string] -and $Value.Length -eq 0) { return }
    Fail "field '$Field' must be null or empty string for missing shortcut; got $($Value | Out-String)"
}

function Paths-Equal([string]$Left, [string]$Right) {
    if ($null -eq $Left -or $null -eq $Right) { return $false }
    try {
        $a = [System.IO.Path]::GetFullPath($Left)
        $b = [System.IO.Path]::GetFullPath($Right)
    }
    catch {
        return ($Left -eq $Right)
    }
    return $a.Equals($b, [System.StringComparison]::OrdinalIgnoreCase)
}

$cwd = (Get-Location).Path
$subjectAbs = [System.IO.Path]::GetFullPath((Join-Path $cwd $SubjectPath))
if (-not (Test-Path -LiteralPath $subjectAbs)) {
    Fail "subject missing: $subjectAbs"
}

# --- Branch 1: missing shortcut ---
$missingPath = Join-Path $env:TEMP ("mh-d071-missing-" + [guid]::NewGuid().ToString("N") + ".lnk")
if (Test-Path -LiteralPath $missingPath) {
    Remove-Item -LiteralPath $missingPath -Force -ErrorAction SilentlyContinue
}
$miss = Invoke-Subject -SubjectAbs $subjectAbs -StartupPath $missingPath
if ($miss.ExitCode -ne 0) {
    Fail "missing branch must exit 0; got $($miss.ExitCode) stderr=$($miss.StdErr)"
}
$missObj = Parse-OneJsonObject $miss.StdOut
if ($missObj.found -ne $false) {
    Fail "missing branch found must be false"
}
if (-not (Paths-Equal ([string]$missObj.startup_path) $missingPath)) {
    Fail "missing branch startup_path must equal requested path (got='$($missObj.startup_path)' want='$missingPath')"
}
Assert-NullOrEmpty $missObj.target_path "target_path"
Assert-NullOrEmpty $missObj.arguments "arguments"
Assert-NullOrEmpty $missObj.working_directory "working_directory"

# --- Branch 2: valid shortcut (temp .lnk outside repo) ---
$validPath = Join-Path $env:TEMP ("mh-d071-valid-" + [guid]::NewGuid().ToString("N") + ".lnk")
$expectedTarget = Join-Path $env:SystemRoot "System32\cmd.exe"
$expectedArgs = "/c echo d071-valid"
$expectedWd = Join-Path $env:SystemRoot "System32"
try {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($validPath)
    $sc.TargetPath = $expectedTarget
    $sc.Arguments = $expectedArgs
    $sc.WorkingDirectory = $expectedWd
    $sc.Save()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sc) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) | Out-Null

    $ok = Invoke-Subject -SubjectAbs $subjectAbs -StartupPath $validPath
    if ($ok.ExitCode -ne 0) {
        Fail "valid branch must exit 0; got $($ok.ExitCode) stderr=$($ok.StdErr)"
    }
    $okObj = Parse-OneJsonObject $ok.StdOut
    if ($okObj.found -ne $true) {
        Fail "valid branch found must be true"
    }
    if (-not (Paths-Equal ([string]$okObj.startup_path) $validPath)) {
        Fail "valid branch startup_path mismatch (got='$($okObj.startup_path)' want='$validPath')"
    }
    if (-not (Paths-Equal ([string]$okObj.target_path) $expectedTarget)) {
        Fail "valid branch target_path mismatch: $($okObj.target_path)"
    }
    if ([string]$okObj.arguments -ne $expectedArgs) {
        Fail "valid branch arguments mismatch: $($okObj.arguments)"
    }
    if (-not (Paths-Equal ([string]$okObj.working_directory) $expectedWd)) {
        Fail "valid branch working_directory mismatch: $($okObj.working_directory)"
    }
}
finally {
    if (Test-Path -LiteralPath $validPath) {
        Remove-Item -LiteralPath $validPath -Force -ErrorAction SilentlyContinue
    }
}

# --- Branch 3: corrupt / unreadable shortcut ---
$corruptPath = Join-Path $env:TEMP ("mh-d071-corrupt-" + [guid]::NewGuid().ToString("N") + ".lnk")
try {
    [System.IO.File]::WriteAllBytes($corruptPath, [byte[]](0x00, 0x01, 0x02, 0xFF, 0xFE))
    $bad = Invoke-Subject -SubjectAbs $subjectAbs -StartupPath $corruptPath
    if ($bad.ExitCode -eq 0) {
        Fail "corrupt branch must exit nonzero"
    }
    $trimmedBad = $bad.StdOut.Trim()
    if ($trimmedBad.Length -gt 0) {
        try {
            $maybe = $trimmedBad | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $maybe -and $maybe.PSObject.Properties.Name -contains "found") {
                Fail "corrupt branch must not emit success JSON"
            }
        }
        catch {
            # non-JSON stderr/stdout on failure is acceptable
        }
    }
}
finally {
    if (Test-Path -LiteralPath $corruptPath) {
        Remove-Item -LiteralPath $corruptPath -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "d071-validation-ok"
exit 0
