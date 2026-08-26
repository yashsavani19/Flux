#!/usr/bin/env bash
set -euo pipefail

# Build and run this checkout without touching upstream Flux containers or data.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER_NAME="${FLUX_SETUP_CONTAINER_NAME:-flux-local-web}"
VOLUME_NAME="${FLUX_SETUP_VOLUME_NAME:-flux-local-data}"
DEFAULT_PORT=3001
SETUP_LABEL="com.flux.setup=local-source"

die() { echo "Error: $*" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  die "Docker is required.
  Linux:       https://docs.docker.com/engine/install/
  macOS/Win:   https://www.docker.com/get-started"
fi
if ! docker info >/dev/null 2>&1; then
  # Distinguish "daemon is not running" from "you are not allowed to talk to it",
  # because on Linux the second is far more common and the fix is completely different.
  docker_err="$(docker info 2>&1 || true)"
  case "$docker_err" in
    *"permission denied"*|*"Got permission denied"*)
      die "Docker is installed but this user cannot reach it.
  Add yourself to the docker group, then log out and back in (or run: newgrp docker):
      sudo usermod -aG docker \$USER
  Or run this script with sudo."
      ;;
    *)
      die "Docker is installed but its daemon is not running.
  Linux:       sudo systemctl start docker
  macOS/Win:   start Docker Desktop"
      ;;
  esac
fi
if ! command -v git >/dev/null 2>&1; then
  die "Git is required to embed this checkout's revision. Install it: https://git-scm.com/downloads"
fi

case "$CONTAINER_NAME" in
  flux-web) die "Refusing to use container name flux-web; it may be a live board. Leave FLUX_SETUP_CONTAINER_NAME unset or choose another name." ;;
  '') die "FLUX_SETUP_CONTAINER_NAME must not be empty." ;;
esac
case "$VOLUME_NAME" in
  flux-data)
    [[ "${FLUX_SETUP_ALLOW_LIVE_DATA:-}" == "1" ]] || die "Refusing to use volume flux-data. It may contain a live board. Use a different FLUX_SETUP_VOLUME_NAME, or explicitly set FLUX_SETUP_ALLOW_LIVE_DATA=1."
    ;;
  '') die "FLUX_SETUP_VOLUME_NAME must not be empty." ;;
esac

if docker container inspect flux-web >/dev/null 2>&1; then
  echo "Notice: existing container flux-web detected; it will not be modified."
fi

existing_container=false
existing_port=""
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  existing_container=true
  existing_label="$(docker container inspect --format '{{ index .Config.Labels "com.flux.setup" }}' "$CONTAINER_NAME")"
  [[ "$existing_label" == "local-source" ]] || die "Container $CONTAINER_NAME exists but was not created by this setup script; refusing to replace it."
  existing_port="$(docker port "$CONTAINER_NAME" 3000/tcp 2>/dev/null | sed -n '1s/.*://p')"
fi

port_in_use() {
  local port="$1"
  if docker ps --format '{{.Ports}}' | grep -Eq "(^|, | )((0\.0\.0\.0|\[::\]):)?${port}->"; then return 0; fi
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN && return 0
  fi
  return 1
}

if [[ -n "${FLUX_SETUP_PORT:-}" ]]; then
  PORT="$FLUX_SETUP_PORT"
  [[ "$PORT" =~ ^[1-9][0-9]{0,4}$ && "$PORT" -le 65535 ]] || die "FLUX_SETUP_PORT must be a TCP port between 1 and 65535."
  [[ "$PORT" != "5173" ]] || die "Refusing to use port 5173; Flux development uses that port."
else
  PORT="${existing_port:-$DEFAULT_PORT}"
  [[ "$PORT" != "5173" ]] || PORT=$DEFAULT_PORT
  while port_in_use "$PORT" && [[ "$PORT" != "$existing_port" ]]; do
    PORT=$((PORT + 1))
    [[ "$PORT" -le 65535 ]] || die "No free TCP port was found starting at $DEFAULT_PORT. Set FLUX_SETUP_PORT to choose one."
    [[ "$PORT" != "5173" ]] || PORT=$((PORT + 1))
  done
fi

if [[ "$existing_container" == true ]]; then
  echo "Replacing the previous setup-managed container $CONTAINER_NAME. Its data volume is kept."
  docker stop "$CONTAINER_NAME" >/dev/null
  docker rm "$CONTAINER_NAME" >/dev/null
fi
if port_in_use "$PORT"; then
  die "Port $PORT is already in use. Choose another with FLUX_SETUP_PORT=<port> ./scripts/setup.sh."
fi

if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "Creating data volume $VOLUME_NAME..."
  docker volume create --label "$SETUP_LABEL" "$VOLUME_NAME" >/dev/null
fi

BUILD_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
IMAGE="flux-local:${BUILD_SHA:0:12}"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Building $IMAGE from this checkout ($BUILD_SHA)..."
docker build --label "org.opencontainers.image.revision=$BUILD_SHA" --build-arg "BUILD_SHA=$BUILD_SHA" --build-arg "BUILD_TIME=$BUILD_TIME" --tag "$IMAGE" "$REPO_DIR"

echo "Starting $CONTAINER_NAME on http://localhost:$PORT..."
docker run -d --name "$CONTAINER_NAME" --label "$SETUP_LABEL" --publish "$PORT:3000" --volume "$VOLUME_NAME:/app/packages/data" --env FLUX_DIR=/app/packages/data/.flux --env FLUX_DATA=/app/packages/data/flux.sqlite --env PORT=3000 "$IMAGE" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" bun -e "const r = await fetch('http://127.0.0.1:3000/health'); process.exit(r.ok ? 0 : 1)" >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$CONTAINER_NAME" >&2 || true
  docker rm -f "$CONTAINER_NAME" >/dev/null || true
  die "Flux did not become ready; the setup-managed container was removed and its data volume was kept."
fi

echo
echo "Flux is running: http://localhost:$PORT"
echo "Next: open that URL to create a project, then point MCP clients at http://localhost:$PORT."
echo "Stop and remove this container (while keeping your board data): ./scripts/teardown.sh"
