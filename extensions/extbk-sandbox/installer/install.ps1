# extbk-sandbox installer (Windows PowerShell)
# Run: powershell -ExecutionPolicy Bypass -File install.ps1
#
# Installs to %USERPROFILE%\.extbk-sandbox and adds a launcher to %USERPROFILE%\bin.

$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:USERPROFILE '.extbk-sandbox'
$BinDir     = Join-Path $env:USERPROFILE 'bin'

function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [ERR] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  extbk-sandbox installer" -ForegroundColor Cyan
Write-Host "  ----------------------------------------"

# ── Node.js check ─────────────────────────────────────────────────────────────
try {
    $nodeVer = node --version 2>$null
    if (-not $nodeVer) { throw }
    $major = [int]($nodeVer.TrimStart('v').Split('.')[0])
    if ($major -lt 18) { Write-Fail "Node.js >= 18 required (found $nodeVer)" }
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Fail "Node.js not found. Install from https://nodejs.org"
}

# ── Source directory ──────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir    = Split-Path -Parent $ScriptDir

if (-not (Test-Path (Join-Path $SrcDir 'src\index.js'))) {
    Write-Fail "Source not found. Run from inside the extbk-sandbox directory."
}

# ── Install directory ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installing to $InstallDir ..."

if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

# Copy source
Copy-Item (Join-Path $SrcDir 'src')          (Join-Path $InstallDir 'src')     -Recurse
Copy-Item (Join-Path $SrcDir 'package.json') (Join-Path $InstallDir 'package.json')

# Copy bundled React app if present
$appDir = Join-Path $SrcDir 'app'
if (Test-Path $appDir) {
    Copy-Item $appDir (Join-Path $InstallDir 'app') -Recurse
    Write-Ok "Bundled React app included"
} else {
    Write-Warn "No app/ directory — sandbox will run without preview pane"
}

# ── npm install ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Running npm install ..."
Push-Location $InstallDir
npm install --omit=dev --silent
Pop-Location
Write-Ok "Dependencies installed"

# ── Launcher batch file ───────────────────────────────────────────────────────
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$launcherPath = Join-Path $BinDir 'extbk-sandbox.cmd'
$launcherContent = "@echo off`r`nnode `"$InstallDir\src\index.js`" %*"
[System.IO.File]::WriteAllText($launcherPath, $launcherContent, [System.Text.Encoding]::ASCII)
Write-Ok "Launcher created: $launcherPath"

# ── PATH check ────────────────────────────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$BinDir", 'User')
    Write-Ok "Added $BinDir to user PATH (restart your terminal)"
} else {
    Write-Ok "$BinDir is already in PATH"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ----------------------------------------"
Write-Ok "extbk-sandbox installed!"
Write-Host ""
Write-Host "  Usage (restart terminal first):"
Write-Host "    extbk-sandbox .\my-extension"
Write-Host "    extbk-sandbox .\my-extension -p 4000"
Write-Host ""
