$StartupPath = "$Env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AI Tool Launcher.lnk"
if (Test-Path $StartupPath) {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($StartupPath)
    Write-Host "Target: $($Shortcut.TargetPath)"
    Write-Host "Args: $($Shortcut.Arguments)"
}
else {
    Write-Host "Shortcut not found."
}
