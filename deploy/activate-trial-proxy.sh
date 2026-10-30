#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) != 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
target=/www/server/panel/vhost/nginx/chatgpt.sakuravillage.tech.conf
backup=${target}.before-dom-trial-20261028
nginx=/www/server/nginx/sbin/nginx
curl --fail --silent --max-time 5 http://127.0.0.1:18080/healthz |
  python3 -c 'import json,sys; x=json.load(sys.stdin); assert x.get("ok") and x.get("browser")'
if [[ ! -f "$backup" ]]; then
  cp --preserve=all -- "$target" "$backup"
fi
cp -- "$deploy_dir/trial-nginx.conf" "$target"
if "$nginx" -t && "$nginx" -s reload; then
  printf 'Activated DOM browser proxy. Backup: %s\n' "$backup"
else
  cp --preserve=all -- "$backup" "$target"
  "$nginx" -t
  "$nginx" -s reload
  echo 'Activation failed; restored previous proxy configuration.' >&2
  exit 1
fi
