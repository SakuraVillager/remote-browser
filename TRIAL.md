# Remote Browser trial

Source commit: `2c9fb2a8ba89def4f655bccc7739bb598e95a740`.

- Public URL: https://chatgpt.sakuravillage.tech/
- Gateway: 127.0.0.1:18080; Chromium CDP has no host port mapping.
- Existing Nginx Basic Auth remains enabled. The application's separate password
  is in `.env` (owner-readable only).
- Persistent browser profile: Docker volume `remote-browser-trial_browser-profile`.
- Total container memory limit: 1920 MiB (browser 1536 MiB + gateway 384 MiB).
  Shared memory and tmpfs are inside these limits. Container swap is disabled.
- Browser and gateway both run as UID/GID 10001, so their shared upload/download
  directory remains accessible to both processes.
- The single-browser entrypoint removes stale Chromium singleton links left by
  a replaced container. It preserves the profile, cookies and site storage.
- Original Selkies container `chromium` and volume `chromium_data` are retained.

## Manage

From this directory:

```sh
./trial.sh ps
./trial.sh logs --tail 50
./trial.sh restart
./trial.sh stop
./trial.sh up -d --no-build
```

The launcher includes the persistence and memory-limit overlays. Use it instead
of plain `docker compose up`, which would omit those settings.

## Roll back to Selkies

Stop the trial first so two browsers do not compete for memory:

```sh
./trial.sh stop
sudo -n docker start chromium
sudo cp --preserve=all \
  /www/server/panel/vhost/nginx/chatgpt.sakuravillage.tech.conf.before-dom-trial-20261028 \
  /www/server/panel/vhost/nginx/chatgpt.sakuravillage.tech.conf
sudo /www/server/nginx/sbin/nginx -t
sudo /www/server/nginx/sbin/nginx -s reload
```

Stopping containers preserves both browser profiles. Do not use `down --volumes`
unless you intend to delete the trial's retained data.

## Build again

Build browser and gateway images sequentially using the dedicated BuildKit
builder `remote-browser-trial-builder`, whose memory is capped at 1536 MiB.
Stop the browser services first if needed to stay within the host's budget.
Stop the builder with `sudo -n docker buildx stop remote-browser-trial-builder`
after building. It is not required to run the service.

`deploy/trial-smoke.mjs` exercises the real gate, viewer, DOM updates, Chinese
text, upload and download against a temporary fixture without enabling E2E
authorization bypasses. Its helper browser/listeners are temporary and should
be removed by recreating the browser container after verification.

## Verification results (2026-10-28)

- Both containers healthy after recreation.
- Real password gate and authenticated WebSocket passed.
- Local DOM reconstruction, remote click round trip and Chinese text input passed.
- File download retrieved by the local viewer passed.
- ChatGPT unauthenticated homepage rendered in DOM mode; screenshot is
  `deploy/trial-chatgpt.png`. No ChatGPT account login was attempted.
- Upload did not pass the browser test (`ERR_FILE_NOT_FOUND` / failed fetch);
  treat upload as unverified for this trial.
- No pixel frames were received during the verification session.
- Idle service memory after test cleanup was approximately 280 MiB; this is not
  a worst-case memory measurement. Configured combined limit is 1920 MiB.
- Nginx configuration test and reload succeeded. Public HTTPS retains the existing
  Basic Auth gate; plain HTTP redirects to HTTPS.

## Input and tab fixes (2026-10-28)

- Recorded rrweb cursor overlays are hidden; the native local pointer remains.
- Background/reconnect snapshots no longer select their tab. A pending user tab
  selection survives older metadata until the server acknowledges it.
- Gateway tab active flags are computed together after asynchronous favicon lookups.
- Email edits synchronize their complete value, and blur/Enter flush native text
  before a remote form action.
- Viewer and gateway typechecks passed; 81 targeted unit tests passed.
- An isolated real-browser regression verified the supplied email with rapid
  typing and complete text insertion, valid remote input state, stable second-tab
  selection during background updates, reconnect recovery, and hidden replay cursors.
  No real login form was submitted and no login email was requested.
- Only the gateway is recreated for this update. Production Chromium and its
  profile are preserved. Reload the local viewer to load the new asset bundle.
- Previous gateway image: `remote-browser-gateway:before-input-fix`.

