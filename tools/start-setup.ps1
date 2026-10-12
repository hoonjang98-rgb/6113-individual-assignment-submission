param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$serverPath = Join-Path $PSScriptRoot 'deploy_server.py'
$stateDirectory = Join-Path $projectRoot '.tmp'
$setupUrl = "http://127.0.0.1:$Port"
$artifactPath = Join-Path $projectRoot 'build\FreelancePay.json'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'The project Python environment is missing. Complete the README setup first.'
}
$expectedBuild = Get-Content -LiteralPath $artifactPath -Raw | ConvertFrom-Json

function Test-SetupReady {
    try {
        $actual = Invoke-RestMethod -Uri "$setupUrl/artifact" -TimeoutSec 3
        return ($actual.contractName -eq 'FreelancePay' -and $actual.sourceSha256 -eq $expectedBuild.sourceSha256)
    } catch {
        return $false
    }
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (Test-SetupReady) {
        [pscustomobject]@{ Status = 'Already running'; Url = $setupUrl; ProcessId = $listener[0].OwningProcess }
        return
    }
    throw "Port $Port is in use but is not serving the expected FreelancePay build. No process was stopped."
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$stdoutPath = Join-Path $stateDirectory 'setup-server.stdout.log'
$stderrPath = Join-Path $stateDirectory 'setup-server.stderr.log'
$arguments = @('-u', ('"' + $serverPath + '"'), '--port', $Port.ToString())
$serverProcess = Start-Process -FilePath $pythonPath -ArgumentList $arguments `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($serverProcess.HasExited) {
        throw 'The setup server exited. Check .tmp/setup-server.stderr.log.'
    }
    if (Test-SetupReady) {
        $record = [pscustomobject]@{
            Status = 'Running'; Url = $setupUrl; ProcessId = $serverProcess.Id
            StartedAt = [DateTime]::UtcNow.ToString('o'); SourceSha256 = $expectedBuild.sourceSha256
        }
        $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory 'setup-server-process.json') -Encoding utf8
        $record
        return
    }
    Start-Sleep -Milliseconds 200
}
throw 'The setup server did not become ready. Check .tmp/setup-server.stderr.log before retrying.'
