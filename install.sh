#!/usr/bin/env bash
# Unity-Antigravity-MCP — One-Line Installer for macOS / Linux
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/QuangVinh-coder/Unity-Antigravity-MCP/main/install.sh | bash
#   ./install.sh --init-multi-agent /path/to/your/unity-project

set -euo pipefail

REPO_URL="https://github.com/QuangVinh-coder/Unity-Antigravity-MCP.git"
INSTALL_DIR="${HOME}/.gemini/config/plugins/unity-antigravity-mcp"
INIT_MULTI_AGENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --init-multi-agent)
      INIT_MULTI_AGENT="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "==> [1/4] Checking Node.js >= 18 & Git..."
command -v node >/dev/null 2>&1 || { echo "Error: Node.js >= 18 is required."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Error: Git is required."; exit 1; }

echo "==> [2/4] Installing plugin into: ${INSTALL_DIR}"
mkdir -p "$(dirname "${INSTALL_DIR}")"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" pull --ff-only
elif [[ -f "${INSTALL_DIR}/server/index.mjs" ]]; then
  echo "    Plugin directory already populated; updating config only."
else
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

echo "==> [3/4] Generating machine-specific mcp_config.json..."
sed "s|{{PLUGIN_DIR}}|${INSTALL_DIR}|g" "${INSTALL_DIR}/mcp_config.template.json" > "${INSTALL_DIR}/mcp_config.json"

echo "==> [4/4] Running self-test..."
node --test "${INSTALL_DIR}/server/test-mcp-server.mjs"

if [[ -n "${INIT_MULTI_AGENT}" ]]; then
  echo "==> [Bonus] Installing Multi-Agent Orchestrator Kit into: ${INIT_MULTI_AGENT}"
  cp -R "${INSTALL_DIR}/templates/multi-agent/.agents" "${INIT_MULTI_AGENT}/"
  cp -R "${INSTALL_DIR}/templates/multi-agent/Tools" "${INIT_MULTI_AGENT}/"
  if [[ ! -f "${INIT_MULTI_AGENT}/AGENTS.md" ]]; then
    cp "${INSTALL_DIR}/templates/multi-agent/AGENTS.template.md" "${INIT_MULTI_AGENT}/AGENTS.md"
  else
    cp "${INSTALL_DIR}/templates/multi-agent/AGENTS.template.md" "${INIT_MULTI_AGENT}/AGENTS.multi-agent.template.md"
  fi
fi

echo ""
echo "DONE! Next step inside Unity 6 Editor:"
echo "  Window > Package Manager > '+' > Install package from git URL:"
echo "  https://github.com/QuangVinh-coder/Unity-Antigravity-MCP.git?path=/unity-package"
