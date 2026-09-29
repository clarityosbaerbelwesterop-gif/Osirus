#!/usr/bin/env bash
# Register the owner's server as a GitHub Actions runner for Rouge research.
#
#   RUNNER_TOKEN=<registration token> research/rouge-architecture/env/runner.sh
#
# The registration token comes from GitHub: repository Settings -> Actions ->
# Runners -> New self-hosted runner (it is valid for one hour). It is read from
# the environment only; never commit it or paste it into a workflow.
#
# Labels: self-hosted, rouge-research (+ gpu when an NVIDIA GPU is present).
# The research workflow sends tier 1 (CPU / Apple silicon) and tier 2 (GPU)
# experiments here; the experiment code and results format are identical to
# the free GitHub runners. The runner runs as a service and survives reboots;
# a run that loses the machine resumes from its last checkpoint in
# $ROUGE_STATE_DIR (default ~/rouge-state).
#
# SECURITY (public repository): a self-hosted runner executes workflow code.
# Before registering, set Settings -> Actions -> General -> "Fork pull request
# workflows from outside collaborators" to "Require approval for all outside
# collaborators", so no fork pull request can run on this machine without
# the owner's click. Use a dedicated user account without access to other
# secrets on the server.
set -euo pipefail

: "${RUNNER_TOKEN:?set RUNNER_TOKEN to a registration token from the repository settings}"
REPO_URL="${REPO_URL:-https://github.com/clarityosbaerbelwesterop-gif/Osirus}"
DIR="${RUNNER_DIR:-$HOME/actions-runner-rouge}"
VERSION="${RUNNER_VERSION:-$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))')}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-x64 ;;
  Linux-aarch64) platform=linux-arm64 ;;
  Darwin-arm64) platform=osx-arm64 ;;
  Darwin-x86_64) platform=osx-x64 ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac
labels="rouge-research"
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then labels="$labels,gpu"; fi

mkdir -p "$DIR" && cd "$DIR"
if [ ! -x ./config.sh ]; then
  curl -fsSL -o runner.tgz "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-$platform-$VERSION.tar.gz"
  tar xzf runner.tgz && rm runner.tgz
fi
./config.sh --unattended --replace --url "$REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$(hostname -s)-rouge" --labels "$labels" --work _work
if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null; then
  sudo ./svc.sh install "$USER" && sudo ./svc.sh start
else
  ./svc.sh install && ./svc.sh start
fi
# Prepare the research environment once, outside the job workspace.
"$(cd "$(dirname "$0")" && pwd)/bootstrap.sh" "${ROUGE_VENV:-$HOME/.rouge-venv}" 2>/dev/null \
  || echo "run env/bootstrap.sh ~/.rouge-venv from a checkout of the repository"
echo "runner registered with labels: self-hosted,$labels"
