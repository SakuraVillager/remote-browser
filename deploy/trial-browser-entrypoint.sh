#!/bin/sh
set -eu
# This profile belongs exclusively to the one Compose browser service. A previous
# container is already stopped before its replacement starts. Only remove stale
# process-singleton links, never the profile or its cookies/storage.
profile_dir=${BROWSER_PROFILE_DIR:-/profile}
mkdir -p "$profile_dir"
rm -f -- "$profile_dir/SingletonLock" "$profile_dir/SingletonCookie" "$profile_dir/SingletonSocket"
exec /opt/remote-browser/browser-entrypoint.sh "$@"
