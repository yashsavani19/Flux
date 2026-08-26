#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${FLUX_SETUP_CONTAINER_NAME:-flux-local-web}"
VOLUME_NAME="${FLUX_SETUP_VOLUME_NAME:-flux-local-data}"
REMOVE_DATA=false

usage() { echo "Usage: ./scripts/teardown.sh [--remove-data]" >&2; }
case "${1:-}" in
  '') ;;
  --remove-data) REMOVE_DATA=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac
case "$CONTAINER_NAME" in flux-web|'') echo "Error: refusing to touch container name $CONTAINER_NAME." >&2; exit 1 ;; esac
case "$VOLUME_NAME" in flux-data|'') echo "Error: refusing to touch volume name $VOLUME_NAME." >&2; exit 1 ;; esac

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  label="$(docker container inspect --format '{{ index .Config.Labels "com.flux.setup" }}' "$CONTAINER_NAME")"
  [[ "$label" == "local-source" ]] || { echo "Error: $CONTAINER_NAME was not created by this setup script; refusing to remove it." >&2; exit 1; }
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" == "true" ]]; then docker stop "$CONTAINER_NAME"; fi
  docker rm "$CONTAINER_NAME"
else
  echo "No setup-managed container named $CONTAINER_NAME exists."
fi

if [[ "$REMOVE_DATA" == true ]]; then
  if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    label="$(docker volume inspect --format '{{ index .Labels "com.flux.setup" }}' "$VOLUME_NAME")"
    [[ "$label" == "local-source" ]] || { echo "Error: $VOLUME_NAME was not created by this setup script; refusing to remove it." >&2; exit 1; }
    docker volume rm "$VOLUME_NAME"
    echo "Removed setup-managed data volume $VOLUME_NAME."
  else
    echo "No setup-managed data volume named $VOLUME_NAME exists."
  fi
else
  echo "Kept data volume $VOLUME_NAME. Remove it only when you intend to erase this board: ./scripts/teardown.sh --remove-data"
fi
