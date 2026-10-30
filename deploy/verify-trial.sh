#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
compose=(docker compose --project-name remote-browser-trial --file compose.yml --file compose.persistent.yml --file compose.trial.yml)
"${compose[@]}" up --detach --no-build --force-recreate --wait --wait-timeout 60
docker exec -d remote-browser-trial-browser-1 socat TCP-LISTEN:9225,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9224
docker exec -d remote-browser-trial-browser-1 socat TCP-LISTEN:3011,bind=127.0.0.1,reuseaddr,fork TCP:gateway:3000
docker cp deploy/trial-upload.txt remote-browser-trial-browser-1:/tmp/trial-upload.txt
docker exec remote-browser-trial-gateway-1 node -e 'require("node:fs").writeFileSync("/tmp/trial-upload.txt", "remote-browser-upload-ok")'
docker exec -d remote-browser-trial-browser-1 /usr/bin/chromium \
  --headless --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224 \
  --user-data-dir=/tmp/trial-viewer-profile --no-first-run \
  --no-default-browser-check --disable-background-networking --disable-gpu about:blank
set +e
docker exec -i remote-browser-trial-gateway-1 node --input-type=module < deploy/trial-smoke.mjs
status=$?
set -e
"${compose[@]}" up --detach --no-build --force-recreate --wait --wait-timeout 60
exit "$status"
