# Unity-Antigravity-MCP — One-Line Installer for Windows (PowerShell)
# Cách chạy:
#   irm https://raw.githubusercontent.com/QuangVinh-coder/Unity-Antigravity-MCP/main/install.ps1 | iex
# Hoặc sau khi clone:
#   .\install.ps1
#   .\install.ps1 -InitMultiAgent "D:\Path\To\YourUnityProject"

param(
    [string]$RepoUrl = "https://github.com/QuangVinh-coder/Unity-Antigravity-MCP.git",
    [string]$InstallDir = (Join-Path $env:USERPROFILE ".gemini\config\plugins\unity-antigravity-mcp"),
    [string]$InitMultiAgent = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==> [1/4] Checking prerequisites (Node.js >= 18 & Git)..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js (>= 18) is required. Install from https://nodejs.org/"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required. Install from https://git-scm.com/"
}

Write-Host "==> [2/4] Installing plugin into: $InstallDir" -ForegroundColor Cyan
$parentDir = Split-Path -Parent $InstallDir
if (-not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "    Existing installation found. Pulling latest updates..." -ForegroundColor Yellow
    git -C $InstallDir pull --ff-only
} elseif ((Test-Path $InstallDir) -and (Test-Path (Join-Path $InstallDir "server\index.mjs"))) {
    Write-Host "    Plugin directory already populated; updating config only." -ForegroundColor Yellow
} else {
    git clone $RepoUrl $InstallDir
}

Write-Host "==> [3/4] Generating machine-specific mcp_config.json..." -ForegroundColor Cyan
$normalizedDir = $InstallDir.Replace("\", "/")
$templatePath = Join-Path $InstallDir "mcp_config.template.json"
$configPath = Join-Path $InstallDir "mcp_config.json"
if (Test-Path $templatePath) {
    $template = Get-Content -Path $templatePath -Raw -Encoding UTF8
    $rendered = $template.Replace("{{PLUGIN_DIR}}", $normalizedDir)
} else {
    $rendered = @"
{
  "mcpServers": {
    "unity_antigravity_mcp": {
      "command": "node",
      "args": [
        "$normalizedDir/server/index.mjs"
      ]
    }
  }
}
"@
}
[System.IO.File]::WriteAllText($configPath, $rendered, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> [4/4] Running self-test (node --test server/test-mcp-server.mjs)..." -ForegroundColor Cyan
& node --test (Join-Path $InstallDir "server\test-mcp-server.mjs")

if (-not [string]::IsNullOrWhiteSpace($InitMultiAgent)) {
    if (-not (Test-Path $InitMultiAgent)) {
        throw "Target Unity project path does not exist: $InitMultiAgent"
    }
    Write-Host "==> [Bonus] Installing Multi-Agent Orchestrator Kit into: $InitMultiAgent" -ForegroundColor Green
    $tplRoot = Join-Path $InstallDir "templates\multi-agent"
    Copy-Item (Join-Path $tplRoot ".agents") $InitMultiAgent -Recurse -Force
    Copy-Item (Join-Path $tplRoot "Tools") $InitMultiAgent -Recurse -Force
    $agentsDst = Join-Path $InitMultiAgent "AGENTS.md"
    if (-not (Test-Path $agentsDst)) {
        Copy-Item (Join-Path $tplRoot "AGENTS.template.md") $agentsDst
    } else {
        Write-Host "    AGENTS.md already exists in target project; template saved as AGENTS.multi-agent.template.md." -ForegroundColor Yellow
        Copy-Item (Join-Path $tplRoot "AGENTS.template.md") (Join-Path $InitMultiAgent "AGENTS.multi-agent.template.md") -Force
    }
}

Write-Host ""
Write-Host "DONE! Next step inside Unity 6 Editor:" -ForegroundColor Green
Write-Host "  Window > Package Manager > '+' > Install package from git URL:" -ForegroundColor White
Write-Host "  https://github.com/QuangVinh-coder/Unity-Antigravity-MCP.git?path=/unity-package" -ForegroundColor Yellow