External-browser lifecycle fix: the CDP adapter now disconnects when the gateway
exits, leaving separately managed Chromium running. Owned local browser launches
still shut down explicitly. The isolated gateway-replacement check and final
production rollout both verified that Chromium's start time did not change.

## Connection restart fix (2026-10-29)

The gateway repeatedly exited with `ERR_INVALID_CHAR` while streaming assets
whose `server-timing` header could not be sent by Node HTTP. Docker restarted it,
causing the viewer to alternate between `closed` and `connecting`. OOM was false.
Asset responses now validate header names and each value with Node's HTTP
validators before forwarding, including cache hits and Range responses. Invalid
headers are omitted while valid resource bytes and headers are retained.

Both typechecks and 92 targeted tests passed. The new regression uses real HTTP
sockets to exercise invalid names, newline-containing values, Unicode values,
and arrays on both cached and Range responses; an injected request alone does
not exercise the deferred Node header validation that caused the crash.
`deploy/check-connection.mjs` is a read-only authenticated viewer probe for
production: it observes snapshots, requests mirrored assets, and checks ping
responses without sending navigation, input, or viewport changes.

Deployed image: `remote-browser-gateway:headers-fix` (also tagged `:local`).
Previous image retained as `remote-browser-gateway:before-header-fix`.
Post-deployment probe received one snapshot, 13 ping replies and 13 successful
mirrored asset responses, with zero asset errors or unexpected disconnections.
Gateway restart count remained zero. Chromium's start time remained
`2026-10-28T15:56:31.427038519Z`, preserving the running browser session.

## Scroll, SVG icons, Chinese input and automatic download refinements (2026-10-29)

Returned to the original remote-browser at the user's request. Removed the
Scramjet container/network, all `scramjet-trial` image tags, its workspace,
Nginx trial routes, trial password file and trial-specific config backup.
The original Nginx gate and remote-browser profile were retained.

- Rebuild scroll restoration and window reconciliation use `behavior: "instant"`.
  The former `auto` behavior can follow author `scroll-behavior: smooth` CSS,
  visibly animating a newly rebuilt iframe from zero to the saved position.
- Resource rewriting covers SVG `use`, `image` and `feImage` `href` attributes.
  Fragment identifiers remain outside the encrypted asset token, so the local
  browser can select a symbol from the proxied sprite. Symbols in the same
  sprite reuse its resource URL. `xlink:href` and CSS fragments are also covered.
- Contenteditable native text insertion without keyboard/compositionend events
  is forwarded immediately. Remote IME preedit uses `Input.imeSetComposition`
  and commits once through `Input.insertText`. Matching native input events are
  deduplicated; Process/keyCode-229 placeholders do not suppress committed text.
- On completion, the driver viewer automatically opens the authenticated
  attachment link in its own unsandboxed document. No second Save click is
  required. Dismissing the progress entry does not cancel this handoff. Duplicate
  completion messages cannot start duplicate local downloads. The existing
  session guard and one-time download URLs remain in place.

Both typechecks and 126 targeted unit tests passed. The isolated real-browser
regression uses the actual public ChatGPT sprite and verifies non-empty SVG
geometry for modern and legacy href references. It verifies Chinese native
insertion without blur/Enter, remote preedit plus exactly one IME commit,
snapshot scroll stability under both smooth and auto CSS (each sampled at
1800px throughout), and a real local browser download with filename and exact
Unicode file bytes. Tests use a separate browser profile and real access gate.
No login credentials or conversation bodies are inspected. Screenshot:
`deploy/refinement-regression.png` (fixture only).

Image: `remote-browser-gateway:refinements` (also `:local`), digest
`sha256:ecf3a57de61c86319597f53628c17543069920cddbc6569bc926611b78d83d29`.
Previous production image retained as `remote-browser-gateway:before-refinements`.
Only the gateway is recreated. Reload the viewer to load the new bundle.

Rollout verification: both production containers are healthy; gateway restart
count is zero. Chromium still started at `2026-10-28T15:56:31.427038519Z`.
The read-only authenticated production probe received six snapshots, 13 ping
replies and 30 successful proxied asset responses, with zero asset errors or
unexpected disconnections. No Scramjet image or listener on port 18081 remains.
The isolated regression containers/volumes were removed and BuildKit stopped.
