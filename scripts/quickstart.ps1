$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker is required. Install Docker Desktop: https://www.docker.com/get-started"
  exit 1
}

# The supported implementation lives in setup.sh so the safety checks and
# Docker invocation stay identical on macOS, Linux, WSL, and Git Bash.
if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
  Write-Error "This Windows entry point delegates to scripts/setup.sh. Install Git for Windows (which includes Git Bash): https://git-scm.com/download/win, then run .\\scripts\\quickstart.ps1 again."
  exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& bash (Join-Path $ScriptDir "setup.sh") @args
exit $LASTEXITCODE
