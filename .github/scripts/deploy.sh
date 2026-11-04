#!/usr/bin/env bash
# Runs on the self-hosted GitHub runner on the deployment server.
#
# Directory layout
#   $DEPLOY_PATH/releases/<release ID>   Unpacked releases
#   $DEPLOY_PATH/current                 Symlink to the release being served
#
# Flow: unpack bundle -> switch current -> PM2 reload -> health check (roll back on failure)
#
# Usage: deploy.sh <bundle.tar.gz>
# Required environment variables
#   DEPLOY_PATH   Deployment root (e.g. /home/ubuntu/apps/delivery-tracker)
# Optional environment variables
#   APP_NAME (delivery-tracker), PORT (8000), KEEP_RELEASES (3)
set -Eeuo pipefail

BUNDLE="${1:?Bundle path is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
export APP_NAME="${APP_NAME:-delivery-tracker}"
export PORT="${PORT:-8000}"
export DEPLOY_PATH
KEEP_RELEASES="${KEEP_RELEASES:-3}"

SHA="${GITHUB_SHA:-unknown}"
RELEASES_DIR="$DEPLOY_PATH/releases"
RELEASE_DIR="$RELEASES_DIR/$(date +%Y%m%d%H%M%S)-${SHA:0:7}"
CURRENT_LINK="$DEPLOY_PATH/current"
PREV_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
SWITCHED=false

log() { echo "[$(date '+%H:%M:%S')] $*"; }

switch_current() {
  ln -sfn "$1" "$CURRENT_LINK.tmp"
  mv -Tf "$CURRENT_LINK.tmp" "$CURRENT_LINK"
}

# Keep the latest $1 releases. The release that current points to is always kept.
cleanup_releases() {
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +$(($1 + 1)) | while read -r dir; do
    [ "$(readlink -f "$dir")" = "$(readlink -f "$CURRENT_LINK")" ] && continue
    log "Removing $dir"
    rm -rf "$dir"
  done
}

pm2_reload() {
  pm2 startOrReload "$CURRENT_LINK/ecosystem.config.js" --update-env
}

health_check() {
  curl -fsS -o /dev/null -m 5 "http://localhost:${PORT}" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ carriers(first: 1) { edges { node { id } } } }"}'
}

on_error() {
  log "Deployment failed"
  if [ "$SWITCHED" = true ]; then
    if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
      log "Rolling back to $PREV_RELEASE"
      switch_current "$PREV_RELEASE"
      pm2_reload || true
    else
      pm2 delete "$APP_NAME" || true
      rm -f "$CURRENT_LINK"
    fi
  fi
  rm -rf "$RELEASE_DIR"
}

log "=== Deploying $APP_NAME (${SHA:0:7}) ==="
log "node $(node -v) / pm2 $(pm2 -v | tail -n 1)"

# A health check would otherwise pass against another process on the port
PM2_PID="$(pm2 pid "$APP_NAME" | tail -n 1)"
if [ "${PM2_PID:-0}" = 0 ] && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "::error::Port $PORT is in use by a process other than PM2"
  exit 1
fi

trap on_error ERR

log "1. Unpacking bundle to $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$BUNDLE" -C "$RELEASE_DIR"

log "2. Switching current"
switch_current "$RELEASE_DIR"
SWITCHED=true

log "3. Reloading PM2"
pm2_reload

log "4. Health check (http://localhost:${PORT})"
for i in $(seq 1 30); do
  if health_check; then
    log "Health check passed"
    break
  fi
  log "Waiting for a response... ($i/30)"
  if [ "$i" -eq 30 ]; then
    pm2 logs "$APP_NAME" --lines 100 --nostream || true
    false # Triggers the ERR trap and rolls back
  fi
  sleep 2
done

pm2 save
trap - ERR

log "5. Removing old releases (keeping the latest $KEEP_RELEASES)"
cleanup_releases "$KEEP_RELEASES"

log "=== Deployed $RELEASE_DIR ==="
