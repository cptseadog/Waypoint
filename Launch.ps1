param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskPort = if ($env:PORT) { [int]$env:PORT } else { 4317 }
if ($taskPort -lt 1 -or $taskPort -gt 65535) { throw 'PORT must be 1–65535.' }
$taskUrl = "http://127.0.0.1:$taskPort"
try {
  $existing = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 2
  if ($existing.version -eq 1 -and $null -ne $existing.tasks) {
    if (-not $NoBrowser) { Start-Process $taskUrl }
    Write-Output "Waypoint is ready at $taskUrl"
    exit
  }
} catch {}
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Waypoint needs Node.js 24 or newer. Install Node.js, then run this launcher again.' }
$taskVersion = (& $taskNode --version).TrimStart('v').Split('.')[0]
if ([int]$taskVersion -lt 24) { throw 'Waypoint needs Node.js 24 or newer.' }
$taskPathsText = & $taskNode --preserve-symlinks --preserve-symlinks-main (Join-Path $taskRoot 'paths.cjs')
if ($LASTEXITCODE -ne 0) { throw 'The configured Waypoint data folder is unavailable.' }
$taskPaths = $taskPathsText | ConvertFrom-Json
$taskData = $taskPaths.logsDir
New-Item -ItemType Directory -Force -Path $taskData | Out-Null
$taskArguments = '--preserve-symlinks --preserve-symlinks-main "' + (Join-Path $taskRoot 'server.cjs') + '"'
$taskProcess = Start-Process -PassThru -FilePath $taskNode -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if ($taskProcess.HasExited) { break }
  Start-Sleep -Milliseconds 250
  try {
    $ready = Invoke-RestMethod -Uri "$taskUrl/api/state" -TimeoutSec 1
    if ($ready.version -eq 1 -and $null -ne $ready.tasks) {
      if (-not $NoBrowser) { Start-Process $taskUrl }
      Write-Output "Waypoint is ready at $taskUrl"
      exit
    }
  } catch {}
}
$taskErrorFile = Join-Path $taskData 'server-error.log'
$taskErrorDetails = if (Test-Path -LiteralPath $taskErrorFile) { Get-Content -LiteralPath $taskErrorFile -Raw } else { '' }
throw "Waypoint could not start.`n$taskErrorDetails`nLog: $taskErrorFile"
