#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
exec sudo -n docker compose --project-name remote-browser-trial \
  --file compose.yml --file compose.persistent.yml --file compose.trial.yml "$@"
