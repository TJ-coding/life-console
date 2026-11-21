#!/bin/sh
# Life Console host updater: the `updater` service's job, run on the host instead of in a container, so no
# container ever holds the Docker socket. Use it with LC_UPDATER=0 in .env (see docs/SELF_HOSTING.md §4).
#
#   sudo cp scripts/host-updater.sh /usr/local/bin/life-console-updater
#   sudo life-console-updater /path/to/life-console          # test it in the foreground (Ctrl-C to stop)
#   then install it as a service: the systemd unit in docs/SELF_HOSTING.md §4
#
# It does exactly what the in-compose updater does: every 5 s it writes a heartbeat into the app's `updates`
# volume; when the app leaves an update request there, it runs, in the project folder,
#   docker compose pull app backup && docker compose up -d --no-build --wait app backup
# and writes the result back. It reads nothing from the request; the command is fixed here.
set -u
PROJECT_DIR="${1:-$PWD}"
cd "$PROJECT_DIR" || { echo "host-updater: no folder $PROJECT_DIR"; exit 1; }
[ -f docker-compose.yml ] || { echo "host-updater: no docker-compose.yml in $PROJECT_DIR"; exit 1; }
# the compose project's name, and where its `updates` volume lives on this host
PROJECT="${COMPOSE_PROJECT_NAME:-$(docker compose config --format json 2>/dev/null | sed -n 's/^ *"name": *"\([^"]*\)".*/\1/p' | head -n 1)}"
[ -n "$PROJECT" ] || PROJECT=life-console
UPDATES="$(docker volume inspect "${PROJECT}_updates" --format '{{ .Mountpoint }}' 2>/dev/null)"
[ -n "$UPDATES" ] && [ -d "$UPDATES" ] || { echo "host-updater: volume ${PROJECT}_updates not found (start the stack first)"; exit 1; }
chown 1000:1000 "$UPDATES" 2>/dev/null
echo "host-updater: watching $UPDATES for update requests (project $PROJECT in $PROJECT_DIR)"
while :; do
  echo "{\"at\":$(date +%s)}" > "$UPDATES/updater.json"
  if mv "$UPDATES/request" "$UPDATES/request.taken" 2>/dev/null; then
    echo "{\"state\":\"running\",\"at\":$(date +%s)}" > "$UPDATES/status.json"
    echo "$(date -u '+%F %T') pulling the new image" > "$UPDATES/status.log"
    if { docker compose -p "$PROJECT" pull app backup && docker compose -p "$PROJECT" up -d --no-build --wait --wait-timeout 300 app backup; } >> "$UPDATES/status.log" 2>&1
    then result=done; else result=failed; fi
    echo "{\"state\":\"$result\",\"at\":$(date +%s)}" > "$UPDATES/status.json"
    chown 1000:1000 "$UPDATES"/* 2>/dev/null
    echo "update $result:"; tail -n 20 "$UPDATES/status.log"
  fi
  sleep 5
done
