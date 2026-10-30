#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
compose=(docker compose --project-name remote-browser-regression --file compose.yml --file compose.trial.yml --file compose.regression.yml)
cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then "${compose[@]}" logs --no-color --tail 12 gateway >&2 || true; fi
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create remote-browser-regression_runtime-data >/dev/null
docker run --rm --network none --memory 64m --memory-swap 64m --user 0:0 \
  --mount type=volume,source=remote-browser-regression_runtime-data,target=/runtime \
  --entrypoint /bin/chown remote-browser-chromium:local -R 10001:10001 /runtime
"${compose[@]}" up --detach --no-build --wait --wait-timeout 60
docker exec -d remote-browser-regression-browser-1 socat TCP-LISTEN:9225,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9224
docker exec -d remote-browser-regression-browser-1 socat TCP-LISTEN:3011,bind=127.0.0.1,reuseaddr,fork TCP:gateway:3000
docker exec -d remote-browser-regression-browser-1 /usr/bin/chromium \
  --headless --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224 \
  --user-data-dir=/tmp/trial-viewer-profile --no-first-run --disable-background-networking \
  --disable-gpu about:blank
set +e
docker exec -i remote-browser-regression-gateway-1 node --input-type=module < deploy/input-regression.mjs
status=$?
set -e
if [[ "$status" == 0 ]]; then
  docker cp remote-browser-regression-gateway-1:/runtime/gateway/input-regression.png deploy/input-regression.png
  before=$(docker inspect --format '{{.State.StartedAt}}' remote-browser-regression-browser-1)
  "${compose[@]}" up --detach --no-build --no-deps --force-recreate --wait --wait-timeout 60 gateway
  after=$(docker inspect --format '{{.State.StartedAt}}' remote-browser-regression-browser-1)
  [[ "$before" == "$after" ]]
  echo '[pass] gateway replacement preserves the running Chromium container'
else
  docker cp remote-browser-regression-gateway-1:/runtime/gateway/input-regression-failure.png deploy/input-regression-failure.png || true
fi
exit "$status"
