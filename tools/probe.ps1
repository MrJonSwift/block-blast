param(
  [int]$Port = 8731,
  [int]$Passes = 1
)

# Drives the real app in headless Chrome at a set of phone/tablet viewports.
# Requires a static server; one is started here and stopped at the end.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = $null
$log = Join-Path $root '.serve.log'
$err = Join-Path $root '.serve.err'

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}

$chrome = Find-Chrome
if (-not $chrome) {
  Write-Error 'Chrome or Edge not found.'
  exit 1
}

$env:PORT = "$Port"
$server = Start-Process -FilePath 'node' -ArgumentList 'tools/serve.js' -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru

$base = "http://127.0.0.1:$Port"
$ready = $false
foreach ($attempt in 1..40) {
  Start-Sleep -Milliseconds 250
  try {
    if (Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 2 -Proxy $null) { $ready = $true; break }
  } catch {
    # keep waiting
  }
}
if (-not $ready) {
  Write-Error "server did not come up on $base"
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  exit 1
}

$basePort = ([regex]::Match((Get-Content $log -Raw), '127\.0\.0\.1:(\d+)')).Groups[1].Value
if ($basePort) { $base = "http://127.0.0.1:$basePort" }

$sizes = @(
  @(320, 568),   # iPhone SE
  @(390, 844),   # iPhone 14
  @(430, 932),   # iPhone Pro Max
  @(844, 390),   # phone landscape
  @(768, 1024),  # iPad portrait
  @(1024, 768),  # iPad landscape
  @(1180, 820)   # iPad Air landscape
)

$failed = 0
try {
  for ($pass = 1; $pass -le $Passes; $pass++) {
    foreach ($size in $sizes) {
      $w = $size[0]
      $h = $size[1]
      $dom = & $chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1400,1400 `
        --virtual-time-budget=40000 --dump-dom "$base/tests/probe.html?w=$w&h=$h" 2>$null | Out-String
      if ($dom -match '(?s)<pre id="report">(.*?)</pre>') {
        $report = $matches[1]
        $checks = ([regex]::Matches($report, '(?m)^(PASS|FAIL)')).Count
        $names = @()
        foreach ($m in [regex]::Matches($report, '(?m)^FAIL\s+(.+?)\s*\[')) { $names += $m.Groups[1].Value }
        $failed += $names.Count
        $status = if ($names.Count -eq 0) { 'ok  ' } else { 'FAIL' }
        Write-Host ("{0} pass {1} {2,4}x{3,-5} {4,2} checks  {5}" -f $status, $pass, $w, $h, $checks, ($names -join '; '))
      } else {
        $failed += 1
        Write-Host ("FAIL pass {0} {1,4}x{2,-5} no report" -f $pass, $w, $h)
      }
    }
  }
} finally {
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $log, $err -ErrorAction SilentlyContinue
}

if ($failed -gt 0) {
  Write-Host "`n$failed failing check(s)"
  exit 1
}
Write-Host "`nall viewports passed"
