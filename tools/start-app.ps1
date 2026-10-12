param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$appPath = Join-Path $projectRoot 'app.py'
$recordPath = Join-Path $projectRoot 'docs\evidence\sepolia-deployment.json'
$stateDirectory = Join-Path $projectRoot '.tmp'
$appUrl = "http://127.0.0.1:$Port"

if (-not (Test-Path -LiteralPath $pythonPath) -or -not (Test-Path -LiteralPath $recordPath)) {
    throw 'The Python environment and verified Sepolia deployment record are required.'
}
$deployment = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$artifact = Get-Content -LiteralPath (Join-Path $projectRoot 'build\FreelancePay.json') -Raw | ConvertFrom-Json
$sourceHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot 'contracts\FreelancePay.sol') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($deployment.chainId -ne 11155111 -or $deployment.sourceSha256 -ne $sourceHash -or $artifact.sourceSha256 -ne $sourceHash) {
    throw 'The current source/build does not match the verified Sepolia deployment.'
}

function Test-AppReady {
    try {
        $actual = Invoke-RestMethod -Uri "$appUrl/api/config" -TimeoutSec 3
        return ($actual.configured -and $actual.chainId -eq '11155111' -and
            $actual.contractAddress -eq $deployment.contractAddress -and $actual.sourceSha256 -eq $sourceHash)
    } catch { return $false }
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (Test-AppReady) {
        [pscustomobject]@{ Status = 'Already running'; Url = $appUrl; ProcessId = $listener[0].OwningProcess }
        return
    }
    throw "Port $Port is occupied by another server. No process was stopped."
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$taskPreviousPort = $env:PORT
try {
    $env:PORT = $Port.ToString()
    $appProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-u', ('"' + $appPath + '"')) `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $stateDirectory 'app-server.stdout.log') `
        -RedirectStandardError (Join-Path $stateDirectory 'app-server.stderr.log')
} finally { $env:PORT = $taskPreviousPort }

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($appProcess.HasExited) { throw 'The application exited. Check .tmp/app-server.stderr.log.' }
    if (Test-AppReady) {
        $record = [pscustomobject]@{
            Status = 'Running'; Url = $appUrl; ProcessId = $appProcess.Id
            StartedAt = [DateTime]::UtcNow.ToString('o'); SourceSha256 = $sourceHash
            ContractAddress = $deployment.contractAddress
            Readiness = 'Matching public configuration; verify /api/health for current chain access.'
        }
        $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory 'app-server-process.json') -Encoding utf8
        $record
        return
    }
    Start-Sleep -Milliseconds 200
}
throw 'The application did not serve the expected configuration. Check .tmp/app-server.stderr.log.'
